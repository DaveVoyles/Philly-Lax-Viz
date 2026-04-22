// rankings.ts — given a parsed ranking list, upsert rankings rows for the post.

import type { Database } from 'better-sqlite3';
import type { ParseListResult, ParsedRankingEntry, RankingSource } from '@pll/shared';
import { resolveTeam } from './teamResolver.js';
import { insertAnomaly } from './anomalies.js';
import { isoToMondayOfWeek } from './postMeta.js';

export interface RankingsPipelineInput {
  postId: string;
  postUrl: string;
  postDate: string; // ISO YYYY-MM-DD
  rankingSource: RankingSource;
  parsed: ParseListResult<ParsedRankingEntry>;
}

export interface RankingsPipelineResult {
  rankingsUpserted: number;
  anomaliesAdded: number;
  weekStart: string;
}

export function ingestRankingsPost(
  db: Database,
  input: RankingsPipelineInput,
): RankingsPipelineResult {
  const now = new Date().toISOString();
  const weekStart = isoToMondayOfWeek(input.postDate);
  const result: RankingsPipelineResult = {
    rankingsUpserted: 0,
    anomaliesAdded: 0,
    weekStart,
  };

  const upsert = db.prepare(
    `INSERT INTO rankings
       (week_start, ranking_source, team_id, rank, source_post_id, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_start, ranking_source, team_id) DO UPDATE SET
       rank           = excluded.rank,
       source_post_id = excluded.source_post_id,
       captured_at    = excluded.captured_at`,
  );

  const seenRanks = new Set<number>();
  for (const entry of input.parsed.results) {
    let team;
    try {
      team = resolveTeam(db, entry.teamName);
    } catch (err) {
      result.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${entry.rank} ${entry.teamName}`,
        parentGameId: null,
        strategyAttempted: 'ranking-list',
        reason: `team resolution failed: ${(err as Error).message}`,
      });
      continue;
    }
    if (seenRanks.has(entry.rank)) {
      result.anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${entry.rank} ${entry.teamName}`,
        parentGameId: null,
        strategyAttempted: 'ranking-list',
        reason: `duplicate rank ${entry.rank} in post`,
      });
      continue;
    }
    seenRanks.add(entry.rank);
    upsert.run(weekStart, input.rankingSource, team.id, entry.rank, input.postId, now);
    result.rankingsUpserted++;
  }

  for (const anomaly of input.parsed.anomalies) {
    if (!anomaly.rawLine) continue; // skip the "no entries" sentinel when we did parse some
    if (anomaly.rawLine === '' && result.rankingsUpserted > 0) continue;
    result.anomaliesAdded += insertAnomaly(db, {
      sourcePostId: input.postId,
      sourceUrl: input.postUrl,
      rawLine: anomaly.rawLine,
      parentGameId: null,
      strategyAttempted: anomaly.strategyAttempted,
      reason: anomaly.reason,
    });
  }

  return result;
}
