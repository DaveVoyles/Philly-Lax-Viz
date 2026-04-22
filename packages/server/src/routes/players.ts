import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import {
  mapPlayer,
  mapPlayerStat,
  mapTeam,
  type PlayerRow,
  type PlayerStatRow,
  type TeamRow,
} from '../queries/mappers.js';

interface SeasonStatsRow {
  games: number;
  goals: number;
  assists: number;
  points: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
}

export async function playersRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const playerRow = s.getPlayerById.get(id) as PlayerRow | undefined;
    if (!playerRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Player ${id} not found` };
    }
    const teamRow = s.getTeamById.get(playerRow.team_id) as TeamRow | undefined;

    const agg = s.seasonStatsForPlayer.get(id) as SeasonStatsRow;
    const seasonStats = {
      games: agg.games,
      goals: agg.goals,
      assists: agg.assists,
      points: agg.points,
      groundBalls: agg.ground_balls,
      causedTurnovers: agg.caused_turnovers,
      saves: agg.saves,
      foWon: agg.fo_won,
      foTaken: agg.fo_taken,
    };

    const perGameRows = s.perGameStatsForPlayer.all(id) as Array<
      PlayerStatRow & { game_date: string }
    >;
    const perGame = perGameRows.map((row) => ({
      ...mapPlayerStat(row),
      date: row.game_date,
    }));

    return {
      player: mapPlayer(playerRow),
      team: teamRow ? mapTeam(teamRow) : null,
      seasonStats,
      perGame,
    };
  });
}
