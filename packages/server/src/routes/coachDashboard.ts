import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type {
  CoachDashboardResponse,
  CoachPracticeFocus,
  CoachScoutingReport,
  CoachTrendsResponse,
} from '@pll/shared';
import { getStatements } from '../queries/statements.js';
import { resolveSeason } from '../queries/seasons.js';
import { type TeamRow } from '../queries/mappers.js';

interface CoachDashboardQuery {
  teamId?: string;
  season?: string;
}

interface CoachScoutingQuery extends CoachDashboardQuery {
  opponentId?: string;
}

interface SummaryRow {
  games_total: number;
  games_with_stats: number;
  last_updated: string | null;
}

interface RecordRow {
  wins: number;
  losses: number;
}

interface MissingGameRow {
  game_id: number;
  opponent: string;
  date: string;
}

interface PlayerRow {
  id: number;
  name: string;
}

interface TrendRow {
  game_id: number;
  date: string;
  opponent: string;
  goals_for: number;
  goals_against: number;
  assists: number | null;
  ground_balls: number | null;
  saves: number | null;
  fo_won: number | null;
  fo_taken: number | null;
}

interface TopScorerRow {
  name: string;
  goals: number | null;
  assists: number | null;
}

interface HeadToHeadRow {
  date: string;
  team_score: number;
  opponent_score: number;
}

function buildSeasonClause(season: number | null, alias = 'g'): string {
  return season === null ? '' : ` AND ${alias}.season = @season`;
}

function buildStatSeasonClause(season: number | null, alias = 'ps'): string {
  return season === null ? '' : ` AND ${alias}.season = @season`;
}

function parsePositiveInt(raw: string | undefined): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getTeamRecord(db: Database, teamId: number, season: number | null): string {
  const params = season === null ? { teamId } : { teamId, season };
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN (g.home_team_id = @teamId AND g.home_score > g.away_score)
          OR (g.away_team_id = @teamId AND g.away_score > g.home_score)
        THEN 1 ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE
        WHEN (g.home_team_id = @teamId AND g.home_score < g.away_score)
          OR (g.away_team_id = @teamId AND g.away_score < g.home_score)
        THEN 1 ELSE 0 END), 0) AS losses
    FROM games g
    WHERE (g.home_team_id = @teamId OR g.away_team_id = @teamId)
      AND g.postponed = 0
      ${buildSeasonClause(season, 'g')}
  `).get(params) as RecordRow;

  return `${row.wins}-${row.losses}`;
}

function loadTrendPoints(db: Database, teamId: number, season: number | null, limit: number): TrendRow[] {
  const params = season === null ? { teamId, limit } : { teamId, season, limit };
  return db.prepare(`
    WITH recent_games AS (
      SELECT
        g.id AS game_id,
        g.date,
        CASE
          WHEN g.home_team_id = @teamId THEN away.name
          ELSE home.name
        END AS opponent,
        CASE
          WHEN g.home_team_id = @teamId THEN g.home_score
          ELSE g.away_score
        END AS goals_for,
        CASE
          WHEN g.home_team_id = @teamId THEN g.away_score
          ELSE g.home_score
        END AS goals_against
      FROM games g
      JOIN teams home ON home.id = g.home_team_id
      JOIN teams away ON away.id = g.away_team_id
      WHERE (g.home_team_id = @teamId OR g.away_team_id = @teamId)
        AND g.postponed = 0
        ${buildSeasonClause(season, 'g')}
      ORDER BY g.date DESC, g.id DESC
      LIMIT @limit
    ),
    team_game_stats AS (
      SELECT
        ps.game_id,
        SUM(ps.assists) AS assists,
        SUM(ps.ground_balls) AS ground_balls,
        SUM(ps.saves) AS saves,
        SUM(ps.fo_won) AS fo_won,
        SUM(ps.fo_taken) AS fo_taken
      FROM player_stats ps
      JOIN players p ON p.id = ps.player_id
      JOIN games g ON g.id = ps.game_id
      WHERE p.team_id = @teamId
        AND g.postponed = 0
        ${buildStatSeasonClause(season, 'ps')}
        ${buildSeasonClause(season, 'g')}
      GROUP BY ps.game_id
    )
    SELECT
      rg.game_id,
      rg.date,
      rg.opponent,
      rg.goals_for,
      rg.goals_against,
      COALESCE(tgs.assists, 0) AS assists,
      COALESCE(tgs.ground_balls, 0) AS ground_balls,
      COALESCE(tgs.saves, 0) AS saves,
      COALESCE(tgs.fo_won, 0) AS fo_won,
      COALESCE(tgs.fo_taken, 0) AS fo_taken
    FROM recent_games rg
    LEFT JOIN team_game_stats tgs ON tgs.game_id = rg.game_id
    ORDER BY rg.date DESC, rg.game_id DESC
  `).all(params) as TrendRow[];
}

function loadTopScorers(db: Database, teamId: number, season: number | null): TopScorerRow[] {
  const params = season === null ? { teamId } : { teamId, season };
  return db.prepare(`
    SELECT
      p.name,
      SUM(ps.goals) AS goals,
      SUM(ps.assists) AS assists
    FROM players p
    JOIN player_stats ps ON ps.player_id = p.id
    JOIN games g ON g.id = ps.game_id
    WHERE p.team_id = @teamId
      AND g.postponed = 0
      ${buildStatSeasonClause(season, 'ps')}
      ${buildSeasonClause(season, 'g')}
    GROUP BY p.id, p.name
    ORDER BY (SUM(ps.goals) + SUM(ps.assists)) DESC,
      SUM(ps.goals) DESC,
      p.name COLLATE NOCASE ASC
    LIMIT 3
  `).all(params) as TopScorerRow[];
}

function loadHeadToHead(db: Database, teamId: number, opponentId: number): HeadToHeadRow[] {
  return db.prepare(`
    SELECT
      g.date,
      CASE
        WHEN g.home_team_id = @teamId THEN g.home_score
        ELSE g.away_score
      END AS team_score,
      CASE
        WHEN g.home_team_id = @teamId THEN g.away_score
        ELSE g.home_score
      END AS opponent_score
    FROM games g
    WHERE g.postponed = 0
      AND ((g.home_team_id = @teamId AND g.away_team_id = @opponentId)
        OR (g.home_team_id = @opponentId AND g.away_team_id = @teamId))
    ORDER BY g.date DESC, g.id DESC
  `).all({ teamId, opponentId }) as HeadToHeadRow[];
}

export async function coachDashboardRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const statements = getStatements(db);

  app.get<{ Querystring: CoachDashboardQuery }>('/api/coach/dashboard', async (req, reply) => {
    const teamId = parsePositiveInt(req.query.teamId);
    if (teamId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'teamId must be a positive integer' };
    }

    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (error) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: error instanceof Error ? error.message : 'Invalid season',
      };
    }

    const teamRow = statements.getTeamById.get(teamId) as TeamRow | undefined;
    if (!teamRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${teamId} not found` };
    }

    const params = season === null ? { teamId } : { teamId, season };
    const gameSeasonClause = buildSeasonClause(season, 'g');
    const statSeasonClause = buildStatSeasonClause(season, 'ps');

    const summary = db.prepare(`
      WITH team_games AS (
        SELECT g.id, g.parsed_at
        FROM games g
        WHERE (g.home_team_id = @teamId OR g.away_team_id = @teamId)
          AND g.postponed = 0
          ${gameSeasonClause}
      ),
      games_with_stats AS (
        SELECT DISTINCT tg.id
        FROM team_games tg
        JOIN player_stats ps ON ps.game_id = tg.id
        JOIN players p ON p.id = ps.player_id
        WHERE p.team_id = @teamId
          ${statSeasonClause}
      )
      SELECT
        (SELECT COUNT(*) FROM team_games) AS games_total,
        (SELECT COUNT(*) FROM games_with_stats) AS games_with_stats,
        (SELECT MAX(parsed_at) FROM team_games) AS last_updated
    `).get(params) as SummaryRow;

    const missingStatGames = db.prepare(`
      SELECT
        g.id AS game_id,
        CASE
          WHEN g.home_team_id = @teamId THEN away.name
          ELSE home.name
        END AS opponent,
        g.date
      FROM games g
      JOIN teams home ON home.id = g.home_team_id
      JOIN teams away ON away.id = g.away_team_id
      WHERE (g.home_team_id = @teamId OR g.away_team_id = @teamId)
        AND g.postponed = 0
        ${gameSeasonClause}
        AND NOT EXISTS (
          SELECT 1
          FROM player_stats ps
          JOIN players p ON p.id = ps.player_id
          WHERE ps.game_id = g.id
            AND p.team_id = @teamId
            ${statSeasonClause}
        )
      ORDER BY g.date DESC, g.id DESC
    `).all(params) as MissingGameRow[];

    const playerCountRow = db.prepare(
      'SELECT COUNT(*) AS count FROM players WHERE team_id = @teamId',
    ).get({ teamId }) as { count: number };

    const playersWithNoStats = db.prepare(`
      SELECT p.id, p.name
      FROM players p
      WHERE p.team_id = @teamId
        AND NOT EXISTS (
          SELECT 1
          FROM player_stats ps
          JOIN games g ON g.id = ps.game_id
          WHERE ps.player_id = p.id
            AND g.postponed = 0
            ${statSeasonClause}
            ${buildSeasonClause(season, 'g')}
        )
      ORDER BY p.name COLLATE NOCASE ASC
    `).all(params) as PlayerRow[];

    const response: CoachDashboardResponse = {
      team: {
        id: String(teamRow.id),
        name: teamRow.name,
        record: getTeamRecord(db, teamId, season),
      },
      gamesTotal: summary.games_total,
      gamesWithStats: summary.games_with_stats,
      gamesWithoutStats: Math.max(0, summary.games_total - summary.games_with_stats),
      missingStatGames: missingStatGames.map((game) => ({
        gameId: String(game.game_id),
        opponent: game.opponent,
        date: game.date,
      })),
      playerCount: playerCountRow.count,
      playersWithNoStats: playersWithNoStats.map((player) => ({
        id: String(player.id),
        name: player.name,
      })),
      lastUpdated: summary.last_updated ?? '',
      uploadUrl: '#/coach/upload',
    };

    return response;
  });

  app.get<{ Querystring: CoachDashboardQuery }>('/api/coach/trends', async (req, reply) => {
    const teamId = parsePositiveInt(req.query.teamId);
    if (teamId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'teamId must be a positive integer' };
    }

    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (error) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: error instanceof Error ? error.message : 'Invalid season',
      };
    }

    const teamRow = statements.getTeamById.get(teamId) as TeamRow | undefined;
    if (!teamRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${teamId} not found` };
    }

    const response: CoachTrendsResponse = {
      trends: loadTrendPoints(db, teamId, season, 10).map((row) => ({
        gameId: row.game_id,
        date: row.date,
        opponent: row.opponent,
        goalsFor: row.goals_for,
        goalsAgainst: row.goals_against,
        assists: row.assists ?? 0,
        groundBalls: row.ground_balls ?? 0,
        saves: row.saves ?? 0,
        foWon: row.fo_won ?? 0,
        foTaken: row.fo_taken ?? 0,
      })),
    };

    return response;
  });

  app.get<{ Querystring: CoachScoutingQuery }>('/api/coach/scouting', async (req, reply) => {
    const teamId = parsePositiveInt(req.query.teamId);
    if (teamId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'teamId must be a positive integer' };
    }

    const opponentId = parsePositiveInt(req.query.opponentId);
    if (opponentId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'opponentId must be a positive integer' };
    }
    if (opponentId === teamId) {
      reply.code(400);
      return { error: 'BadRequest', message: 'opponentId must differ from teamId' };
    }

    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (error) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: error instanceof Error ? error.message : 'Invalid season',
      };
    }

    const teamRow = statements.getTeamById.get(teamId) as TeamRow | undefined;
    if (!teamRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${teamId} not found` };
    }

    const opponentRow = statements.getTeamById.get(opponentId) as TeamRow | undefined;
    if (!opponentRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${opponentId} not found` };
    }

    const last5TrendRows = loadTrendPoints(db, opponentId, season, 5);
    const topScorers = loadTopScorers(db, opponentId, season);
    const h2hRows = loadHeadToHead(db, teamId, opponentId);

    const response: CoachScoutingReport = {
      opponent: {
        id: opponentRow.id,
        name: opponentRow.name,
        record: getTeamRecord(db, opponentId, season),
      },
      last5Games: last5TrendRows.map((row) => ({
        date: row.date,
        opponent: row.opponent,
        score: `${row.goals_for}-${row.goals_against}`,
        result: row.goals_for > row.goals_against ? 'W' : 'L',
      })),
      avgGoalsFor: average(last5TrendRows.map((row) => row.goals_for)),
      avgGoalsAgainst: average(last5TrendRows.map((row) => row.goals_against)),
      topScorers: topScorers.map((row) => ({
        name: row.name,
        goals: row.goals ?? 0,
        assists: row.assists ?? 0,
      })),
      h2h: h2hRows.map((row) => ({
        date: row.date,
        score: `${row.team_score}-${row.opponent_score}`,
        result: row.team_score > row.opponent_score ? 'W' : 'L',
      })),
    };

    return response;
  });

  app.get<{ Querystring: CoachDashboardQuery }>('/api/coach/practice-focus', async (req, reply) => {
    const teamId = parsePositiveInt(req.query.teamId);
    if (teamId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'teamId must be a positive integer' };
    }

    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (error) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: error instanceof Error ? error.message : 'Invalid season',
      };
    }

    const teamRow = statements.getTeamById.get(teamId) as TeamRow | undefined;
    if (!teamRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${teamId} not found` };
    }

    const trendRows = loadTrendPoints(db, teamId, season, 10);
    const last5 = trendRows.slice(0, 5);
    const recent3 = trendRows.slice(0, 3);
    const previous7 = trendRows.slice(3);
    const suggestions: CoachPracticeFocus['suggestions'] = [];

    const totalFoTaken = last5.reduce((sum, row) => sum + (row.fo_taken ?? 0), 0);
    const totalFoWon = last5.reduce((sum, row) => sum + (row.fo_won ?? 0), 0);
    if (totalFoTaken > 0 && totalFoWon / totalFoTaken < 0.5) {
      suggestions.push({
        area: 'Faceoffs',
        reason: 'Faceoff win rate is below 50 percent over the last 5 games.',
        priority: 'high',
      });
    }

    if (recent3.length === 3 && previous7.length > 0) {
      const recentGroundBalls = average(recent3.map((row) => row.ground_balls ?? 0));
      const previousGroundBalls = average(previous7.map((row) => row.ground_balls ?? 0));
      if (recentGroundBalls < previousGroundBalls) {
        suggestions.push({
          area: 'Ground Balls',
          reason: 'Ground balls per game are down over the last 3 games versus the previous sample.',
          priority: 'medium',
        });
      }

      const recentGoalsAgainst = average(recent3.map((row) => row.goals_against));
      const previousGoalsAgainst = average(previous7.map((row) => row.goals_against));
      if (recentGoalsAgainst > previousGoalsAgainst) {
        suggestions.push({
          area: 'Defense',
          reason: 'Goals against are trending up in the most recent games.',
          priority: 'high',
        });
      }
    }

    if (last5.length > 0) {
      const assistsPerGame = average(last5.map((row) => row.assists ?? 0));
      if (assistsPerGame < 3) {
        suggestions.push({
          area: 'Ball Movement / Passing',
          reason: 'Assists per game are below 3 over the last 5 games.',
          priority: 'medium',
        });
      }

      const totalSaves = last5.reduce((sum, row) => sum + (row.saves ?? 0), 0);
      const totalGoalsAgainst = last5.reduce((sum, row) => sum + row.goals_against, 0);
      const totalShotsAgainst = totalSaves + totalGoalsAgainst;
      if (totalShotsAgainst > 0 && totalSaves / totalShotsAgainst < 0.5) {
        suggestions.push({
          area: 'Goalie Training',
          reason: 'Save percentage is below 50 percent over the last 5 games.',
          priority: 'high',
        });
      }
    }

    const response: CoachPracticeFocus = { suggestions };
    return response;
  });
}
