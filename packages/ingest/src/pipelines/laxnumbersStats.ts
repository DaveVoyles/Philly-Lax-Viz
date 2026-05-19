// laxnumbersStats.ts — Pipeline for scraping per-game player stats from LaxNumbers.
//
// STATUS: Scaffold only. Depends on:
//   1. Discovering game_id from the scoreboard API or constructing game URLs
//   2. A working box score parser (see parsers/laxnumbersBoxScore.ts)
//   3. Player resolution logic (fuzzy matching LaxNumbers names to our players table)
//
// Architecture:
//   1. Query games table for rows with source='laxnumbers' AND no player_stats
//   2. For each game, construct the game page URL using laxnumbers_game_id
//   3. Fetch + parse the box score HTML
//   4. Resolve players via name matching (exact normalized match first, then fuzzy)
//   5. Write to player_stats with source='laxnumbers', respecting authority precedence:
//      coach_upload > phillylacrosse > laxnumbers > hudl

import type { Database as DatabaseType } from 'better-sqlite3';
import type { ParsedBoxScore, BoxScorePlayerStat } from '../parsers/laxnumbersBoxScore.js';

export interface LaxNumbersStatsOpts {
  /** Actually write to DB. Default: false (dry-run). */
  apply: boolean;
  /** Max games to process per run (rate limiting). */
  limit?: number;
  /** Delay between requests in ms. Default: 2000. */
  delayMs?: number;
  /** Fetch override for testing. */
  fetch?: typeof globalThis.fetch;
}

export interface LaxNumbersStatsResult {
  gamesProcessed: number;
  playersResolved: number;
  playersCreated: number;
  statsWritten: number;
  skipped: {
    noGameId: number;
    fetchError: number;
    parseError: number;
    alreadyHasStats: number;
  };
  anomalies: Array<{ kind: string; detail: string }>;
}

interface GameRow {
  id: number;
  date: string;
  home_team_id: number;
  away_team_id: number;
  laxnumbers_game_id: string | null;
}

/**
 * Find games sourced from LaxNumbers that don't yet have player stats.
 */
function findGamesNeedingStats(db: DatabaseType, limit: number): GameRow[] {
  return db.prepare(`
    SELECT g.id, g.date, g.home_team_id, g.away_team_id, g.laxnumbers_game_id
    FROM games g
    WHERE g.source = 'laxnumbers'
      AND g.laxnumbers_game_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM player_stats ps
        WHERE ps.game_id = g.id AND ps.source = 'laxnumbers'
      )
    ORDER BY g.date DESC
    LIMIT ?
  `).all(limit) as GameRow[];
}

/**
 * Resolve a LaxNumbers player name to an existing player_id, or return null.
 * Uses exact normalized match against players for the given team.
 */
function resolvePlayer(
  db: DatabaseType,
  playerName: string,
  teamId: number,
): number | null {
  const normalized = playerName.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const row = db.prepare(
    `SELECT id FROM players WHERE team_id = ? AND name_normalized = ?`,
  ).get(teamId, normalized) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Run the LaxNumbers player stats pipeline.
 *
 * TODO: Complete implementation once box score parser is functional.
 */
export async function runLaxNumbersStats(
  db: DatabaseType,
  opts: LaxNumbersStatsOpts,
): Promise<LaxNumbersStatsResult> {
  const limit = opts.limit ?? 20;
  const _delayMs = opts.delayMs ?? 2000;

  const result: LaxNumbersStatsResult = {
    gamesProcessed: 0,
    playersResolved: 0,
    playersCreated: 0,
    statsWritten: 0,
    skipped: { noGameId: 0, fetchError: 0, parseError: 0, alreadyHasStats: 0 },
    anomalies: [],
  };

  const games = findGamesNeedingStats(db, limit);
  if (games.length === 0) return result;

  // TODO: For each game:
  //   1. Construct URL from laxnumbers_game_id
  //   2. Fetch page HTML
  //   3. Parse with parseBoxScore()
  //   4. Resolve home/away players
  //   5. Write player_stats rows (if opts.apply)
  result.anomalies.push({
    kind: 'not_implemented',
    detail: `Found ${games.length} games needing stats but parser is not yet implemented`,
  });

  return result;
}

// Re-export types for consumers
export type { ParsedBoxScore, BoxScorePlayerStat };
