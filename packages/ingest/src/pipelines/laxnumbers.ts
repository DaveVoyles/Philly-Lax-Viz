// laxnumbers.ts — Additive ingest pipeline for LaxNumbers PA Boys HS games.
// Rules:
//   - Never overwrite existing PhillyLacrosse data; fill score gaps only.
//   - Never create new teams; skip games where either team is unresolved.
//   - PA Boys HS only (level_desc='Boys HS', at least one of home_state/visitor_state='PA').
//   - Skip postponed games.

import type { Database as DatabaseType } from 'better-sqlite3';
import { findTeamByName } from './teamResolver.js';

const SCOREBOARD_URL = 'https://laxnumbers.com/services/scoreboard/3453';
const USER_AGENT =
  'PhillyLacrosseVis/1.0 (data-aggregation; github.com/phillylacrosse)';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Raw shape returned by the LaxNumbers scoreboard API. */
interface LaxRawGame {
  home_team_name: string;
  visitor_team_name: string;
  home_state: string;
  visitor_state: string;
  level_desc: string;
  game_home_score: number;
  game_visitor_score: number;
  game_date: string; // "YYYYMMDD"
  game_postponed: number; // 0 or 1
}

export interface LaxNumbersOpts {
  /** Single-day ingest (YYYY-MM-DD). Mutually exclusive with since/until. */
  date?: string;
  /** Start of inclusive date range (YYYY-MM-DD). */
  since?: string;
  /** End of inclusive date range (YYYY-MM-DD). */
  until?: string;
  /** Actually write to the DB. Default: false (dry-run). */
  apply: boolean;
  /** Fetch override for testing. Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface LaxNumbersAnomaly {
  kind: string;
  detail: string;
}

export interface LaxNumbersResult {
  /** Total game records returned by the API across all dates. */
  fetched: number;
  /** Games passing Boys-HS + PA + non-postponed filters. */
  paGames: number;
  /** Games where both teams resolved to a known DB row. */
  resolvedGames: number;
  inserted: number;
  updated: number;
  skipped: {
    /** Non Boys-HS or neither team in PA. */
    nonPA: number;
    postponed: number;
    unknownTeam: number;
    /** Row already has non-zero scores — additive policy: don't overwrite. */
    alreadyComplete: number;
  };
  anomalies: LaxNumbersAnomaly[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "20260415" → "2026-04-15" */
function laxDateToIso(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Yield dates (YYYY-MM-DD) from since to until inclusive. */
function* iterateDates(since: string, until: string): Generator<string> {
  const end = new Date(until + 'T00:00:00Z');
  let cur = new Date(since + 'T00:00:00Z');
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/** Fetch games for a single date with retry on 429/5xx. */
async function fetchGamesForDate(
  date: string,
  fetchFn: typeof globalThis.fetch,
): Promise<LaxRawGame[]> {
  const url = `${SCOREBOARD_URL}?date=${date}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      clearTimeout(timer);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as LaxRawGame[];
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`fetch failed for ${url}`);
}

interface ExistingGame {
  id: number;
  home_score: number;
  away_score: number;
  source: string;
  /** true when the DB row is stored with home/away swapped vs. laxnumbers' ordering */
  reversed: boolean;
}

/**
 * Look up an existing game row by (home, away, date) OR (away, home, date).
 * Returns null if no matching row exists.
 */
function lookupExistingGame(
  db: DatabaseType,
  homeTeamId: number,
  awayTeamId: number,
  date: string,
): ExistingGame | null {
  const row = db
    .prepare(
      `SELECT id, home_score, away_score, source,
              CASE WHEN home_team_id = @h AND away_team_id = @a THEN 0 ELSE 1 END AS reversed
       FROM games
       WHERE date = @date AND (
         (home_team_id = @h AND away_team_id = @a) OR
         (home_team_id = @a AND away_team_id = @h)
       )
       LIMIT 1`,
    )
    .get({ h: homeTeamId, a: awayTeamId, date }) as
    | (Omit<ExistingGame, 'reversed'> & { reversed: 0 | 1 })
    | undefined;
  if (!row) return null;
  return { ...row, reversed: row.reversed === 1 };
}

// ─── DB write helpers (only called inside a transaction when apply=true) ─────

interface InsertParams {
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  parsedAt: string;
}

function execInsert(db: DatabaseType, p: InsertParams): void {
  db.prepare(
    `INSERT INTO games
       (date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, parsed_at, season, source)
     VALUES (?, ?, ?, ?, ?, 0, 0, '', ?, 2026, 'laxnumbers')
     ON CONFLICT(date, home_team_id, away_team_id) DO NOTHING`,
  ).run(p.date, p.homeTeamId, p.awayTeamId, p.homeScore, p.awayScore, p.parsedAt);
}

interface UpdateParams {
  id: number;
  homeScore: number;
  awayScore: number;
  parsedAt: string;
}

function execUpdate(db: DatabaseType, p: UpdateParams): void {
  // Guard: only update if scores are still 0/0 (double-check in SQL).
  db.prepare(
    `UPDATE games
     SET home_score = ?, away_score = ?, source = 'laxnumbers', parsed_at = ?
     WHERE id = ? AND home_score = 0 AND away_score = 0`,
  ).run(p.homeScore, p.awayScore, p.parsedAt, p.id);
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Run the LaxNumbers PA-only additive ingest pipeline.
 *
 * When `opts.apply` is false (default), counts what *would* happen without
 * writing. When true, all writes are executed in a single transaction.
 */
export async function runLaxNumbersIngest(
  db: DatabaseType,
  opts: LaxNumbersOpts,
): Promise<LaxNumbersResult> {
  const fetchFn = opts.fetch ?? globalThis.fetch;

  const result: LaxNumbersResult = {
    fetched: 0,
    paGames: 0,
    resolvedGames: 0,
    inserted: 0,
    updated: 0,
    skipped: { nonPA: 0, postponed: 0, unknownTeam: 0, alreadyComplete: 0 },
    anomalies: [],
  };

  // Resolve date(s) to process
  const dates: string[] = [];
  if (opts.date) {
    dates.push(opts.date);
  } else if (opts.since && opts.until) {
    for (const d of iterateDates(opts.since, opts.until)) dates.push(d);
  } else {
    throw new Error(
      'runLaxNumbersIngest: supply opts.date or opts.since + opts.until',
    );
  }

  const pendingInserts: InsertParams[] = [];
  const pendingUpdates: UpdateParams[] = [];
  const now = new Date().toISOString();

  for (const date of dates) {
    let games: LaxRawGame[];
    try {
      games = await fetchGamesForDate(date, fetchFn);
    } catch (err) {
      result.anomalies.push({
        kind: 'fetch_error',
        detail: `date=${date} error=${(err as Error).message}`,
      });
      continue;
    }
    result.fetched += games.length;

    for (const g of games) {
      // ── Filter: Boys HS only ───────────────────────────────────────────────
      if (g.level_desc !== 'Boys HS') {
        result.skipped.nonPA++;
        continue;
      }
      // ── Filter: at least one PA team ──────────────────────────────────────
      if (g.home_state !== 'PA' && g.visitor_state !== 'PA') {
        result.skipped.nonPA++;
        continue;
      }
      // ── Filter: postponed ─────────────────────────────────────────────────
      if (g.game_postponed) {
        result.skipped.postponed++;
        continue;
      }

      result.paGames++;

      const isoDate = laxDateToIso(g.game_date);

      // ── Resolve teams — no insert allowed ─────────────────────────────────
      const homeTeam = findTeamByName(db, g.home_team_name);
      const visitorTeam = findTeamByName(db, g.visitor_team_name);

      if (!homeTeam || !visitorTeam) {
        const detail = !homeTeam
          ? `unknown home team: "${g.home_team_name}"`
          : `unknown visitor team: "${g.visitor_team_name}"`;
        result.skipped.unknownTeam++;
        result.anomalies.push({
          kind: 'unknown_team',
          detail: `date=${isoDate} ${detail}`,
        });
        continue;
      }

      result.resolvedGames++;

      // ── Lookup existing game (forward + reverse) ───────────────────────────
      const existing = lookupExistingGame(db, homeTeam.id, visitorTeam.id, isoDate);

      if (existing) {
        const hasScore = existing.home_score > 0 || existing.away_score > 0;
        if (hasScore) {
          result.skipped.alreadyComplete++;
          continue;
        }
        // Row exists but has no scores — fill them in.
        // If the DB row is stored reversed, swap which score goes where.
        const homeScore = existing.reversed
          ? g.game_visitor_score
          : g.game_home_score;
        const awayScore = existing.reversed
          ? g.game_home_score
          : g.game_visitor_score;
        pendingUpdates.push({ id: existing.id, homeScore, awayScore, parsedAt: now });
        result.updated++;
      } else {
        // No existing row — INSERT.
        pendingInserts.push({
          date: isoDate,
          homeTeamId: homeTeam.id,
          awayTeamId: visitorTeam.id,
          homeScore: g.game_home_score,
          awayScore: g.game_visitor_score,
          parsedAt: now,
        });
        result.inserted++;
      }
    }
  }

  // ── Apply writes in a single transaction ────────────────────────────────
  if (opts.apply && (pendingInserts.length > 0 || pendingUpdates.length > 0)) {
    const tx = db.transaction(() => {
      for (const p of pendingInserts) execInsert(db, p);
      for (const p of pendingUpdates) execUpdate(db, p);
    });
    tx();
  }

  return result;
}
