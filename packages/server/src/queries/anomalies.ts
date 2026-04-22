// Aggregate queries for the /anomalies maintainer browser page.
// Returns counts grouped by reason plus the most-frequent raw lines.

import type { Database } from 'better-sqlite3';

export interface AnomalySummary {
  totalCount: number;
  byReason: { reason: string; count: number }[];
  topRawLines: {
    rawLine: string;
    reason: string;
    count: number;
    exampleSourceUrl: string | null;
  }[];
}

export interface AnomalySummaryOptions {
  limit: number;
  reason?: string;
}

interface CountRow {
  c: number;
}
interface ByReasonRow {
  reason: string;
  cnt: number;
}
interface TopRawRow {
  raw_line: string;
  reason: string;
  cnt: number;
  example_url: string | null;
}

export function getAnomalySummary(db: Database, opts: AnomalySummaryOptions): AnomalySummary {
  const reason = opts.reason?.trim();
  const useFilter = reason !== undefined && reason !== '';

  const totalRow = useFilter
    ? (db
        .prepare('SELECT COUNT(*) AS c FROM ingest_anomalies WHERE reason = ?')
        .get(reason) as CountRow)
    : (db.prepare('SELECT COUNT(*) AS c FROM ingest_anomalies').get() as CountRow);
  const totalCount = totalRow.c;

  const byReasonRows = useFilter
    ? (db
        .prepare(
          `SELECT reason, COUNT(*) AS cnt
           FROM ingest_anomalies
           WHERE reason = ?
           GROUP BY reason
           ORDER BY cnt DESC, reason ASC`,
        )
        .all(reason) as ByReasonRow[])
    : (db
        .prepare(
          `SELECT reason, COUNT(*) AS cnt
           FROM ingest_anomalies
           GROUP BY reason
           ORDER BY cnt DESC, reason ASC`,
        )
        .all() as ByReasonRow[]);

  const topRawRows = useFilter
    ? (db
        .prepare(
          `SELECT raw_line, reason, COUNT(*) AS cnt, MAX(source_url) AS example_url
           FROM ingest_anomalies
           WHERE reason = ?
           GROUP BY raw_line, reason
           ORDER BY cnt DESC, raw_line ASC
           LIMIT ?`,
        )
        .all(reason, opts.limit) as TopRawRow[])
    : (db
        .prepare(
          `SELECT raw_line, reason, COUNT(*) AS cnt, MAX(source_url) AS example_url
           FROM ingest_anomalies
           GROUP BY raw_line, reason
           ORDER BY cnt DESC, raw_line ASC
           LIMIT ?`,
        )
        .all(opts.limit) as TopRawRow[]);

  return {
    totalCount,
    byReason: byReasonRows.map((r) => ({ reason: r.reason, count: r.cnt })),
    topRawLines: topRawRows.map((r) => ({
      rawLine: r.raw_line,
      reason: r.reason,
      count: r.cnt,
      exampleSourceUrl: r.example_url,
    })),
  };
}
