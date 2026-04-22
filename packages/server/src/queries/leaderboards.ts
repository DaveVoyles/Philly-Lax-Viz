// League leaderboards — dynamic queries built per request because
// ORDER BY (and the fo_pct HAVING clause) depend on the requested metric.

import type { Database } from 'better-sqlite3';

export const PLAYER_METRICS = [
  'points',
  'goals',
  'assists',
  'ground_balls',
  'caused_turnovers',
  'saves',
  'fo_pct',
  'points_per_game',
] as const;

export type PlayerMetric = (typeof PLAYER_METRICS)[number];

export const TEAM_METRICS = [
  'wins',
  'losses',
  'win_pct',
  'goals_for',
  'goals_against',
  'goal_diff',
  'gpg',
  'gapg',
] as const;

export type TeamMetric = (typeof TEAM_METRICS)[number];

export interface PlayerLeaderRow {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  team_logo_url: string | null;
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
  fo_pct: number | null;
  points_per_game: number | null;
  // Hot streak: >2 goals total across last 3 (non-postponed) games.
  on_fire: 0 | 1;
}

export interface TeamLeaderRow {
  team_id: number;
  team_name: string;
  team_slug: string;
  team_logo_url: string | null;
  games_played: number;
  wins: number;
  losses: number;
  ties: number;
  goals_for: number;
  goals_against: number;
}

export interface PlayerLeadersOpts {
  metric: PlayerMetric;
  limit: number;
  minGames: number;
  minAttempts: number;
  teamId?: number;
  /** Filter to player_stats rows tagged with this season (W13). */
  season?: number;
}

export interface TeamLeadersOpts {
  metric: TeamMetric;
  limit: number;
  /** Filter to games tagged with this season (W13). */
  season?: number;
}

// metric -> SQL ORDER BY tail (without LIMIT). Includes tiebreakers per plan.
function playerOrderBy(metric: PlayerMetric): string {
  switch (metric) {
    case 'points':
      return 'points DESC, goals DESC, games_played ASC, player_name COLLATE NOCASE ASC';
    case 'goals':
      return 'goals DESC, assists DESC, player_name COLLATE NOCASE ASC';
    case 'assists':
      return 'assists DESC, goals DESC, player_name COLLATE NOCASE ASC';
    case 'ground_balls':
      return 'ground_balls DESC, games_played ASC, player_name COLLATE NOCASE ASC';
    case 'caused_turnovers':
      return 'caused_turnovers DESC, games_played ASC, player_name COLLATE NOCASE ASC';
    case 'saves':
      return 'saves DESC, games_played ASC, player_name COLLATE NOCASE ASC';
    case 'fo_pct':
      return 'fo_pct DESC, fo_taken DESC, player_name COLLATE NOCASE ASC';
    case 'points_per_game':
      return 'points_per_game DESC, points DESC, player_name COLLATE NOCASE ASC';
  }
}

function teamOrderBy(metric: TeamMetric): string {
  switch (metric) {
    case 'wins':
      return 'wins DESC, win_pct DESC, goal_diff DESC, team_name COLLATE NOCASE ASC';
    case 'losses':
      return 'losses DESC, games_played DESC, team_name COLLATE NOCASE ASC';
    case 'win_pct':
      return 'win_pct DESC, wins DESC, team_name COLLATE NOCASE ASC';
    case 'goals_for':
      return 'goals_for DESC, games_played ASC, team_name COLLATE NOCASE ASC';
    case 'goals_against':
      return 'goals_against ASC, games_played ASC, team_name COLLATE NOCASE ASC';
    case 'goal_diff':
      return 'goal_diff DESC, wins DESC, team_name COLLATE NOCASE ASC';
    case 'gpg':
      return 'gpg DESC, games_played ASC, team_name COLLATE NOCASE ASC';
    case 'gapg':
      return 'gapg ASC, games_played ASC, team_name COLLATE NOCASE ASC';
  }
}

export function getPlayerLeaders(
  db: Database,
  opts: PlayerLeadersOpts,
): PlayerLeaderRow[] {
  const { metric, limit, minGames, minAttempts, teamId, season } = opts;

  const havingClauses: string[] = ['COUNT(ps.id) >= @minGames'];
  if (metric === 'fo_pct') {
    havingClauses.push('COALESCE(SUM(ps.fo_taken), 0) >= @minAttempts');
  }

  const whereClauses: string[] = [];
  if (teamId !== undefined) {
    whereClauses.push('p.team_id = @teamId');
  }
  if (season !== undefined) {
    whereClauses.push('ps.season = @season');
  }
  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    WITH per_game AS (
      SELECT ps.player_id              AS player_id,
             ps.game_id                AS game_id,
             g.date                    AS game_date,
             COALESCE(SUM(ps.goals),0) AS goals
      FROM player_stats ps
      JOIN games g ON g.id = ps.game_id
      WHERE g.postponed = 0
      GROUP BY ps.player_id, ps.game_id
    ),
    ranked AS (
      SELECT player_id,
             goals,
             ROW_NUMBER() OVER (
               PARTITION BY player_id
               ORDER BY game_date DESC, game_id DESC
             ) AS rn
      FROM per_game
    ),
    recent AS (
      SELECT player_id, COALESCE(SUM(goals),0) AS recent_goals
      FROM ranked
      WHERE rn <= 3
      GROUP BY player_id
    )
    SELECT
      p.id                                      AS player_id,
      p.name                                    AS player_name,
      p.team_id                                 AS team_id,
      t.name                                    AS team_name,
      t.logo_url                                AS team_logo_url,
      COUNT(ps.id)                              AS games_played,
      COALESCE(SUM(ps.goals), 0)                AS goals,
      COALESCE(SUM(ps.assists), 0)              AS assists,
      COALESCE(SUM(ps.goals + ps.assists), 0)   AS points,
      COALESCE(SUM(ps.ground_balls), 0)         AS ground_balls,
      COALESCE(SUM(ps.caused_turnovers), 0)     AS caused_turnovers,
      COALESCE(SUM(ps.saves), 0)                AS saves,
      COALESCE(SUM(ps.fo_won), 0)               AS fo_won,
      COALESCE(SUM(ps.fo_taken), 0)             AS fo_taken,
      CASE WHEN SUM(ps.fo_taken) > 0
           THEN SUM(ps.fo_won) * 1.0 / SUM(ps.fo_taken)
           ELSE NULL END                        AS fo_pct,
      CASE WHEN COUNT(ps.id) > 0
           THEN SUM(ps.goals + ps.assists) * 1.0 / COUNT(ps.id)
           ELSE NULL END                        AS points_per_game,
      CASE WHEN COALESCE(r.recent_goals, 0) > 2 THEN 1 ELSE 0 END AS on_fire
    FROM players p
    JOIN player_stats ps ON ps.player_id = p.id
    JOIN teams       t  ON t.id          = p.team_id
    LEFT JOIN recent r  ON r.player_id   = p.id
    ${whereSql}
    GROUP BY p.id, p.name, p.team_id, t.name, t.logo_url, r.recent_goals
    HAVING ${havingClauses.join(' AND ')}
    ORDER BY ${playerOrderBy(metric)}
    LIMIT @limit
  `;

  const params: Record<string, number> = { minGames, limit };
  if (metric === 'fo_pct') params.minAttempts = minAttempts;
  if (teamId !== undefined) params.teamId = teamId;
  if (season !== undefined) params.season = season;

  return db.prepare(sql).all(params) as PlayerLeaderRow[];
}

export function getTeamLeaders(db: Database, opts: TeamLeadersOpts): TeamLeaderRow[] {
  const { metric, limit, season } = opts;

  // win_pct is undefined when wins+losses=0; require at least one decided game.
  // Other metrics simply require games_played >= 1.
  const havingExtra =
    metric === 'win_pct' ? ' AND (wins + losses) >= 1' : '';

  const seasonFilter = season !== undefined ? 'WHERE season = @season' : '';

  const sql = `
    WITH team_games AS (
      SELECT home_team_id AS team_id,
             home_score   AS goals_for,
             away_score   AS goals_against,
             postponed    AS postponed
      FROM games
      ${seasonFilter}
      UNION ALL
      SELECT away_team_id AS team_id,
             away_score   AS goals_for,
             home_score   AS goals_against,
             postponed    AS postponed
      FROM games
      ${seasonFilter}
    ),
    base AS (
      SELECT
        t.id   AS team_id,
        t.name AS team_name,
        t.slug AS team_slug,
        t.logo_url AS team_logo_url,
        COALESCE(SUM(CASE WHEN tg.postponed = 0 THEN 1 ELSE 0 END), 0)                                            AS games_played,
        COALESCE(SUM(CASE WHEN tg.postponed = 0 AND tg.goals_for >  tg.goals_against THEN 1 ELSE 0 END), 0)       AS wins,
        COALESCE(SUM(CASE WHEN tg.postponed = 0 AND tg.goals_for <  tg.goals_against THEN 1 ELSE 0 END), 0)       AS losses,
        COALESCE(SUM(CASE WHEN tg.postponed = 0 AND tg.goals_for =  tg.goals_against THEN 1 ELSE 0 END), 0)       AS ties,
        COALESCE(SUM(CASE WHEN tg.postponed = 0 THEN tg.goals_for     ELSE 0 END), 0)                             AS goals_for,
        COALESCE(SUM(CASE WHEN tg.postponed = 0 THEN tg.goals_against ELSE 0 END), 0)                             AS goals_against
      FROM teams t
      LEFT JOIN team_games tg ON tg.team_id = t.id
      GROUP BY t.id, t.name, t.slug, t.logo_url
    )
    SELECT
      team_id, team_name, team_slug, team_logo_url, games_played, wins, losses, ties, goals_for, goals_against,
      (goals_for - goals_against)                                              AS goal_diff,
      CASE WHEN (wins + losses) > 0 THEN wins * 1.0 / (wins + losses) ELSE NULL END AS win_pct,
      CASE WHEN games_played > 0 THEN goals_for     * 1.0 / games_played ELSE NULL END AS gpg,
      CASE WHEN games_played > 0 THEN goals_against * 1.0 / games_played ELSE NULL END AS gapg
    FROM base
    WHERE games_played >= 1${havingExtra}
    ORDER BY ${teamOrderBy(metric)}
    LIMIT @limit
  `;

  const params: Record<string, number> = { limit };
  if (season !== undefined) params.season = season;
  return db.prepare(sql).all(params) as TeamLeaderRow[];
}
