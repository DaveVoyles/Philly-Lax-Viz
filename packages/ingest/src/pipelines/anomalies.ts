// anomalies.ts — helpers for the `ingest_anomalies` table.

import type { Database } from 'better-sqlite3';
import type { ParserStrategy } from '@pll/shared';
import type { LaxNumbersAnomaly } from './laxnumbers.js';

const LAXNUMBERS_SOURCE_URL = 'https://laxnumbers.com/services/scoreboard/3453';
/** Synthetic source_post_id used for all LaxNumbers anomalies so they can be
 *  cleared and replaced atomically each nightly run. */
const LAXNUMBERS_POST_ID = 'laxnumbers';

export interface AnomalyInput {
  sourcePostId: string;
  sourceUrl: string;
  rawLine: string;
  parentGameId: number | null;
  strategyAttempted: ParserStrategy;
  reason: string;
}

/** Insert one anomaly row; returns 1 (for caller bookkeeping). */
export function insertAnomaly(db: Database, a: AnomalyInput): 1 {
  db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id,
        strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.sourcePostId,
    a.sourceUrl,
    a.rawLine,
    a.parentGameId,
    a.strategyAttempted,
    a.reason,
    new Date().toISOString(),
  );
  return 1;
}

/**
 * Persist LaxNumbers unknown-team anomalies into `ingest_anomalies`.
 * Clears the previous batch (keyed on LAXNUMBERS_POST_ID) then inserts fresh
 * rows so nightly re-runs are idempotent.
 * Only called when the CLI is run with --apply.
 */
export function persistLaxNumbersAnomalies(
  db: Database,
  anomalies: LaxNumbersAnomaly[],
): number {
  const unknownTeam = anomalies.filter((a) => a.kind === 'unknown_team');
  if (unknownTeam.length === 0) return 0;

  clearAnomaliesForPost(db, LAXNUMBERS_POST_ID);
  const stmt = db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id,
        strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  );
  const strategy: ParserStrategy = 'laxnumbers-unknown-team';
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const a of unknownTeam) {
      stmt.run(
        LAXNUMBERS_POST_ID,
        LAXNUMBERS_SOURCE_URL,
        a.detail,
        strategy,
        a.detail,
        now,
      );
    }
  });
  tx();
  return unknownTeam.length;
}

/**
 * Replace existing anomaly rows for a given (source_post_id) with the new
 * batch. Used by pipelines so re-runs don't accumulate duplicate anomalies.
 */
export function clearAnomaliesForPost(db: Database, postId: string): void {
  db.prepare('DELETE FROM ingest_anomalies WHERE source_post_id = ?').run(postId);
}
