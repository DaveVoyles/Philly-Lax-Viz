import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { PlayerMilestones } from '@pll/shared';
import { getStatements } from '../queries/statements.js';
import { listPlayersBySeason } from '../queries/playerList.js';
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

interface PlayerDetailResult {
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
  perGame: Array<ReturnType<typeof mapPlayerStat> & {
    date: string;
    opponentName: string | null;
    opponentLogoUrl: string | null;
    opponentId: number | null;
  }>;
}

function milestoneBest(
  perGame: PlayerDetailResult['perGame'],
  pickValue: (row: PlayerDetailResult['perGame'][number]) => number,
): PlayerMilestones['careerHighGoals'] {
  let best: PlayerMilestones['careerHighGoals'] = null;
  for (const row of perGame) {
    const value = pickValue(row);
    if (best === null || value > best.value) {
      best = {
        value,
        opponent: row.opponentName ?? 'Unknown opponent',
        date: row.date,
      };
    }
  }
  return best;
}

export function buildPlayerMilestones(db: Database, id: number): PlayerMilestones | null {
  const detail = buildPlayerDetail(db, id);
  if (!detail) return null;
  const careerHighGoals = milestoneBest(detail.perGame, (row) => row.goals);
  const careerHighAssists = milestoneBest(detail.perGame, (row) => row.assists);
  const careerHighPoints = milestoneBest(detail.perGame, (row) => row.goals + row.assists);

  return {
    careerHighGoals,
    careerHighAssists,
    careerHighPoints,
    careerTotals: {
      goals: detail.seasonStats.goals,
      assists: detail.seasonStats.assists,
      groundBalls: detail.seasonStats.groundBalls,
      games: detail.seasonStats.games,
    },
  };
}

/**
 * Aggregated player detail used by `/api/players/:id` and the H8 compare
 * endpoint (`/api/compare/players`). Returns null when the player id does
 * not exist so callers can choose between 404 (single) and "omit" (batch).
 */
export function buildPlayerDetail(db: Database, id: number): PlayerDetailResult | null {
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
    PlayerStatRow & {
      game_date: string;
      opponent_name: string | null;
      opponent_logo_url: string | null;
      opponent_id: number | null;
    }
  >;
  const perGame = perGameRows.map((row) => ({
    ...mapPlayerStat(row),
    date: row.game_date,
    opponentName: row.opponent_name ?? null,
    opponentLogoUrl: row.opponent_logo_url ? `/logos/${row.opponent_logo_url}` : null,
    opponentId: row.opponent_id ?? null,
  }));

  return {
    player: mapPlayer(playerRow),
    team: teamRow ? mapTeam(teamRow) : null,
    seasonStats,
    perGame,
  };
}

export async function playersRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: { season?: string; search?: string; limit?: string } }>(
    '/api/players',
    async (req) => {
      const season = req.query.season?.trim() || null;
      const search = req.query.search?.trim() || null;
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 500), 1000));
      return listPlayersBySeason(db, season, search, Number.isFinite(limit) ? limit : 500).map((row) => ({
        id: row.id,
        name: row.name,
        teamId: row.team_id,
        teamName: row.team_name,
        teamSlug: row.team_slug,
      }));
    },
  );

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

  app.get<{ Params: { id: string } }>('/api/players/:id/milestones', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const milestones = buildPlayerMilestones(db, id);
    if (!milestones) {
      reply.code(404);
      return { error: 'NotFound', message: `Player ${id} not found` };
    }
    return milestones;
  });
}
