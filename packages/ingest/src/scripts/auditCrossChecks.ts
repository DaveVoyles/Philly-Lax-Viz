/**
 * Cross-validation audit (Wave 1 Lane 1, anomaly hunt 2026-04-22).
 *
 * Detection-only script — does NOT mutate `players` or `player_stats`. The
 * only side effect under `--apply` is INSERTs into `ingest_anomalies` with
 * one of the new `cross-check-*` strategy literals.
 *
 * Idempotent: each anomaly's `raw_line` encodes a deterministic key
 * (`player_id=X game_id=Y`) and we skip rows where (strategy, raw_line) already
 * exists. Re-running --apply will only insert truly new findings.
 *
 * Scope: 2026 season only (filters via games.season = 2026 and, for season
 * concentration, player_stats.season = 2026).
 *
 * Usage:
 *   DB_PATH="$PWD/data/lacrosse.db" pnpm --filter @pll/ingest exec tsx \
 *     src/scripts/auditCrossChecks.ts [--apply]
 */
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { resolve } from 'node:path';
import type { ParserStrategy } from '@pll/shared';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:auditCrossChecks' });
export const SEASON = 2026;
export const TEAM_SLACK = 3;
export const SHORT_NAME_MAX_LEN = 3;
export const STAT_WORDS = /^(goals?|assists?|saves?|goalie|gb|cto|fo)$/i;
export const SEASON_CONCENTRATION_RATIO = 0.6;
export const SEASON_CONCENTRATION_MIN_GOALS = 10;

export type CrossCheckStrategy = Extract<ParserStrategy, `cross-check-${string}`>;

export interface AnomalyFinding {
  strategy: CrossCheckStrategy;
  rawLine: string;
  reason: string;
  sourcePostId: string;
  sourceUrl: string;
  parentGameId: number | null;
  playerId: number | null;
}

export interface CheckReport {
  check: CrossCheckStrategy;
  count: number;
  samples: AnomalyFinding[];
}

interface PlayerExceedsTeamRow {
  player_id: number;
  player_name: string;
  team_id: number;
  game_id: number;
  player_goals: number;
  team_score: number;
  source_post_id: string;
  recap_url: string | null;
}

interface SumExceedsTeamRow {
  game_id: number;
  team_id: number;
  team_score: number;
  player_goal_sum: number;
  source_post_id: string;
  recap_url: string | null;
}

interface SuspectNameRow {
  player_id: number;
  name: string;
  reason: string;
  game_id: number | null;
  source_post_id: string | null;
  recap_url: string | null;
}

interface GoalieAsScorerRow {
  player_id: number;
  name: string;
  goals_total: number;
  assists_total: number;
  game_id: number | null;
  source_post_id: string | null;
  recap_url: string | null;
}

interface SeasonConcentrationRow {
  player_id: number;
  name: string;
  game_id: number;
  game_goals: number;
  season_goals: number;
  source_post_id: string;
  recap_url: string | null;
}

function findPlayerExceedsTeam(db: DatabaseType): AnomalyFinding[] {
  const rows = db
    .prepare(
      `SELECT ps.player_id,
              p.name AS player_name,
              p.team_id,
              ps.game_id,
              ps.goals AS player_goals,
              CASE WHEN g.home_team_id = p.team_id THEN g.home_score
                   WHEN g.away_team_id = p.team_id THEN g.away_score
                   ELSE NULL END AS team_score,
              g.source_post_id,
              g.recap_url
         FROM player_stats ps
         JOIN players p ON p.id = ps.player_id
         JOIN games   g ON g.id = ps.game_id
        WHERE g.season = ${SEASON}
          AND g.postponed = 0
          AND ps.goals > 0
          AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
          AND ps.goals >
              CASE WHEN g.home_team_id = p.team_id THEN g.home_score
                   ELSE g.away_score END`,
    )
    .all() as PlayerExceedsTeamRow[];
  return rows.map((r) => ({
    strategy: 'cross-check-player-exceeds-team',
    rawLine: `player_id=${r.player_id} game_id=${r.game_id}`,
    reason: `${r.player_name} (player_id=${r.player_id}) recorded ${r.player_goals} goals but team_id=${r.team_id} only scored ${r.team_score} in game_id=${r.game_id}`,
    sourcePostId: r.source_post_id,
    sourceUrl: r.recap_url ?? '',
    parentGameId: r.game_id,
    playerId: r.player_id,
  }));
}

function findSumExceedsTeam(db: DatabaseType): AnomalyFinding[] {
  const rows = db
    .prepare(
      `SELECT ps.game_id,
              p.team_id,
              SUM(ps.goals) AS player_goal_sum,
              CASE WHEN g.home_team_id = p.team_id THEN g.home_score
                   ELSE g.away_score END AS team_score,
              g.source_post_id,
              g.recap_url
         FROM player_stats ps
         JOIN players p ON p.id = ps.player_id
         JOIN games   g ON g.id = ps.game_id
        WHERE g.season = ${SEASON}
          AND g.postponed = 0
          AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
        GROUP BY ps.game_id, p.team_id
       HAVING SUM(ps.goals) > team_score + ${TEAM_SLACK}`,
    )
    .all() as SumExceedsTeamRow[];
  return rows.map((r) => ({
    strategy: 'cross-check-sum-exceeds-team',
    rawLine: `team_id=${r.team_id} game_id=${r.game_id}`,
    reason: `Sum of player goals (${r.player_goal_sum}) on team_id=${r.team_id} exceeds team_score (${r.team_score}) by more than ${TEAM_SLACK} in game_id=${r.game_id}`,
    sourcePostId: r.source_post_id,
    sourceUrl: r.recap_url ?? '',
    parentGameId: r.game_id,
    playerId: null,
  }));
}

function findSuspectNames(db: DatabaseType): AnomalyFinding[] {
  // Only players that have at least one stat row in 2026.
  const rows = db
    .prepare(
      `SELECT p.id AS player_id,
              p.name,
              MIN(ps.game_id) AS game_id,
              g.source_post_id,
              g.recap_url
         FROM players p
         JOIN player_stats ps ON ps.player_id = p.id AND ps.season = ${SEASON}
         LEFT JOIN games g ON g.id = ps.game_id
        GROUP BY p.id, p.name`,
    )
    .all() as Array<Omit<SuspectNameRow, 'reason'>>;

  const findings: AnomalyFinding[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    const tokens = name.split(/\s+/);
    let reason: string | null = null;
    if (tokens.length === 1 && tokens[0]!.length <= SHORT_NAME_MAX_LEN) {
      reason = `single-token name length<=${SHORT_NAME_MAX_LEN}: "${name}"`;
    } else if (tokens.length === 1 && STAT_WORDS.test(tokens[0]!)) {
      reason = `name matches stat-word blacklist: "${name}"`;
    }
    if (!reason) continue;
    findings.push({
      strategy: 'cross-check-suspect-name',
      rawLine: `player_id=${r.player_id}`,
      reason,
      sourcePostId: r.source_post_id ?? '',
      sourceUrl: r.recap_url ?? '',
      parentGameId: r.game_id ?? null,
      playerId: r.player_id,
    });
  }
  return findings;
}

function findGoalieAsScorer(db: DatabaseType): AnomalyFinding[] {
  const rows = db
    .prepare(
      `SELECT p.id AS player_id,
              p.name,
              SUM(ps.goals)   AS goals_total,
              SUM(ps.assists) AS assists_total,
              MIN(ps.game_id) AS game_id,
              g.source_post_id,
              g.recap_url
         FROM players p
         JOIN player_stats ps ON ps.player_id = p.id AND ps.season = ${SEASON}
         LEFT JOIN games g ON g.id = ps.game_id
        WHERE LOWER(p.name) LIKE '%goalie%'
        GROUP BY p.id, p.name
       HAVING goals_total > 0 OR assists_total > 0`,
    )
    .all() as GoalieAsScorerRow[];
  return rows.map((r) => ({
    strategy: 'cross-check-goalie-as-scorer',
    rawLine: `player_id=${r.player_id}`,
    reason: `Player name contains "goalie" but has goals=${r.goals_total} assists=${r.assists_total} in 2026`,
    sourcePostId: r.source_post_id ?? '',
    sourceUrl: r.recap_url ?? '',
    parentGameId: r.game_id ?? null,
    playerId: r.player_id,
  }));
}

function findSeasonConcentration(db: DatabaseType): AnomalyFinding[] {
  const rows = db
    .prepare(
      `WITH season_totals AS (
         SELECT player_id, SUM(goals) AS season_goals
           FROM player_stats
          WHERE season = ${SEASON}
          GROUP BY player_id
         HAVING SUM(goals) >= ${SEASON_CONCENTRATION_MIN_GOALS}
       ),
       max_game AS (
         SELECT ps.player_id, ps.game_id, ps.goals AS game_goals,
                ROW_NUMBER() OVER (PARTITION BY ps.player_id ORDER BY ps.goals DESC, ps.game_id ASC) AS rn
           FROM player_stats ps
          WHERE ps.season = ${SEASON}
       )
       SELECT mg.player_id, p.name, mg.game_id, mg.game_goals, st.season_goals,
              g.source_post_id, g.recap_url
         FROM max_game mg
         JOIN season_totals st ON st.player_id = mg.player_id
         JOIN players p ON p.id = mg.player_id
         JOIN games   g ON g.id = mg.game_id
        WHERE mg.rn = 1
          AND CAST(mg.game_goals AS REAL) / st.season_goals > ${SEASON_CONCENTRATION_RATIO}`,
    )
    .all() as SeasonConcentrationRow[];
  return rows.map((r) => {
    const pct = ((r.game_goals / r.season_goals) * 100).toFixed(1);
    return {
      strategy: 'cross-check-season-concentration',
      rawLine: `player_id=${r.player_id} game_id=${r.game_id}`,
      reason: `${r.name} (player_id=${r.player_id}) scored ${r.game_goals}/${r.season_goals} season goals (${pct}%) in game_id=${r.game_id}`,
      sourcePostId: r.source_post_id,
      sourceUrl: r.recap_url ?? '',
      parentGameId: r.game_id,
      playerId: r.player_id,
    };
  });
}

export function runChecks(db: DatabaseType): CheckReport[] {
  const groups: Record<CrossCheckStrategy, AnomalyFinding[]> = {
    'cross-check-player-exceeds-team': findPlayerExceedsTeam(db),
    'cross-check-sum-exceeds-team': findSumExceedsTeam(db),
    'cross-check-suspect-name': findSuspectNames(db),
    'cross-check-goalie-as-scorer': findGoalieAsScorer(db),
    'cross-check-season-concentration': findSeasonConcentration(db),
  };
  return (Object.keys(groups) as CrossCheckStrategy[]).map((check) => ({
    check,
    count: groups[check].length,
    samples: groups[check].slice(0, 10),
  }));
}

/**
 * Insert findings into ingest_anomalies. Idempotent: skips a finding if a row
 * with the same (strategy_attempted, raw_line) already exists.
 *
 * Returns counts per strategy for the rows actually inserted.
 */
export function applyAnomalies(
  db: DatabaseType,
  reports: CheckReport[],
  allFindings: Record<CrossCheckStrategy, AnomalyFinding[]>,
): Record<CrossCheckStrategy, number> {
  const exists = db.prepare(
    `SELECT 1 FROM ingest_anomalies
      WHERE strategy_attempted = ? AND raw_line = ? LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  const inserted: Record<string, number> = {};
  const tx = db.transaction(() => {
    for (const report of reports) {
      inserted[report.check] = 0;
      const findings = allFindings[report.check];
      for (const f of findings) {
        if (exists.get(f.strategy, f.rawLine)) continue;
        insert.run(
          f.sourcePostId,
          f.sourceUrl,
          f.rawLine,
          f.parentGameId,
          f.strategy,
          f.reason,
        );
        inserted[report.check]!++;
      }
    }
  });
  tx();
  return inserted as Record<CrossCheckStrategy, number>;
}

export function collectAllFindings(
  db: DatabaseType,
): Record<CrossCheckStrategy, AnomalyFinding[]> {
  return {
    'cross-check-player-exceeds-team': findPlayerExceedsTeam(db),
    'cross-check-sum-exceeds-team': findSumExceedsTeam(db),
    'cross-check-suspect-name': findSuspectNames(db),
    'cross-check-goalie-as-scorer': findGoalieAsScorer(db),
    'cross-check-season-concentration': findSeasonConcentration(db),
  };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const dbPath = process.env.DB_PATH ?? './data/lacrosse.db';
  const db = new Database(resolve(dbPath));
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');

  const findings = collectAllFindings(db);
  const reports: CheckReport[] = (Object.keys(findings) as CrossCheckStrategy[]).map(
    (check) => ({
      check,
      count: findings[check].length,
      samples: findings[check].slice(0, 10),
    }),
  );

  if (!apply) {
    log.info(JSON.stringify(reports, null, 2));
    log.info('// DRY RUN — pass --apply to insert into ingest_anomalies');
    return;
  }

  const insertCounts = applyAnomalies(db, reports, findings);
  log.info(JSON.stringify({ reports, insertCounts }, null, 2));
}

const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /auditCrossChecks\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (isDirectInvocation) main();
