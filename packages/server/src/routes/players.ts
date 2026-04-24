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

/**
 * Aggregated player detail used by `/api/players/:id` and the H8 compare
 * endpoint (`/api/compare/players`). Returns null when the player id does
 * not exist so callers can choose between 404 (single) and "omit" (batch).
 */
export function buildPlayerDetail(db: Database, id: number): {
  player: ReturnType<typeof mapPlayer>;
  team: ReturnType<typeof mapTeam> | null;
  seasonStats: {
    games: number;
    goals: number;
    assists: number;
    points: number;
    groundBalls: number;
    causedTurnovers: number;
    saves: number;
    foWon: number;
    foTaken: number;
  };
  perGame: Array<ReturnType<typeof mapPlayerStat> & { date: string }>;
} | null {
  const s = getStatements(db);
  const playerRow = s.getPlayerById.get(id) as PlayerRow | undefined;
  if (!playerRow) return null;
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
}

export async function playersRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const detail = buildPlayerDetail(db, id);
    if (!detail) {
      reply.code(404);
      return { error: 'NotFound', message: `Player ${id} not found` };
    }
    return detail;
  });
}
