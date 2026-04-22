// scoreboard.ts — given a parsed scoreboard post, upsert teams + games.
// Scoreboard posts contain only team-level scores; player stats come from
// summaries posts and are intentionally NOT touched here.

import type { Database } from 'better-sqlite3';
import type { ParsedScoreboardPost } from '../parsers/scoreboardPost.js';
import { resolveTeam } from './teamResolver.js';
import { dateLabelToIso } from './postMeta.js';
import { insertAnomaly } from './anomalies.js';
import { DEFAULT_SEASON } from '../crawler.js';

export interface ScoreboardPipelineInput {
  postId: string;
  postUrl: string;
  /** ISO YYYY-MM-DD of the post itself; used for "Today"/"Yesterday" labels. */
  postDate: string;
  /**
   * Season (year) the games belong to — derived from the post URL path. If
   * omitted, defaults to {@link DEFAULT_SEASON} (2026, the W12-and-earlier
   * behavior). Production callers in cli/ingest.ts always set this.
   */
  season?: number;
  parsed: ParsedScoreboardPost;
}

export interface ScoreboardPipelineResult {
  gamesUpserted: number;
  anomaliesAdded: number;
}

/**
 * Upsert one scoreboard post worth of games. Caller is expected to wrap the
 * call in a transaction so failures roll back cleanly.
 */
export function ingestScoreboardPost(
  db: Database,
  input: ScoreboardPipelineInput,
): ScoreboardPipelineResult {
  const now = new Date().toISOString();
  let gamesUpserted = 0;
  let anomaliesAdded = 0;

  const upsertGame = db.prepare(
    `INSERT INTO games
       (date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, home_team_id, away_team_id) DO UPDATE SET
       home_score     = excluded.home_score,
       away_score     = excluded.away_score,
       ot_periods     = excluded.ot_periods,
       postponed      = excluded.postponed,
       source_post_id = excluded.source_post_id,
       recap_url      = COALESCE(games.recap_url, excluded.recap_url),
       parsed_at      = excluded.parsed_at,
       season         = excluded.season`,
  );

  for (const game of input.parsed.games) {
    if (game.postponed) continue;
    let homeTeam, awayTeam;
    try {
      homeTeam = resolveTeam(db, game.teamA);
      awayTeam = resolveTeam(db, game.teamB);
    } catch (err) {
      anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${game.teamA} ${game.scoreA}, ${game.teamB} ${game.scoreB}`,
        parentGameId: null,
        strategyAttempted: 'score-line',
        reason: `team resolution failed: ${(err as Error).message}`,
      });
      continue;
    }
    if (homeTeam.id === awayTeam.id) {
      anomaliesAdded += insertAnomaly(db, {
        sourcePostId: input.postId,
        sourceUrl: input.postUrl,
        rawLine: `${game.teamA} ${game.scoreA}, ${game.teamB} ${game.scoreB}`,
        parentGameId: null,
        strategyAttempted: 'score-line',
        reason: 'home and away teams resolved to same row',
      });
      continue;
    }

    const date = dateLabelToIso(game.dateLabel, input.postDate);
    upsertGame.run(
      date,
      homeTeam.id,
      awayTeam.id,
      game.scoreA,
      game.scoreB,
      game.otPeriods,
      0,
      input.postId,
      null,
      now,
      input.season ?? DEFAULT_SEASON,
    );
    gamesUpserted++;
  }

  for (const anomaly of input.parsed.anomalies) {
    anomaliesAdded += insertAnomaly(db, {
      sourcePostId: input.postId,
      sourceUrl: input.postUrl,
      rawLine: anomaly.rawLine,
      parentGameId: null,
      strategyAttempted: anomaly.strategyAttempted,
      reason: anomaly.reason,
    });
  }

  return { gamesUpserted, anomaliesAdded };
}
