import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import {
  mapGame,
  mapGamePeriod,
  mapPlayerStat,
  mapTeam,
  type GameRow,
  type GamePeriodRow,
  type PlayerStatRow,
  type TeamRow,
} from '../queries/mappers.js';

interface ListQuery {
  date?: string;
  team_id?: string;
  limit?: string;
  offset?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function gamesRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get<{ Querystring: ListQuery }>('/api/games', async (req, reply) => {
    const { date, team_id } = req.query;

    let limit = 50;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'limit must be a positive integer' };
      }
      limit = Math.min(n, 200);
    }

    let offset = 0;
    if (req.query.offset !== undefined) {
      const n = Number(req.query.offset);
      if (!Number.isInteger(n) || n < 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'offset must be a non-negative integer' };
      }
      offset = n;
    }

    if (date !== undefined && !ISO_DATE.test(date)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'date must be YYYY-MM-DD' };
    }

    let teamId: number | undefined;
    if (team_id !== undefined) {
      const n = Number(team_id);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'team_id must be a positive integer' };
      }
      teamId = n;
    }

    let rows: GameRow[];
    if (date && teamId !== undefined) {
      rows = s.listGamesByDateAndTeam.all(date, teamId, teamId, limit, offset) as GameRow[];
    } else if (date) {
      rows = s.listGamesByDate.all(date, limit, offset) as GameRow[];
    } else if (teamId !== undefined) {
      rows = s.listGamesByTeam.all(teamId, teamId, limit, offset) as GameRow[];
    } else {
      rows = s.listGames.all(limit, offset) as GameRow[];
    }

    return rows.map(mapGame);
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const gameRow = s.getGameById.get(id) as GameRow | undefined;
    if (!gameRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Game ${id} not found` };
    }

    const periods = (s.periodsForGame.all(id) as GamePeriodRow[]).map(mapGamePeriod);

    const homeTeamRow = s.getTeamById.get(gameRow.home_team_id) as TeamRow | undefined;
    const awayTeamRow = s.getTeamById.get(gameRow.away_team_id) as TeamRow | undefined;

    type StatJoinRow = PlayerStatRow & { player_name: string; team_name: string };
    const statRows = s.playerStatsForGame.all(id) as StatJoinRow[];
    const playerStats = statRows.map((r) => ({
      ...mapPlayerStat(r),
      playerName: r.player_name,
      teamName: r.team_name,
    }));

    return {
      game: mapGame(gameRow),
      homeTeam: homeTeamRow ? mapTeam(homeTeamRow) : null,
      awayTeam: awayTeamRow ? mapTeam(awayTeamRow) : null,
      periods,
      playerStats,
    };
  });
}
