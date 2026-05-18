// Hudl authenticated scraper - extracts player stats from a coaching account.
//
// Requires env vars: HUDL_EMAIL, HUDL_PASSWORD
// Optional env var: HUDL_TEAM_URL
// Run: pnpm --filter @pll/ingest exec tsx src/scripts/syncHudl.ts [--headed] [--dry-run]
//
// What it does:
//   1. Launches Chromium via Playwright
//   2. Logs into hudl.com with coaching credentials
//   3. Navigates to the team's roster/stats pages
//   4. Extracts roster (name, jersey, position) plus per-game player stats
//   5. Writes/updates players and player_stats in SQLite unless --dry-run is set
//
// The Harriton coach account can see:
//   - Full stats for Harriton
//   - Opponent stats from games Harriton has played
//
// TODO: Replace the heuristic selectors below with Hudl-specific selectors after
// the first headed run confirms the real DOM structure for this account.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { createLogger } from '@pll/shared';
import { openDb } from '../db.js';
import { normalizePlayerName } from '../normalize/playerName.js';

const log = createLogger({ name: 'ingest:syncHudl' });
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const HUDL_EMAIL = process.env.HUDL_EMAIL;
const HUDL_PASSWORD = process.env.HUDL_PASSWORD;
const HUDL_TEAM_URL = process.env.HUDL_TEAM_URL;
const DEFAULT_TEAM_NAME = 'Harriton';
const IMPORT_SOURCE = 'hudl';
const IMPORT_PARSER_VERSION = 'hudl-playwright-v0';
const HEADED = process.argv.includes('--headed');
const DRY_RUN = process.argv.includes('--dry-run');

interface HudlPlayer {
  name: string;
  jerseyNumber: number | null;
  position: string | null;
}

interface HudlGameStat {
  playerName: string;
  jerseyNumber: number | null;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  faceoffsWon: number;
  faceoffsTaken: number;
}

interface HudlGame {
  date: string;
  opponent: string;
  homeScore: number;
  awayScore: number;
  isHome: boolean;
  stats: HudlGameStat[];
}

interface HudlArgs {
  headed: boolean;
  dryRun: boolean;
}

interface TeamRow {
  id: number;
  name: string;
  slug: string;
}

interface PlayerRow {
  id: number;
  name: string;
  jersey_number: number | null;
}

interface GameRow {
  id: number;
  date: string;
  season: number | null;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  opponent_name: string;
  opponent_slug: string;
}

interface GameCandidate {
  gameId: number;
  season: number;
}

function parseArgs(argv: string[]): HudlArgs {
  return {
    headed: argv.includes('--headed'),
    dryRun: argv.includes('--dry-run'),
  };
}

function normalizeOpponentToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseInteger(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, '').match(/-?\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateToIso(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const isoMatch = trimmed.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1] ?? '';
  const normalized = trimmed.replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1').replace(/\s+/g, ' ');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseScore(scoreText: string): { homeScore: number; awayScore: number } {
  const parts = scoreText.match(/\d+/g)?.map((part) => Number.parseInt(part, 10)) ?? [];
  return {
    homeScore: parts[0] ?? 0,
    awayScore: parts[1] ?? 0,
  };
}

function logRosterPreview(roster: HudlPlayer[]): void {
  for (const player of roster.slice(0, 10)) {
    log.info(
      `[syncHudl] roster preview name=${player.name} jersey=${player.jerseyNumber ?? 'n/a'} position=${player.position ?? 'n/a'}`,
    );
  }
}

function logGamePreview(games: HudlGame[]): void {
  for (const game of games.slice(0, 5)) {
    log.info(
      `[syncHudl] game preview date=${game.date || 'unknown'} opponent=${game.opponent || 'unknown'} stats=${game.stats.length}`,
    );
  }
}

async function textFromAny(root: Page | Locator, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    const text = (await locator.textContent().catch(() => null))?.trim();
    if (text) return text;
  }
  return '';
}

async function clickFirstVisible(root: Page | Locator, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await locator.click();
    return true;
  }
  return false;
}

async function collectGameUrls(page: Page): Promise<string[]> {
  const selectors = ['a[href*="/game/"]', 'a[href*="/games/"]', '[data-game-id] a[href]'];
  const urls = new Set<string>();
  for (const selector of selectors) {
    const links = page.locator(selector);
    const count = await links.count();
    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute('href').catch(() => null);
      if (!href) continue;
      try {
        urls.add(new URL(href, page.url()).toString());
      } catch {
        // Ignore malformed hrefs in the scaffold pass.
      }
    }
  }
  return [...urls];
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => {
    const normalized = normalizeOpponentToken(header);
    return candidates.some((candidate) => normalized.includes(candidate));
  });
}

function statFromCells(cells: string[], index: number): number {
  if (index < 0 || index >= cells.length) return 0;
  return parseInteger(cells[index]) ?? 0;
}

async function extractStatRows(page: Page): Promise<HudlGameStat[]> {
  const tableSelectors = ['table:has(th)', 'table', '.stats-table', '[data-testid="stats-table"]'];
  for (const tableSelector of tableSelectors) {
    const table = page.locator(tableSelector).first();
    if ((await table.count()) === 0) continue;

    const rows = table.locator('tbody tr');
    if ((await rows.count()) === 0) continue;

    const headers = await table.locator('thead tr th').allTextContents().catch(() => [] as string[]);
    const normalizedHeaders = headers.map((header: string) => header.toLowerCase().trim()).filter(Boolean);

    const jerseyIndex = findColumnIndex(normalizedHeaders, ['#', 'number', 'jersey']);
    const playerIndex = findColumnIndex(normalizedHeaders, ['player', 'athlete', 'name']);
    const goalsIndex = findColumnIndex(normalizedHeaders, ['goal', 'g']);
    const assistsIndex = findColumnIndex(normalizedHeaders, ['assist', 'a']);
    const groundBallsIndex = findColumnIndex(normalizedHeaders, ['groundball', 'groundballs', 'gb']);
    const causedTurnoversIndex = findColumnIndex(normalizedHeaders, ['causedturnover', 'causedturnovers', 'ct']);
    const savesIndex = findColumnIndex(normalizedHeaders, ['save', 'sv']);
    const faceoffsWonIndex = findColumnIndex(normalizedHeaders, ['fowon', 'faceoffwon', 'faceoffswon', 'fo won']);
    const faceoffsTakenIndex = findColumnIndex(normalizedHeaders, ['fotaken', 'faceofftaken', 'faceoffsattempted', 'fo taken']);

    const stats: HudlGameStat[] = [];
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const cells = await row.locator('th, td').allTextContents().catch(() => [] as string[]);
      if (cells.length === 0) continue;

      const fallbackPlayer = cells.find((cell: string) => /[a-z]/i.test(cell) && !/^\d+$/.test(cell));
      const playerName = (playerIndex >= 0 ? cells[playerIndex] : fallbackPlayer)?.trim() ?? '';
      const normalizedName = normalizePlayerName(playerName);
      if (!normalizedName) continue;

      const fallbackJersey = cells.find((cell: string) => /^#?\d{1,2}$/.test(cell.trim()));
      stats.push({
        playerName,
        jerseyNumber: parseInteger(jerseyIndex >= 0 ? cells[jerseyIndex] : fallbackJersey),
        goals: statFromCells(cells, goalsIndex),
        assists: statFromCells(cells, assistsIndex),
        groundBalls: statFromCells(cells, groundBallsIndex),
        causedTurnovers: statFromCells(cells, causedTurnoversIndex),
        saves: statFromCells(cells, savesIndex),
        faceoffsWon: statFromCells(cells, faceoffsWonIndex),
        faceoffsTaken: statFromCells(cells, faceoffsTakenIndex),
      });
    }

    if (stats.length > 0) return stats;
  }

  return [];
}

async function login(page: Page): Promise<void> {
  log.info('[syncHudl] navigating to login');
  await page.goto('https://www.hudl.com/login', { waitUntil: 'networkidle' });

  // Step 1: Hudl uses Auth0 Universal Login — email first, then "Continue"
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(HUDL_EMAIL ?? '');

  const continueBtn = page.locator('button[type="submit"]').first();
  await continueBtn.click();

  // Step 2: Password page loads after email submission
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(HUDL_PASSWORD ?? '');

  const loginBtn = page.locator('button[type="submit"]').first();
  await loginBtn.click();

  // Wait for redirect away from identity.hudl.com
  await page.waitForURL((url) => !url.href.includes('identity.hudl.com') && !url.href.includes('/login'), { timeout: 30000 });
  log.info(`[syncHudl] login successful url=${page.url()}`);
}

async function navigateToTeamStats(page: Page): Promise<void> {
  log.info('[syncHudl] navigating to team area');
  if (HUDL_TEAM_URL) {
    await page.goto(HUDL_TEAM_URL, { waitUntil: 'networkidle' });
    log.info(`[syncHudl] opened HUDL_TEAM_URL=${HUDL_TEAM_URL}`);
    return;
  }

  await page.goto('https://www.hudl.com/home', { waitUntil: 'networkidle' });
  const clickedTeam = await clickFirstVisible(page, [
    'a[href*="/team/"]',
    'a[href*="/teams/"]',
    '[data-testid="team-card"] a',
    'nav a:has-text("Team")',
  ]);
  if (clickedTeam) {
    await page.waitForLoadState('networkidle');
    log.info(`[syncHudl] reached team page url=${page.url()}`);
    return;
  }

  log.warn('[syncHudl] could not auto-find a team link from /home; set HUDL_TEAM_URL if this account lands elsewhere');
}

async function scrapeRoster(page: Page): Promise<HudlPlayer[]> {
  log.info('[syncHudl] scraping roster');
  await clickFirstVisible(page, [
    'a:has-text("Roster")',
    'button:has-text("Roster")',
    '[data-tab="roster"]',
    'a[href*="roster"]',
  ]).catch(() => false);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const rowSelectors = ['table tbody tr', '.roster-list .player-row', '[data-athlete-id]'];
  for (const rowSelector of rowSelectors) {
    const rows = page.locator(rowSelector);
    const rowCount = await rows.count();
    if (rowCount === 0) continue;

    const roster: HudlPlayer[] = [];
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const name = await textFromAny(row, ['.player-name', '[data-field="name"]', 'td:nth-child(2)', 'td:nth-child(1)']);
      const normalizedName = normalizePlayerName(name);
      if (!normalizedName) continue;

      const jerseyText = await textFromAny(row, ['.jersey-number', '[data-field="number"]', 'td:nth-child(1)']);
      const position = await textFromAny(row, ['.position', '[data-field="position"]', 'td:nth-child(3)']);
      roster.push({
        name: name.trim(),
        jerseyNumber: parseInteger(jerseyText),
        position: position || null,
      });
    }

    if (roster.length > 0) {
      log.info(`[syncHudl] roster rows=${roster.length}`);
      return roster;
    }
  }

  log.warn('[syncHudl] no roster rows matched the current selectors');
  return [];
}

async function scrapeGameStats(page: Page): Promise<HudlGame[]> {
  log.info('[syncHudl] scraping game stats');
  await clickFirstVisible(page, [
    'a:has-text("Stats")',
    'button:has-text("Stats")',
    'a:has-text("Schedule")',
    'button:has-text("Schedule")',
    '[data-tab="stats"]',
  ]).catch(() => false);
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const gameUrls = await collectGameUrls(page);
  log.info(`[syncHudl] discovered ${gameUrls.length} game urls`);

  const games: HudlGame[] = [];
  for (const [index, gameUrl] of gameUrls.entries()) {
    try {
      log.info(`[syncHudl] opening game ${index + 1}/${gameUrls.length}: ${gameUrl}`);
      await page.goto(gameUrl, { waitUntil: 'networkidle' });

      const dateText = await textFromAny(page, ['time', '.game-date', '[data-field="date"]']);
      const opponentText = await textFromAny(page, [
        '.opponent-name',
        '[data-field="opponent"]',
        'h1',
        'h2',
      ]);
      const scoreText = await textFromAny(page, ['.game-score', '.final-score', '[data-field="score"]']);
      const score = parseScore(scoreText);
      const isHome = /vs\.?/i.test(opponentText) || /home/i.test(page.url());
      const stats = await extractStatRows(page);
      if (stats.length === 0) {
        log.warn(`[syncHudl] no stat rows found for ${gameUrl}`);
        continue;
      }

      games.push({
        date: parseDateToIso(dateText),
        opponent: opponentText.trim(),
        homeScore: score.homeScore,
        awayScore: score.awayScore,
        isHome,
        stats,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[syncHudl] failed to scrape ${gameUrl}: ${message}`);
    }
  }

  log.info(`[syncHudl] scraped ${games.length} games with stats`);
  return games;
}

function loadTeam(db: Database): TeamRow | null {
  const team = db
    .prepare('SELECT id, name, slug FROM teams WHERE name LIKE ? ORDER BY id LIMIT 1')
    .get(`%${DEFAULT_TEAM_NAME}%`) as TeamRow | undefined;
  return team ?? null;
}

function upsertRosterPlayers(db: Database, teamId: number, roster: HudlPlayer[]): void {
  if (roster.length === 0) return;

  const upsertPlayer = db.prepare(
    `INSERT INTO players (name, name_normalized, team_id, name_resolution, jersey_number)
     VALUES (?, ?, ?, 'full', ?)
     ON CONFLICT(team_id, name_normalized) DO UPDATE SET
       name = excluded.name,
       jersey_number = COALESCE(excluded.jersey_number, players.jersey_number)`,
  );

  const tx = db.transaction((players: HudlPlayer[]) => {
    for (const player of players) {
      const normalized = normalizePlayerName(player.name);
      if (!normalized) continue;
      upsertPlayer.run(player.name, normalized, teamId, player.jerseyNumber);
    }
  });
  tx(roster);
}

function loadPlayerIndex(db: Database, teamId: number): {
  byNormalized: Map<string, PlayerRow>;
  byJersey: Map<number, PlayerRow>;
} {
  const rows = db
    .prepare('SELECT id, name, jersey_number FROM players WHERE team_id = ?')
    .all(teamId) as PlayerRow[];

  const byNormalized = new Map<string, PlayerRow>();
  const byJersey = new Map<number, PlayerRow>();
  for (const row of rows) {
    byNormalized.set(normalizePlayerName(row.name), row);
    if (typeof row.jersey_number === 'number') byJersey.set(row.jersey_number, row);
  }
  return { byNormalized, byJersey };
}

function loadTeamGames(db: Database, teamId: number): GameRow[] {
  return db
    .prepare(
      `SELECT
         g.id,
         g.date,
         g.home_team_id,
         g.away_team_id,
         g.home_score,
         g.away_score,
         home.name AS home_name,
         away.name AS away_name,
         home.slug AS home_slug,
         away.slug AS away_slug
       FROM games g
       JOIN teams home ON home.id = g.home_team_id
       JOIN teams away ON away.id = g.away_team_id
       WHERE g.home_team_id = ? OR g.away_team_id = ?`,
    )
    .all(teamId, teamId)
    .map((row) => {
      const record = row as {
        id: number;
        date: string;
        home_team_id: number;
        away_team_id: number;
        home_score: number;
        away_score: number;
        home_name: string;
        away_name: string;
        home_slug: string;
        away_slug: string;
      };
      const season = Number.parseInt(record.date.slice(0, 4), 10);
      const isHome = record.home_team_id === teamId;
      return {
        id: record.id,
        date: record.date,
        season: Number.isFinite(season) ? season : null,
        home_team_id: record.home_team_id,
        away_team_id: record.away_team_id,
        home_score: record.home_score,
        away_score: record.away_score,
        opponent_name: isHome ? record.away_name : record.home_name,
        opponent_slug: isHome ? record.away_slug : record.home_slug,
      };
    });
}

function matchGame(game: HudlGame, candidates: GameRow[]): GameCandidate | null {
  const dateToken = parseDateToIso(game.date);
  const opponentToken = normalizeOpponentToken(game.opponent);
  const matched = candidates.find((candidate) => {
    if (dateToken && candidate.date !== dateToken) return false;
    const candidateTokens = [normalizeOpponentToken(candidate.opponent_name), normalizeOpponentToken(candidate.opponent_slug)];
    return opponentToken ? candidateTokens.some((token) => token && (token === opponentToken || token.includes(opponentToken) || opponentToken.includes(token))) : dateToken === candidate.date;
  });
  if (!matched) return null;
  return { gameId: matched.id, season: matched.season ?? Number.parseInt(matched.date.slice(0, 4), 10) };
}

function writeGameStats(db: Database, teamId: number, games: HudlGame[]): { written: number; skipped: number } {
  const players = loadPlayerIndex(db, teamId);
  const gameRows = loadTeamGames(db, teamId);
  const upsertStat = db.prepare(
    `INSERT INTO player_stats (
       game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves,
       fo_won, fo_taken, source, parser_version, confidence, season
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?)
     ON CONFLICT(game_id, player_id) DO UPDATE SET
       goals = excluded.goals,
       assists = excluded.assists,
       ground_balls = excluded.ground_balls,
       caused_turnovers = excluded.caused_turnovers,
       saves = excluded.saves,
       fo_won = excluded.fo_won,
       fo_taken = excluded.fo_taken,
       source = excluded.source,
       parser_version = excluded.parser_version,
       season = excluded.season`,
  );

  let written = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const game of games) {
      const matchedGame = matchGame(game, gameRows);
      if (!matchedGame) {
        log.warn(`[syncHudl] no DB game match for date=${game.date || 'unknown'} opponent=${game.opponent || 'unknown'}`);
        skipped += game.stats.length;
        continue;
      }

      for (const stat of game.stats) {
        const normalized = normalizePlayerName(stat.playerName);
        const byName = players.byNormalized.get(normalized);
        const byJersey = stat.jerseyNumber != null ? players.byJersey.get(stat.jerseyNumber) : undefined;
        const player = byName ?? byJersey;
        if (!player) {
          log.warn(
            `[syncHudl] skipping unmatched player game=${matchedGame.gameId} name=${stat.playerName} jersey=${stat.jerseyNumber ?? 'n/a'}`,
          );
          skipped += 1;
          continue;
        }

        upsertStat.run(
          matchedGame.gameId,
          player.id,
          stat.goals,
          stat.assists,
          stat.groundBalls,
          stat.causedTurnovers,
          stat.saves,
          stat.faceoffsWon,
          stat.faceoffsTaken,
          IMPORT_SOURCE,
          IMPORT_PARSER_VERSION,
          matchedGame.season,
        );
        written += 1;
      }
    }
  });
  tx();
  return { written, skipped };
}

function writeToDb(roster: HudlPlayer[], games: HudlGame[], args: HudlArgs): void {
  if (args.dryRun) {
    log.info('[syncHudl] dry-run enabled; skipping all DB writes');
    log.info(`[syncHudl] dry-run roster=${roster.length} games=${games.length}`);
    return;
  }

  const db = openDb(DB_PATH);
  try {
    log.info(`[syncHudl] writing to db=${DB_PATH}`);
    const team = loadTeam(db);
    if (!team) {
      log.warn(`[syncHudl] ${DEFAULT_TEAM_NAME} not found in DB; skipping writes`);
      return;
    }

    upsertRosterPlayers(db, team.id, roster);
    const statResult = writeGameStats(db, team.id, games);
    log.info(`[syncHudl] upserted roster players=${roster.length}`);
    log.info(`[syncHudl] upserted player_stats rows=${statResult.written} skipped_rows=${statResult.skipped}`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  if (!HUDL_EMAIL || !HUDL_PASSWORD) {
    console.error('ERROR: HUDL_EMAIL and HUDL_PASSWORD env vars are required.');
    console.error('Set them in packages/ingest/.env (gitignored) or export them before running syncHudl.');
    process.exit(1);
  }

  log.info(`[syncHudl] starting db=${DB_PATH} headed=${HEADED} dryRun=${DRY_RUN}`);
  if (!HUDL_TEAM_URL) {
    log.info('[syncHudl] HUDL_TEAM_URL not set; auto-navigation will try to locate the team page from /home');
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: !HEADED });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await login(page);
    await navigateToTeamStats(page);
    const roster = await scrapeRoster(page);
    logRosterPreview(roster);
    const games = await scrapeGameStats(page);
    logGamePreview(games);
    writeToDb(roster, games, { headed: HEADED, dryRun: DRY_RUN });
    log.info('[syncHudl] complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[syncHudl] failed: ${message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

void main();
