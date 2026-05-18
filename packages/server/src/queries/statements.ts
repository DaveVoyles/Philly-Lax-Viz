// Prepared statements, one cache per Database instance.

import type { Database, Statement } from 'better-sqlite3';

export interface Statements {
  countGames: Statement;
  countTeams: Statement;
  countPlayers: Statement;
  countPlayerStats: Statement;
  countRankings: Statement;
  countAnomalies: Statement;

  listTeams: Statement;
  getTeamById: Statement;
  gamesForTeam: Statement;
  latestRankingForTeam: Statement;

  listGames: Statement;
  listGamesByRange: Statement;
  listGamesByRangeAndTeam: Statement;
  listGamesByDate: Statement;
  listGamesByTeam: Statement;
  listGamesByDateAndTeam: Statement;
  getGameById: Statement;
  periodsForGame: Statement;
  playerStatsForGame: Statement;

  getPlayerById: Statement;
  seasonStatsForPlayer: Statement;
  perGameStatsForPlayer: Statement;
  topScorersForTeam: Statement;

  latestRankingWeek: Statement;
  latestRankingWeekAnySource: Statement;
  rankingsForWeek: Statement;
  rankingsForWeekAnySource: Statement;

  listAnomalies: Statement;
}

const cache = new WeakMap<Database, Statements>();

export function getStatements(db: Database): Statements {
  const cached = cache.get(db);
  if (cached) return cached;

  const stmts: Statements = {
    countGames: db.prepare('SELECT COUNT(*) AS c FROM games'),
    countTeams: db.prepare('SELECT COUNT(*) AS c FROM teams'),
    countPlayers: db.prepare('SELECT COUNT(*) AS c FROM players'),
    countPlayerStats: db.prepare('SELECT COUNT(*) AS c FROM player_stats'),
    countRankings: db.prepare('SELECT COUNT(*) AS c FROM rankings'),
    countAnomalies: db.prepare('SELECT COUNT(*) AS c FROM ingest_anomalies'),

    listTeams: db.prepare(
      `SELECT t.*,
              p.name_official   AS piaa_name_official,
              p.classification  AS piaa_classification,
              p.seed            AS piaa_seed,
              p.wins            AS piaa_wins,
              p.losses          AS piaa_losses,
              p.ties            AS piaa_ties,
              p.total_points    AS piaa_total_points,
              p.ranking         AS piaa_ranking,
              (SELECT COUNT(*) FROM games
                WHERE home_team_id = t.id OR away_team_id = t.id) AS our_games_count,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0 AND (
                    (g.home_team_id = t.id AND g.home_score > g.away_score) OR
                    (g.away_team_id = t.id AND g.away_score > g.home_score)
                  ) THEN 1 ELSE 0 END), 0)
                 FROM games g WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS derived_wins,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0 AND (
                    (g.home_team_id = t.id AND g.home_score < g.away_score) OR
                    (g.away_team_id = t.id AND g.away_score < g.home_score)
                  ) THEN 1 ELSE 0 END), 0)
                 FROM games g WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS derived_losses,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0 AND g.home_score = g.away_score AND
                       (g.home_team_id = t.id OR g.away_team_id = t.id)
                  THEN 1 ELSE 0 END), 0)
                 FROM games g WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS derived_ties
       FROM teams t
       LEFT JOIN piaa_official_teams p ON
         p.name_normalized = LOWER(t.name)
         OR p.name_normalized IN (SELECT alias FROM team_aliases WHERE team_id = t.id)
       WHERE
         -- Hide ghost teams: only surface teams that either have observed
         -- games/players or are mapped to a real PIAA program. Pure parser
         -- artifacts (stray abbreviations like "BHS", "CBE", "DV") have no
         -- data attached and no PIAA mapping, so they're filtered out.
         (SELECT COUNT(*) FROM games WHERE home_team_id = t.id OR away_team_id = t.id) > 0
         OR EXISTS (SELECT 1 FROM players WHERE team_id = t.id)
         OR p.id IS NOT NULL
       ORDER BY t.name COLLATE NOCASE ASC`,
    ),
    getTeamById: db.prepare(
      `SELECT t.*,
              p.name_official   AS piaa_name_official,
              p.classification  AS piaa_classification,
              p.seed            AS piaa_seed,
              p.wins            AS piaa_wins,
              p.losses          AS piaa_losses,
              p.ties            AS piaa_ties,
              p.total_points    AS piaa_total_points,
              p.ranking         AS piaa_ranking,
              (SELECT COUNT(*) FROM games
                WHERE home_team_id = t.id OR away_team_id = t.id) AS our_games_count,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0 AND (
                    (g.home_team_id = t.id AND g.home_score > g.away_score) OR
                    (g.away_team_id = t.id AND g.away_score > g.home_score)
                  ) THEN 1 ELSE 0 END), 0)
                 FROM games g WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS derived_wins,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0 AND (
                    (g.home_team_id = t.id AND g.home_score < g.away_score) OR
                    (g.away_team_id = t.id AND g.away_score < g.home_score)
                  ) THEN 1 ELSE 0 END), 0)
                 FROM games g WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS derived_losses,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0 AND g.home_score = g.away_score AND
                       (g.home_team_id = t.id OR g.away_team_id = t.id)
                  THEN 1 ELSE 0 END), 0)
                 FROM games g WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS derived_ties
       FROM teams t
       LEFT JOIN piaa_official_teams p ON
         p.name_normalized = LOWER(t.name)
         OR p.name_normalized IN (SELECT alias FROM team_aliases WHERE team_id = t.id)
       WHERE t.id = ?`,
    ),
    gamesForTeam: db.prepare(
      `SELECT * FROM games
       WHERE home_team_id = ? OR away_team_id = ?
       ORDER BY date DESC, id DESC`,
    ),
    latestRankingForTeam: db.prepare(
      `SELECT rank FROM rankings
       WHERE team_id = ?
       ORDER BY week_start DESC, captured_at DESC
       LIMIT 1`,
    ),

    listGames: db.prepare(
      `SELECT * FROM games
       ORDER BY date DESC, id DESC
       LIMIT ? OFFSET ?`,
    ),
    listGamesByRange: db.prepare(
      `SELECT * FROM games
       WHERE date >= ? AND date <= ?
       ORDER BY date DESC, id DESC
       LIMIT ? OFFSET ?`,
    ),
    listGamesByRangeAndTeam: db.prepare(
      `SELECT * FROM games
       WHERE date >= ? AND date <= ? AND (home_team_id = ? OR away_team_id = ?)
       ORDER BY date DESC, id DESC
       LIMIT ? OFFSET ?`,
    ),
    listGamesByDate: db.prepare(
      `SELECT * FROM games
       WHERE date = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    ),
    listGamesByTeam: db.prepare(
      `SELECT * FROM games
       WHERE home_team_id = ? OR away_team_id = ?
       ORDER BY date DESC, id DESC
       LIMIT ? OFFSET ?`,
    ),
    listGamesByDateAndTeam: db.prepare(
      `SELECT * FROM games
       WHERE date = ? AND (home_team_id = ? OR away_team_id = ?)
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    ),
    getGameById: db.prepare('SELECT * FROM games WHERE id = ?'),
    periodsForGame: db.prepare(
      `SELECT * FROM game_periods
       WHERE game_id = ?
       ORDER BY period_number ASC, team_id ASC`,
    ),
    playerStatsForGame: db.prepare(
      `SELECT ps.*, p.name AS player_name, t.name AS team_name
       FROM player_stats ps
       JOIN players p ON p.id = ps.player_id
       JOIN teams   t ON t.id = p.team_id
       WHERE ps.game_id = ?
       ORDER BY t.name COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC`,
    ),

    getPlayerById: db.prepare('SELECT * FROM players WHERE id = ?'),
    seasonStatsForPlayer: db.prepare(
      `SELECT
         COUNT(*)                             AS games,
         COALESCE(SUM(goals), 0)              AS goals,
         COALESCE(SUM(assists), 0)            AS assists,
         COALESCE(SUM(goals + assists), 0)    AS points,
         COALESCE(SUM(ground_balls), 0)       AS ground_balls,
         COALESCE(SUM(caused_turnovers), 0)   AS caused_turnovers,
         COALESCE(SUM(saves), 0)              AS saves,
         COALESCE(SUM(fo_won), 0)             AS fo_won,
         COALESCE(SUM(fo_taken), 0)           AS fo_taken
       FROM player_stats
       WHERE player_id = ?`,
    ),
    perGameStatsForPlayer: db.prepare(
      `SELECT ps.*, g.date AS game_date
       FROM player_stats ps
       JOIN games g ON g.id = ps.game_id
       WHERE ps.player_id = ?
       ORDER BY g.date DESC, ps.id DESC`,
    ),
    topScorersForTeam: db.prepare(
      `SELECT p.id           AS player_id,
              p.name         AS player_name,
              COALESCE(SUM(ps.goals), 0)   AS goals,
              COALESCE(SUM(ps.assists), 0) AS assists
       FROM player_stats ps
       JOIN players p ON p.id = ps.player_id
       WHERE p.team_id = ?
       GROUP BY p.id, p.name
       HAVING (goals + assists) > 0
       ORDER BY (goals + assists) DESC, goals DESC, player_name COLLATE NOCASE ASC
       LIMIT ?`,
    ),

    latestRankingWeek: db.prepare(
      `SELECT week_start FROM rankings
       WHERE ranking_source = ?
       ORDER BY week_start DESC
       LIMIT 1`,
    ),
    latestRankingWeekAnySource: db.prepare(
      `SELECT week_start FROM rankings
       ORDER BY week_start DESC
       LIMIT 1`,
    ),
    rankingsForWeek: db.prepare(
      `SELECT * FROM rankings
       WHERE week_start = ? AND ranking_source = ?
       ORDER BY rank ASC`,
    ),
    rankingsForWeekAnySource: db.prepare(
      `SELECT * FROM rankings
       WHERE week_start = ?
       ORDER BY ranking_source ASC, rank ASC`,
    ),

    listAnomalies: db.prepare(
      `SELECT * FROM ingest_anomalies
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ),
  };

  cache.set(db, stmts);
  return stmts;
}
