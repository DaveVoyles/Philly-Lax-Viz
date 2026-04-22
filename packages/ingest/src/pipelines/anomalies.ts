// anomalies.ts — single insertion helper for the `ingest_anomalies` table.

import type { Database } from 'better-sqlite3';
import type { ParserStrategy } from '@pll/shared';

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
 * Replace existing anomaly rows for a given (source_post_id) with the new
 * batch. Used by pipelines so re-runs don't accumulate duplicate anomalies.
 */
export function clearAnomaliesForPost(db: Database, postId: string): void {
  db.prepare('DELETE FROM ingest_anomalies WHERE source_post_id = ?').run(postId);
}
