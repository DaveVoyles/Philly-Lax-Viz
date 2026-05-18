/**
 * Export full Harriton lacrosse alumni database as CSV.
 *
 * Pulls roster data from Hudl (all seasons 2010-2026) enriched with
 * per-season stats from the local SQLite DB.
 *
 * Output: data/harriton-alumni.csv
 *
 * Usage:
 *   pnpm --filter @pll/ingest exec tsx src/scripts/exportHarritonAlumni.ts
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import type { Database } from 'better-sqlite3';
import { chromium } from 'playwright';
import { createLogger } from '@pll/shared';
import { openDb } from '../db.js';

const log = createLogger({ name: 'ingest:exportAlumni' });
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'harriton-alumni.csv');
const TEAM_ID = 80; // Harriton in our DB
const HUDL_TEAM_ID = '42156';

// Manual corrections for DB names that can't be fuzzy-matched
// (last-name-only entries from game summaries, known nicknames, etc.)
const MANUAL_NAME_MAP: Record<string, string> = {
  'Ragin-White': 'Jordan Ragin-White',
};

// Hudl season IDs mapped to academic years (from GraphQL discovery)
const HUDL_SEASONS: { value: string; year: number; description: string }[] = [
  { value: '3120235', year: 2025, description: '2025-2026' },
  { value: '2685044', year: 2024, description: '2024-2025' },
  { value: '2248384', year: 2023, description: '2023-2024' },
  { value: '1971662', year: 2022, description: '2022-2023' },
  { value: '1709609', year: 2021, description: '2021-2022' },
  { value: '1438247', year: 2020, description: '2020-2021' },
  { value: '1438246', year: 2019, description: '2019-2020' },
  { value: '1135664', year: 2018, description: '2018-2019' },
  { value: '1135665', year: 2017, description: '2017-2018' },
  { value: '1135666', year: 2016, description: '2016-2017' },
  { value: '213860', year: 2013, description: '2013-2014' },
  { value: '132486', year: 2012, description: '2012-2013' },
  { value: '57780', year: 2011, description: '2011-2012' },
  { value: '58294', year: 2010, description: '2010-2011' },
];

interface HudlAthlete {
  internalId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jersey: string;
  position: string[];
  graduationYear: number | null;
  seasonIds: string[];
  status: string;
}

interface DbStatRow {
  player_name: string;
  season: number;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
}

async function fetchHudlFullRoster(): Promise<HudlAthlete[]> {
  const email = process.env.HUDL_EMAIL;
  const password = process.env.HUDL_PASSWORD;
  if (!email || !password) {
    log.error('[alumni] HUDL_EMAIL/HUDL_PASSWORD required');
    process.exit(1);
  }

  log.info('[alumni] launching browser for Hudl roster...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let athletes: HudlAthlete[] = [];

  // Intercept the members response
  page.on('response', async (resp) => {
    if (!resp.url().includes('graphql') || resp.request().method() !== 'POST') return;
    try {
      const json = await resp.json();
      const members = json?.data?.team?.members?.items;
      if (Array.isArray(members) && members.length > 3) {
        const parsed = members
          .filter((m: any) => m.role === 'PARTICIPANT')
          .map((m: any) => ({
            internalId: m.internalId ?? '',
            firstName: m.firstName ?? '',
            lastName: m.lastName ?? '',
            fullName: m.fullName ?? `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim(),
            jersey: m.jersey ?? '',
            position: Array.isArray(m.position) ? m.position : [],
            graduationYear: m.graduationYear ?? null,
            seasonIds: Array.isArray(m.seasonIds) ? m.seasonIds : [],
            status: m.status ?? '',
          }));
        if (parsed.length > athletes.length) {
          athletes = parsed;
          log.info(`[alumni] captured ${athletes.length} athletes from GraphQL`);
        }
      }
    } catch {}
  });

  // Login
  await page.goto('https://www.hudl.com/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.href.includes('identity.hudl.com'), { timeout: 30000 });
  log.info('[alumni] logged in');

  // Navigate to the "All Team" group which should show all athletes across all seasons
  // Group ID R3JvdXAxNDMzMTU= is "All Team" (decoded: Group143315)
  await page.goto(
    `https://www.hudl.com/teams/${HUDL_TEAM_ID}/manage/dashboard/groups/R3JvdXAxNDMzMTU=`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(8000);

  if (athletes.length === 0) {
    // Fallback: try Athletes group
    log.info('[alumni] retrying with Athletes group...');
    await page.goto(
      `https://www.hudl.com/teams/${HUDL_TEAM_ID}/manage/dashboard/groups/R3JvdXAxNDMzMTc=`,
      { waitUntil: 'networkidle' },
    );
    await page.waitForTimeout(8000);
  }

  await browser.close();
  log.info(`[alumni] final roster: ${athletes.length} athletes`);
  return athletes;
}

function loadDbStats(db: Database): DbStatRow[] {
  return db.prepare(`
    SELECT 
      p.name as player_name,
      ps.season,
      COUNT(DISTINCT ps.game_id) as games_played,
      SUM(ps.goals) as goals,
      SUM(ps.assists) as assists,
      SUM(ps.goals) + SUM(ps.assists) as points,
      SUM(ps.ground_balls) as ground_balls,
      SUM(ps.caused_turnovers) as caused_turnovers,
      SUM(ps.saves) as saves,
      SUM(ps.fo_won) as fo_won,
      SUM(ps.fo_taken) as fo_taken
    FROM player_stats ps
    JOIN players p ON ps.player_id = p.id
    WHERE p.team_id = ?
    GROUP BY p.id, ps.season
    ORDER BY p.name, ps.season
  `).all(TEAM_ID) as DbStatRow[];
}

function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** Levenshtein distance for fuzzy name matching */
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

/** Find best fuzzy match for a DB name among Hudl athletes */
function fuzzyMatchHudl(dbName: string, hudlNames: Map<string, HudlAthlete>): HudlAthlete | null {
  // Check manual override first
  const manualName = MANUAL_NAME_MAP[dbName];
  if (manualName) {
    const manualNorm = normalizeForMatch(manualName);
    if (hudlNames.has(manualNorm)) return hudlNames.get(manualNorm)!;
  }

  const normDb = normalizeForMatch(dbName);

  // Exact match first
  if (hudlNames.has(normDb)) return hudlNames.get(normDb)!;

  // Check if DB name is a last-name-only match
  for (const [, athlete] of hudlNames) {
    const normLast = normalizeForMatch(athlete.lastName);
    if (normLast === normDb) return athlete;
  }

  // Check if DB name matches via nickname/abbreviation of first name
  // e.g., "Tenny Wolgin" -> "Tennessee Wolgin", "Mike Smith" -> "Michael Smith"
  const dbParts = dbName.trim().split(/\s+/);
  if (dbParts.length >= 2) {
    const dbFirst = normalizeForMatch(dbParts[0] ?? '');
    const dbLast = normalizeForMatch(dbParts.slice(1).join(''));
    for (const [, athlete] of hudlNames) {
      const hudlFirst = normalizeForMatch(athlete.firstName);
      const hudlLast = normalizeForMatch(athlete.lastName);
      if (levenshtein(dbLast, hudlLast) > 1) continue;
      // First name: prefix match (>= 3 chars shared) OR short Levenshtein
      const minLen = Math.min(dbFirst.length, hudlFirst.length);
      const sharedPrefix = dbFirst.slice(0, 3) === hudlFirst.slice(0, 3);
      const firstDist = levenshtein(dbFirst, hudlFirst);
      if (sharedPrefix && (firstDist <= 3 || hudlFirst.startsWith(dbFirst.slice(0, minLen - 1)))) {
        return athlete;
      }
    }
  }

  // Levenshtein fuzzy (threshold: max 3 edits or 25% of name length)
  let bestMatch: HudlAthlete | null = null;
  let bestDist = Infinity;
  for (const [normHudl, athlete] of hudlNames) {
    const dist = levenshtein(normDb, normHudl);
    const threshold = Math.max(3, Math.floor(normDb.length * 0.25));
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      bestMatch = athlete;
    }
  }
  return bestMatch;
}

function seasonYearFromId(seasonId: string): number | null {
  const match = HUDL_SEASONS.find((s) => s.value === seasonId);
  return match?.year ?? null;
}

function seasonDescription(year: number): string {
  return `${year}-${year + 1}`;
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes("'")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main(): Promise<void> {
  log.info(`[alumni] starting export db=${DB_PATH}`);

  // 1. Fetch full Hudl roster (all seasons)
  const hudlAthletes = await fetchHudlFullRoster();

  // 2. Load DB stats
  const db = openDb(DB_PATH);
  const dbStats = loadDbStats(db);
  db.close();
  log.info(`[alumni] DB stats: ${dbStats.length} player-season rows`);

  // Build stat lookup: normalizedName -> season -> stats
  const statLookup = new Map<string, Map<number, DbStatRow>>();
  const dbOriginalNames = new Map<string, string>(); // norm -> original
  for (const row of dbStats) {
    const key = normalizeForMatch(row.player_name);
    if (!statLookup.has(key)) statLookup.set(key, new Map());
    statLookup.get(key)!.set(row.season, row);
    dbOriginalNames.set(key, row.player_name);
  }

  // Build Hudl name lookup for fuzzy matching
  const hudlByNorm = new Map<string, HudlAthlete>();
  for (const a of hudlAthletes) {
    hudlByNorm.set(normalizeForMatch(a.fullName), a);
  }

  // Pre-compute fuzzy matches: DB normalized name -> Hudl athlete
  const dbToHudl = new Map<string, HudlAthlete>();
  for (const normKey of statLookup.keys()) {
    const originalName = dbOriginalNames.get(normKey) ?? normKey;
    const match = fuzzyMatchHudl(originalName, hudlByNorm);
    if (match) {
      dbToHudl.set(normKey, match);
      log.info(`[alumni] fuzzy match: "${originalName}" -> "${match.fullName}"`);
    }
  }

  // Reverse map: hudl norm name -> all DB stat keys that match it
  const hudlToDbKeys = new Map<string, string[]>();
  for (const [dbKey, hudlAthlete] of dbToHudl) {
    const hudlKey = normalizeForMatch(hudlAthlete.fullName);
    if (!hudlToDbKeys.has(hudlKey)) hudlToDbKeys.set(hudlKey, []);
    hudlToDbKeys.get(hudlKey)!.push(dbKey);
  }

  // 3. Build CSV rows — one row per player per season they were active
  const headers = [
    'name',
    'first_name',
    'last_name',
    'jersey_number',
    'position',
    'graduation_year',
    'season',
    'season_year',
    'games_played',
    'goals',
    'assists',
    'points',
    'ground_balls',
    'caused_turnovers',
    'saves',
    'fo_won',
    'fo_taken',
    'fo_pct',
    'hudl_id',
    'data_source',
  ];

  const rows: string[][] = [];
  const processedNames = new Set<string>();

  // Process Hudl athletes (primary source for roster completeness)
  for (const athlete of hudlAthletes) {
    const normName = normalizeForMatch(athlete.fullName);
    processedNames.add(normName);

    // Determine which seasons this athlete was active
    const activeSeasons: number[] = [];
    for (const sid of athlete.seasonIds) {
      const year = seasonYearFromId(sid);
      if (year != null) activeSeasons.push(year);
    }

    if (activeSeasons.length === 0) {
      // No season mapping — just include with graduation year
      const seasonGuess = athlete.graduationYear ? athlete.graduationYear - 1 : null;
      rows.push([
        athlete.fullName,
        athlete.firstName,
        athlete.lastName,
        athlete.jersey,
        athlete.position.join('/'),
        athlete.graduationYear != null ? String(athlete.graduationYear) : '',
        seasonGuess != null ? seasonDescription(seasonGuess) : '',
        seasonGuess != null ? String(seasonGuess) : '',
        '0', '0', '0', '0', '0', '0', '0', '0', '0', '',
        athlete.internalId,
        'hudl',
      ]);
      continue;
    }

    for (const year of activeSeasons.sort()) {
      // Check if we have stats from DB for this player+season (using fuzzy match)
      const dbKeys = hudlToDbKeys.get(normName) ?? [normName];
      let dbRow: DbStatRow | undefined;
      for (const dbKey of dbKeys) {
        dbRow = statLookup.get(dbKey)?.get(year + 1) ?? statLookup.get(dbKey)?.get(year);
        if (dbRow) break;
      }
      const foPct = dbRow && dbRow.fo_taken > 0 ? ((dbRow.fo_won / dbRow.fo_taken) * 100).toFixed(1) : '';

      rows.push([
        athlete.fullName,
        athlete.firstName,
        athlete.lastName,
        athlete.jersey,
        athlete.position.join('/'),
        athlete.graduationYear != null ? String(athlete.graduationYear) : '',
        seasonDescription(year),
        String(year),
        dbRow ? String(dbRow.games_played) : '0',
        dbRow ? String(dbRow.goals) : '0',
        dbRow ? String(dbRow.assists) : '0',
        dbRow ? String(dbRow.points) : '0',
        dbRow ? String(dbRow.ground_balls) : '0',
        dbRow ? String(dbRow.caused_turnovers) : '0',
        dbRow ? String(dbRow.saves) : '0',
        dbRow ? String(dbRow.fo_won) : '0',
        dbRow ? String(dbRow.fo_taken) : '0',
        foPct,
        athlete.internalId,
        dbRow ? 'hudl+stats' : 'hudl',
      ]);
    }
  }

  // Add DB-only players not found in Hudl (skip those already fuzzy-matched)
  const matchedDbKeys = new Set([...dbToHudl.keys()]);
  for (const row of dbStats) {
    const normName = normalizeForMatch(row.player_name);
    if (processedNames.has(normName)) continue;
    if (matchedDbKeys.has(normName)) continue; // already merged into a Hudl athlete row
    processedNames.add(normName);

    // Apply manual name corrections for DB-only players
    const displayName = MANUAL_NAME_MAP[row.player_name] ?? row.player_name;
    const foPct = row.fo_taken > 0 ? ((row.fo_won / row.fo_taken) * 100).toFixed(1) : '';
    const nameParts = displayName.split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ');

    rows.push([
      displayName,
      firstName,
      lastName,
      '',
      '',
      '',
      seasonDescription(row.season - 1),
      String(row.season),
      String(row.games_played),
      String(row.goals),
      String(row.assists),
      String(row.points),
      String(row.ground_balls),
      String(row.caused_turnovers),
      String(row.saves),
      String(row.fo_won),
      String(row.fo_taken),
      foPct,
      '',
      'phillylacrosse/laxnumbers',
    ]);
  }

  // Sort by name, then season
  rows.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? '') || (a[7] ?? '').localeCompare(b[7] ?? ''));

  const csvContent = [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
  fs.writeFileSync(OUTPUT_PATH, csvContent + '\n', 'utf-8');
  log.info(`[alumni] wrote ${rows.length} rows (${new Set(rows.map(r => r[0])).size} unique players) to ${OUTPUT_PATH}`);
}

void main();
