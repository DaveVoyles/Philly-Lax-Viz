/**
 * reconcileTeamScores.ts — build a manual review queue of games whose recorded
 * team score is LESS than the sum of per-player goals credited to that team.
 *
 * Policy (user-ratified, Wave H3):
 *   When phillylacrosse.com per-player goal logs sum > that team's posted
 *   game score, we trust the per-player stats (consistent with the existing
 *   PIAA team-record override in packages/server/src/routes/teams.ts) and
 *   treat the team score as potentially corrupted. Actual reconciliation
 *   against PIAA district → MaxPreps is MANUAL — this script only emits a
 *   review queue; it never mutates `games`.
 *
 * Output:
 *   .github/docs/2026-04-23-team-score-reconcile-queue.json
 *
 * Usage:
 *   DB_PATH=./data/lacrosse.db pnpm --filter @pll/ingest exec tsx \
 *     src/scripts/reconcileTeamScores.ts
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';

export interface SuspectRow {
  gameId: number;
  date: string;
  teamId: number;
  teamName: string;
  opponentName: string;
  currentScore: number;
  playerGoalsSum: number;
  suspectDelta: number;
  sourcePostUrl: string | null;
}

interface RawGame {
  game_id: number;
  date: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  home_name: string;
  away_name: string;
  recap_url: string | null;
  postponed: number;
  home_goals_sum: number;
  away_goals_sum: number;
}

/**
 * Scan all non-postponed games and return one SuspectRow per team-game whose
 * per-player goal sum exceeds the recorded team_score.
 *
 * Exported for testability.
 */
export function findSuspectRows(db: DatabaseType): SuspectRow[] {
  const rows = db
    .prepare(
      `SELECT g.id                                AS game_id,
              g.date                              AS date,
              g.home_team_id                      AS home_team_id,
              g.away_team_id                      AS away_team_id,
              g.home_score                        AS home_score,
              g.away_score                        AS away_score,
              ht.name                             AS home_name,
              at.name                             AS away_name,
              g.recap_url                         AS recap_url,
              g.postponed                         AS postponed,
              COALESCE((SELECT SUM(ps.goals)
                          FROM player_stats ps
                          JOIN players p ON p.id = ps.player_id
                         WHERE ps.game_id = g.id
                           AND p.team_id  = g.home_team_id), 0) AS home_goals_sum,
              COALESCE((SELECT SUM(ps.goals)
                          FROM player_stats ps
                          JOIN players p ON p.id = ps.player_id
                         WHERE ps.game_id = g.id
                           AND p.team_id  = g.away_team_id), 0) AS away_goals_sum
         FROM games g
         JOIN teams ht ON ht.id = g.home_team_id
         JOIN teams at ON at.id = g.away_team_id
        WHERE g.postponed = 0`,
    )
    .all() as RawGame[];

  const suspects: SuspectRow[] = [];
  for (const r of rows) {
    if (r.home_goals_sum > r.home_score) {
      suspects.push({
        gameId: r.game_id,
        date: r.date,
        teamId: r.home_team_id,
        teamName: r.home_name,
        opponentName: r.away_name,
        currentScore: r.home_score,
        playerGoalsSum: r.home_goals_sum,
        suspectDelta: r.home_goals_sum - r.home_score,
        sourcePostUrl: r.recap_url,
      });
    }
    if (r.away_goals_sum > r.away_score) {
      suspects.push({
        gameId: r.game_id,
        date: r.date,
        teamId: r.away_team_id,
        teamName: r.away_name,
        opponentName: r.home_name,
        currentScore: r.away_score,
        playerGoalsSum: r.away_goals_sum,
        suspectDelta: r.away_goals_sum - r.away_score,
        sourcePostUrl: r.recap_url,
      });
    }
  }

  suspects.sort((a, b) =>
    b.suspectDelta - a.suspectDelta || a.gameId - b.gameId || a.teamId - b.teamId,
  );
  return suspects;
}

/** Count non-postponed games scanned. Exported for summary printing/tests. */
export function countScannedGames(db: DatabaseType): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM games WHERE postponed = 0`)
    .get() as { n: number };
  return row.n;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src/scripts → repo root is ../../../..
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const DEFAULT_OUT = resolve(
  REPO_ROOT,
  '.github/docs/2026-04-23-team-score-reconcile-queue.json',
);

function main(): void {
  const dbPath = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? './data/lacrosse.db';
  const outPath = process.env.RECONCILE_OUT ?? DEFAULT_OUT;

  const db = openDb(resolve(dbPath));
  try {
    const scanned = countScannedGames(db);
    const suspects = findSuspectRows(db);

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(suspects, null, 2)}\n`, 'utf8');

    console.log(`reconcile: scanned ${scanned} games, ${suspects.length} suspect team-game rows`);
    console.log(`reconcile: queue written to ${outPath}`);
  } finally {
    db.close();
  }
}

// Run only when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
