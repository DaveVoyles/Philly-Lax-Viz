// seasons.ts — helpers for the season query parameter introduced in W13.
//
// Seasons are integer years (e.g. 2024, 2025, 2026) materialized on rows in
// `games`, `player_stats`, and `ingest_post_log` by migration 006. The web UI
// passes `?season=YYYY`; servers default to the most recent season that has
// observed games.

import type { Database } from 'better-sqlite3';

/** All distinct seasons present in the games table, newest first. */
export function listSeasons(db: Database): number[] {
  const rows = db
    .prepare('SELECT DISTINCT season FROM games ORDER BY season DESC')
    .all() as Array<{ season: number }>;
  return rows.map((r) => r.season);
}

/** Most recent season with at least one game; null if no games exist. */
export function defaultSeason(db: Database): number | null {
  const seasons = listSeasons(db);
  return seasons[0] ?? null;
}

/**
 * Parse and validate a `?season=YYYY` query value.
 *  - undefined / empty → undefined (caller decides default)
 *  - "all" → null (explicit "no filter")
 *  - 4-digit year in [2000, 2100] → number
 *  - anything else → throws
 */
export function parseSeasonParam(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'all') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new Error(`Invalid season "${raw}" — expected a 4-digit year or "all"`);
  }
  return n;
}

/**
 * Resolve the effective season for a request: explicit value wins, otherwise
 * fall back to the DB's default season. Returns `null` if the caller asked
 * for "all" or the DB has no data.
 */
export function resolveSeason(
  db: Database,
  raw: string | undefined,
): number | null {
  const parsed = parseSeasonParam(raw);
  if (parsed === null) return null;
  if (parsed !== undefined) return parsed;
  return defaultSeason(db);
}
