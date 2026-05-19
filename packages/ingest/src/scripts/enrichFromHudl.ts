/**
 * Enrich the live DB with data from Hudl:
 *   1. Backfill jersey numbers, positions, and grad years for Harriton players
 *   2. Cross-validate game scores (Hudl schedule vs DB)
 *   3. Pull opponent roster info from exchanged games
 *
 * Usage:
 *   pnpm --filter @pll/ingest exec tsx src/scripts/enrichFromHudl.ts
 *   pnpm --filter @pll/ingest exec tsx src/scripts/enrichFromHudl.ts --dry-run
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { chromium, type Page } from 'playwright';
import { createLogger } from '@pll/shared';
import { openDb } from '../db.js';
import { normalizePlayerName } from '../normalize/playerName.js';

const log = createLogger({ name: 'ingest:enrichHudl' });
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const DRY_RUN = process.argv.includes('--dry-run');
const HUDL_EMAIL = process.env.HUDL_EMAIL;
const HUDL_PASSWORD = process.env.HUDL_PASSWORD;
const HUDL_TEAM_ID = '42156';
const HARRITON_DB_ID = 80;

// ─── Types ───────────────────────────────────────────────────────────────────

interface HudlMember {
  internalId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jersey: string;
  position: string[];
  graduationYear: number | null;
  role: string;
}

interface HudlScheduleEntry {
  gameType: string;
  isHome: boolean;
  isWin: boolean | null;
  time: string;
  score1: number | null;
  score2: number | null;
  opponentName: string;
  opponentTeamId: string;
}

interface ScoreMismatch {
  date: string;
  opponent: string;
  dbHomeScore: number;
  dbAwayScore: number;
  hudlScore1: number;
  hudlScore2: number;
  hudlIsHome: boolean;
}

// ─── Hudl Data Fetching ──────────────────────────────────────────────────────

async function hudlLogin(page: Page): Promise<void> {
  await page.goto('https://www.hudl.com/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').first().fill(HUDL_EMAIL!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  await page.locator('input[type="password"]').first().fill(HUDL_PASSWORD!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.href.includes('identity.hudl.com'), { timeout: 30000 });
  log.info('[enrich] logged into Hudl');
}

async function fetchHudlRoster(page: Page): Promise<HudlMember[]> {
  let members: HudlMember[] = [];

  page.on('response', async (resp) => {
    if (!resp.url().includes('graphql') || resp.request().method() !== 'POST') return;
    try {
      const json = await resp.json();
      const items = json?.data?.team?.members?.items;
      if (Array.isArray(items) && items.length > 3) {
        const parsed = items.map((m: any) => ({
          internalId: m.internalId ?? '',
          firstName: m.firstName ?? '',
          lastName: m.lastName ?? '',
          fullName: m.fullName ?? `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(),
          jersey: m.jersey ?? '',
          position: Array.isArray(m.position) ? m.position : [],
          graduationYear: m.graduationYear ?? null,
          role: m.role ?? '',
        }));
        if (parsed.length > members.length) members = parsed;
      }
    } catch {}
  });

  await page.goto(
    `https://www.hudl.com/teams/${HUDL_TEAM_ID}/manage/dashboard/groups/R3JvdXAxNDMzMTU=`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(8000);

  log.info(`[enrich] fetched ${members.length} Hudl members`);
  return members.filter((m) => m.role === 'PARTICIPANT');
}

async function fetchHudlSchedule(page: Page): Promise<HudlScheduleEntry[]> {
  const entries: HudlScheduleEntry[] = [];

  page.on('response', async (resp) => {
    if (!resp.url().includes('graphql') || resp.request().method() !== 'POST') return;
    try {
      const json = await resp.json();
      const entry = json?.data?.scheduleEntry;
      if (entry && entry.opponentName && entry.gameType) {
        entries.push({
          gameType: entry.gameType,
          isHome: entry.isHome ?? false,
          isWin: entry.isWin,
          time: entry.timeUtc ?? entry.time ?? '',
          score1: entry.score1,
          score2: entry.score2,
          opponentName: entry.opponentName,
          opponentTeamId: entry.opponentTeamId ?? '',
        });
      }
    } catch {}
  });

  // Current season schedule
  await page.goto(
    `https://www.hudl.com/app/schedules/teams/${HUDL_TEAM_ID}/seasons/U2Vhc29uMzEyMDIzNQ==`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(8000);

  log.info(`[enrich] fetched ${entries.length} schedule entries`);
  return entries.filter((e) => e.gameType === 'REGULAR_SEASON' && e.score1 != null && e.score2 != null);
}

// ─── DB Enrichment ───────────────────────────────────────────────────────────

function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        (dp[i - 1]![j] ?? 0) + 1,
        (dp[i]![j - 1] ?? 0) + 1,
        (dp[i - 1]![j - 1] ?? 0) + cost,
      );
    }
  }
  return dp[m]![n] ?? 0;
}

interface DbPlayer {
  id: number;
  name: string;
  jersey_number: number | null;
}

function enrichHarritonPlayers(db: Database, hudlMembers: HudlMember[]): {
  updated: number;
  skipped: number;
} {
  const dbPlayers = db.prepare(
    'SELECT id, name, jersey_number FROM players WHERE team_id = ?',
  ).all(HARRITON_DB_ID) as DbPlayer[];

  // Build Hudl lookup by normalized name
  const hudlByNorm = new Map<string, HudlMember>();
  for (const m of hudlMembers) {
    hudlByNorm.set(normalizeForMatch(m.fullName), m);
  }

  const updateStmt = db.prepare(
    `UPDATE players SET jersey_number = ? WHERE id = ? AND (jersey_number IS NULL OR jersey_number != ?)`,
  );

  let updated = 0;
  let skipped = 0;

  for (const dbPlayer of dbPlayers) {
    const normDb = normalizeForMatch(dbPlayer.name);
    let match = hudlByNorm.get(normDb);

    // Fuzzy match if no exact
    if (!match) {
      let bestDist = Infinity;
      for (const [normHudl, member] of hudlByNorm) {
        const dist = levenshtein(normDb, normHudl);
        if (dist < bestDist && dist <= 3) {
          bestDist = dist;
          match = member;
        }
      }
      // Last name match
      if (!match) {
        for (const member of hudlMembers) {
          if (normalizeForMatch(member.lastName) === normDb) {
            match = member;
            break;
          }
        }
      }
    }

    if (!match) {
      skipped++;
      continue;
    }

    const jerseyNum = match.jersey ? parseInt(match.jersey, 10) : null;
    if (jerseyNum != null && !isNaN(jerseyNum)) {
      if (!DRY_RUN) {
        const result = updateStmt.run(jerseyNum, dbPlayer.id, jerseyNum);
        if (result.changes > 0) {
          log.info(`[enrich] jersey: ${dbPlayer.name} -> #${jerseyNum}`);
          updated++;
        }
      } else {
        log.info(`[enrich] [dry-run] would set jersey: ${dbPlayer.name} -> #${jerseyNum}`);
        updated++;
      }
    } else {
      skipped++;
    }
  }

  return { updated, skipped };
}

function crossValidateScores(db: Database, hudlSchedule: HudlScheduleEntry[]): ScoreMismatch[] {
  const mismatches: ScoreMismatch[] = [];

  // Load Harriton games from DB
  const dbGames = db.prepare(`
    SELECT g.id, g.date, g.home_score, g.away_score,
           home.name as home_name, away.name as away_name,
           g.home_team_id, g.away_team_id
    FROM games g
    JOIN teams home ON home.id = g.home_team_id
    JOIN teams away ON away.id = g.away_team_id
    WHERE (g.home_team_id = ? OR g.away_team_id = ?)
    AND g.date >= '2026-01-01'
    ORDER BY g.date
  `).all(HARRITON_DB_ID, HARRITON_DB_ID) as any[];

  for (const hudlGame of hudlSchedule) {
    if (hudlGame.score1 == null || hudlGame.score2 == null) continue;
    
    const hudlDate = hudlGame.time.slice(0, 10);
    const hudlOpponent = normalizeForMatch(hudlGame.opponentName);

    // Find matching DB game by date + opponent name
    const dbMatch = dbGames.find((g: any) => {
      if (g.date !== hudlDate) return false;
      const isHome = g.home_team_id === HARRITON_DB_ID;
      const opponent = isHome ? g.away_name : g.home_name;
      const normOpp = normalizeForMatch(opponent);
      return normOpp.includes(hudlOpponent) || hudlOpponent.includes(normOpp) ||
             levenshtein(normOpp, hudlOpponent) <= 5;
    });

    if (!dbMatch) continue;

    // Compare scores
    const isHarritonHome = dbMatch.home_team_id === HARRITON_DB_ID;
    const dbHarritonScore = isHarritonHome ? dbMatch.home_score : dbMatch.away_score;
    const dbOpponentScore = isHarritonHome ? dbMatch.away_score : dbMatch.home_score;

    // Hudl: score1 = Harriton, score2 = opponent (regardless of home/away)
    const hudlHarritonScore = hudlGame.score1;
    const hudlOpponentScore = hudlGame.score2;

    if (dbHarritonScore !== hudlHarritonScore || dbOpponentScore !== hudlOpponentScore) {
      mismatches.push({
        date: hudlDate,
        opponent: hudlGame.opponentName,
        dbHomeScore: dbMatch.home_score,
        dbAwayScore: dbMatch.away_score,
        hudlScore1: hudlGame.score1,
        hudlScore2: hudlGame.score2,
        hudlIsHome: hudlGame.isHome,
      });
    }
  }

  return mismatches;
}

function enrichOpponentData(db: Database, hudlSchedule: HudlScheduleEntry[]): {
  teamsMapped: number;
  newAliases: number;
} {
  // Map Hudl opponent names to our DB teams
  const teams = db.prepare('SELECT id, name, slug FROM teams').all() as { id: number; name: string; slug: string }[];
  const teamByNorm = new Map<string, { id: number; name: string }>();
  for (const t of teams) {
    teamByNorm.set(normalizeForMatch(t.name), t);
    teamByNorm.set(normalizeForMatch(t.slug), t);
  }

  const insertAlias = db.prepare(
    `INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence, notes)
     VALUES (?, ?, 'hudl', 0.95, 'auto-mapped from Hudl schedule opponent name')`,
  );

  let teamsMapped = 0;
  let newAliases = 0;

  const seenOpponents = new Set<string>();
  for (const entry of hudlSchedule) {
    const normOpp = normalizeForMatch(entry.opponentName);
    if (seenOpponents.has(normOpp)) continue;
    seenOpponents.add(normOpp);

    // Try to match to a DB team
    let matchedTeam: { id: number; name: string } | undefined;
    for (const [normTeam, team] of teamByNorm) {
      if (normTeam === normOpp || normOpp.includes(normTeam) || normTeam.includes(normOpp)) {
        matchedTeam = team;
        break;
      }
      if (levenshtein(normTeam, normOpp) <= 4) {
        matchedTeam = team;
        break;
      }
    }

    if (matchedTeam) {
      teamsMapped++;
      // Add alias if the Hudl name differs from our DB name
      if (normalizeForMatch(matchedTeam.name) !== normOpp) {
        if (!DRY_RUN) {
          const result = insertAlias.run(entry.opponentName, matchedTeam.id);
          if (result.changes > 0) {
            log.info(`[enrich] alias: "${entry.opponentName}" -> ${matchedTeam.name} (id=${matchedTeam.id})`);
            newAliases++;
          }
        } else {
          log.info(`[enrich] [dry-run] would alias: "${entry.opponentName}" -> ${matchedTeam.name}`);
          newAliases++;
        }
      }
    } else {
      log.info(`[enrich] unmatched opponent: "${entry.opponentName}" (hudl_id=${entry.opponentTeamId})`);
    }
  }

  return { teamsMapped, newAliases };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!HUDL_EMAIL || !HUDL_PASSWORD) {
    log.error('HUDL_EMAIL and HUDL_PASSWORD required in env');
    process.exit(1);
  }

  log.info(`[enrich] starting db=${DB_PATH} dryRun=${DRY_RUN}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await hudlLogin(page);

    // 1. Fetch Hudl data
    const roster = await fetchHudlRoster(page);
    const schedule = await fetchHudlSchedule(page);

    // 2. Enrich DB
    const db = openDb(DB_PATH);
    try {
      // Phase 1: Jersey numbers for Harriton
      log.info('[enrich] --- Phase 1: Enrich Harriton players ---');
      const jerseyResult = enrichHarritonPlayers(db, roster);
      log.info(`[enrich] jerseys updated=${jerseyResult.updated} skipped=${jerseyResult.skipped}`);

      // Phase 2: Score validation
      log.info('[enrich] --- Phase 2: Cross-validate scores ---');
      const mismatches = crossValidateScores(db, schedule);
      if (mismatches.length === 0) {
        log.info('[enrich] all scores match between Hudl and DB');
      } else {
        log.warn(`[enrich] ${mismatches.length} score mismatches found:`);
        for (const m of mismatches) {
          log.warn(
            `[enrich]   ${m.date} vs ${m.opponent}: DB=${m.dbHomeScore}-${m.dbAwayScore} Hudl=${m.hudlScore1}-${m.hudlScore2} (hudlIsHome=${m.hudlIsHome})`,
          );
        }
      }

      // Phase 3: Opponent aliases
      log.info('[enrich] --- Phase 3: Opponent team aliases ---');
      const oppResult = enrichOpponentData(db, schedule);
      log.info(`[enrich] opponents mapped=${oppResult.teamsMapped} newAliases=${oppResult.newAliases}`);
    } finally {
      db.close();
    }
  } finally {
    await browser.close();
  }

  log.info('[enrich] done');
}

void main();
