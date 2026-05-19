import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { CoachDashboardResponse } from '@pll/shared';
import { getStatements } from '../queries/statements.js';
import { resolveSeason } from '../queries/seasons.js';
import { type TeamRow } from '../queries/mappers.js';

interface CoachDashboardQuery {
  teamId?: string;
  season?: string;
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

function buildSeasonClause(season: number | null, alias = 'g'): string {
  return season === null ? '' : ` AND ${alias}.season = @season`;
}

export async function coachDashboardRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const statements = getStatements(db);

  app.get<{ Querystring: CoachDashboardQuery }>('/api/coach/dashboard', async (req, reply) => {
    const teamId = Number(req.query.teamId);
    if (!Number.isInteger(teamId) || teamId <= 0) {
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
    const statSeasonClause = season === null ? '' : ' AND ps.season = @season';

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

    const record = db.prepare(`
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
        ${gameSeasonClause}
    `).get(params) as RecordRow;

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
        record: `${record.wins}-${record.losses}`,
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
}
