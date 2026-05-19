// Hudl authenticated scraper - extracts player stats from a coaching account.
//
// Requires env vars: HUDL_EMAIL, HUDL_PASSWORD
// Optional env var: HUDL_TEAM_URL
// Run: pnpm --filter @pll/ingest exec tsx src/scripts/syncHudl.ts [--headed] [--dry-run] [--db=<path>] [--team-id=<id>] [--all] [--hudl-url=<url>]
//
// What it does:
//   1. Launches Chromium via Playwright
//   2. Logs into hudl.com with coaching credentials
//   3. Navigates to one or more team roster/stats pages
//   4. Extracts roster (name, jersey, position) plus per-game player stats
//   5. Writes/updates players and player_stats in SQLite unless --dry-run is set
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
const DEFAULT_DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const HUDL_EMAIL = process.env.HUDL_EMAIL;
const HUDL_PASSWORD = process.env.HUDL_PASSWORD;
const HUDL_TEAM_URL = process.env.HUDL_TEAM_URL;
const DEFAULT_TEAM_NAME = 'Harriton';
const IMPORT_SOURCE = 'hudl';
const IMPORT_PARSER_VERSION = 'hudl-playwright-v0';
const TEAM_DELAY_MS = 30_000;

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
  all: boolean;
  teamId: string | null;
  hudlUrl: string | null;
  dbPath: string;
}

interface TeamRow {
  id: number;
  name: string;
  slug: string;
}

interface ManagedHudlTeamRow extends TeamRow {
  hudl_team_id: string;
  hudl_team_url: string;
  hudl_team_name: string | null;
  status: 'active' | 'paused' | 'error';
  last_synced: string | null;
  last_error: string | null;
}

interface HudlTarget {
  label: string;
  hudlUrl: string | null;
  managedTeamId: string | null;
  team: TeamRow | null;
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
  const headed = argv.includes('--headed');
  const dryRun = argv.includes('--dry-run');
  const all = argv.includes('--all');
  const teamId = argv.find((arg) => arg.startsWith('--team-id='))?.slice('--team-id='.length) ?? null;
  const hudlUrl = argv.find((arg) => arg.startsWith('--hudl-url='))?.slice('--hudl-url='.length) ?? null;
  const dbPath = argv.find((arg) => arg.startsWith('--db='))?.slice('--db='.length) ?? DEFAULT_DB_PATH;

  if (all && teamId) {
    throw new Error('Use either --all or --team-id=<id>, not both');
  }
  if (all && hudlUrl) {
    throw new Error('Use --hudl-url=<url> only for ad-hoc discovery runs, not with --all');
  }
  if (teamId && hudlUrl) {
    throw new Error('Use either --team-id=<id> or --hudl-url=<url>, not both');
  }

  return { headed, dryRun, all, teamId, hudlUrl, dbPath };
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

  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(HUDL_EMAIL ?? '');

  const continueBtn = page.locator('button[type="submit"]').first();
  await continueBtn.click();

  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(HUDL_PASSWORD ?? '');

  const loginBtn = page.locator('button[type="submit"]').first();
  await loginBtn.click();

  await page.waitForURL((url) => !url.href.includes('identity.hudl.com') && !url.href.includes('/login'), { timeout: 30000 });
  log.info(`[syncHudl] login successful url=${page.url()}`);
}

async function navigateToTeamStats(page: Page, hudlUrl: string | null): Promise<void> {
  log.info('[syncHudl] navigating to team area');
  if (hudlUrl) {
    await page.goto(hudlUrl, { waitUntil: 'networkidle' });
    log.info(`[syncHudl] opened hudl url=${hudlUrl}`);
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

  log.warn('[syncHudl] could not auto-find a team link from /home; set HUDL_TEAM_URL or pass --hudl-url=<url>');
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

function loadDefaultTeam(db: Database): TeamRow | null {
  const team = db
    .prepare('SELECT id, name, slug FROM teams WHERE name LIKE ? ORDER BY id LIMIT 1')
    .get(`%${DEFAULT_TEAM_NAME}%`) as TeamRow | undefined;
  return team ?? null;
}

function loadManagedTeam(db: Database, hudlTeamId: string): ManagedHudlTeamRow | null {
  const row = db
    .prepare(
      `SELECT
         ht.id AS hudl_team_id,
         ht.hudl_team_url,
         ht.hudl_team_name,
         ht.status,
         ht.last_synced,
         ht.last_error,
         t.id,
         t.name,
         t.slug
       FROM hudl_teams ht
       JOIN teams t ON t.id = ht.team_id
       WHERE ht.id = ?
       LIMIT 1`,
    )
    .get(hudlTeamId) as ManagedHudlTeamRow | undefined;
  return row ?? null;
}

function loadActiveManagedTeams(db: Database): ManagedHudlTeamRow[] {
  return db
    .prepare(
      `SELECT
         ht.id AS hudl_team_id,
         ht.hudl_team_url,
         ht.hudl_team_name,
         ht.status,
         ht.last_synced,
         ht.last_error,
         t.id,
         t.name,
         t.slug
       FROM hudl_teams ht
       JOIN teams t ON t.id = ht.team_id
       WHERE ht.status = 'active'
       ORDER BY COALESCE(ht.hudl_team_name, t.name), ht.id`,
    )
    .all() as ManagedHudlTeamRow[];
}

function markHudlTeamSuccess(dbPath: string, hudlTeamId: string): void {
  const db = openDb(dbPath);
  try {
    db.prepare("UPDATE hudl_teams SET last_synced = datetime('now'), last_error = NULL WHERE id = ?").run(hudlTeamId);
  } finally {
    db.close();
  }
}

function markHudlTeamError(dbPath: string, hudlTeamId: string, message: string): void {
  const db = openDb(dbPath);
  try {
    db.prepare("UPDATE hudl_teams SET status = 'error', last_error = ? WHERE id = ?").run(message, hudlTeamId);
  } finally {
    db.close();
  }
}

function resolveTargets(args: HudlArgs): HudlTarget[] {
  if (args.all) {
    const db = openDb(args.dbPath);
    try {
      return loadActiveManagedTeams(db).map((team) => ({
        label: team.hudl_team_name ?? team.name,
        hudlUrl: team.hudl_team_url,
        managedTeamId: team.hudl_team_id,
        team,
      }));
    } finally {
      db.close();
    }
  }

  if (args.teamId) {
    const db = openDb(args.dbPath);
    try {
      const team = loadManagedTeam(db, args.teamId);
      if (!team) {
        throw new Error(`Hudl team ${args.teamId} not found`);
      }
      return [{
        label: team.hudl_team_name ?? team.name,
        hudlUrl: team.hudl_team_url,
        managedTeamId: team.hudl_team_id,
        team,
      }];
    } finally {
      db.close();
    }
  }

  return [{
    label: args.hudlUrl ?? HUDL_TEAM_URL ?? DEFAULT_TEAM_NAME,
    hudlUrl: args.hudlUrl ?? HUDL_TEAM_URL ?? null,
    managedTeamId: null,
    team: null,
  }];
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
    return opponentToken
      ? candidateTokens.some((token) => token && (token === opponentToken || token.includes(opponentToken) || opponentToken.includes(token)))
      : dateToken === candidate.date;
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

function writeToDb(dbPath: string, team: TeamRow | null, roster: HudlPlayer[], games: HudlGame[], args: HudlArgs): void {
  if (args.dryRun) {
    log.info('[syncHudl] dry-run enabled; skipping all DB writes');
    log.info(`[syncHudl] dry-run roster=${roster.length} games=${games.length}`);
    return;
  }

  const db = openDb(dbPath);
  try {
    log.info(`[syncHudl] writing to db=${dbPath}`);
    const targetTeam = team ?? loadDefaultTeam(db);
    if (!targetTeam) {
      log.warn(`[syncHudl] ${DEFAULT_TEAM_NAME} not found in DB; skipping writes`);
      return;
    }

    upsertRosterPlayers(db, targetTeam.id, roster);
    const statResult = writeGameStats(db, targetTeam.id, games);
    log.info(`[syncHudl] upserted roster players=${roster.length} team=${targetTeam.name}`);
    log.info(`[syncHudl] upserted player_stats rows=${statResult.written} skipped_rows=${statResult.skipped}`);
  } finally {
    db.close();
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeTarget(page: Page, target: HudlTarget): Promise<{ roster: HudlPlayer[]; games: HudlGame[] }> {
  await navigateToTeamStats(page, target.hudlUrl);
  const roster = await scrapeRoster(page);
  logRosterPreview(roster);
  const games = await scrapeGameStats(page);
  logGamePreview(games);
  return { roster, games };
}

async function runTargets(args: HudlArgs, targets: HudlTarget[]): Promise<boolean> {
  let browser: Browser | null = null;
  let hadFailures = false;

  try {
    browser = await chromium.launch({ headless: !args.headed });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await login(page);

    for (const [index, target] of targets.entries()) {
      try {
        log.info(
          `[syncHudl] syncing target=${target.label} managedTeamId=${target.managedTeamId ?? 'ad-hoc'} url=${target.hudlUrl ?? 'auto'}`,
        );
        const { roster, games } = await scrapeTarget(page, target);
        writeToDb(args.dbPath, target.team, roster, games, args);
        if (target.managedTeamId) {
          markHudlTeamSuccess(args.dbPath, target.managedTeamId);
        }
      } catch (error) {
        hadFailures = true;
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[syncHudl] target failed target=${target.label}: ${message}`);
        if (target.managedTeamId) {
          markHudlTeamError(args.dbPath, target.managedTeamId, message);
        }
      }

      if (args.all && index < targets.length - 1) {
        log.info(`[syncHudl] rate limiting for ${TEAM_DELAY_MS / 1000}s before next team`);
        await sleep(TEAM_DELAY_MS);
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  return hadFailures;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!HUDL_EMAIL || !HUDL_PASSWORD) {
    log.error('HUDL_EMAIL and HUDL_PASSWORD env vars are required');
    log.error('Export them before running syncHudl');
    process.exit(1);
  }

  const targets = resolveTargets(args);
  log.info(
    `[syncHudl] starting db=${args.dbPath} headed=${args.headed} dryRun=${args.dryRun} all=${args.all} teamId=${args.teamId ?? 'n/a'} targets=${targets.length}`,
  );
  if (!targets.length) {
    log.warn('[syncHudl] no Hudl teams matched the requested scope');
    return;
  }
  if (!args.all && !targets[0]?.hudlUrl) {
    log.info('[syncHudl] no explicit Hudl URL set; auto-navigation will try to locate the team page from /home');
  }

  const hadFailures = await runTargets(args, targets);
  if (hadFailures) {
    process.exitCode = 1;
  } else {
    log.info('[syncHudl] complete');
  }
}

void main();
