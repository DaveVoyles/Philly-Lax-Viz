import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import {
  mapGame,
  mapTeam,
  type GameRow,
  type TeamRow,
} from '../queries/mappers.js';

export async function teamsRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get('/api/teams', async () => {
    const rows = s.listTeams.all() as TeamRow[];
    return rows.map(mapTeam);
  });

  app.get<{ Params: { id: string } }>('/api/teams/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const teamRow = s.getTeamById.get(id) as TeamRow | undefined;
    if (!teamRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${id} not found` };
    }
    const team = mapTeam(teamRow);

    const gameRows = s.gamesForTeam.all(id, id) as GameRow[];
    const games = gameRows.map(mapGame);

    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const g of games) {
      if (g.postponed) continue;
      const isHome = g.homeTeamId === id;
      const myScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      if (myScore > oppScore) wins += 1;
      else if (myScore < oppScore) losses += 1;
      else ties += 1;
    }

    const rankRow = s.latestRankingForTeam.get(id) as { rank: number } | undefined;

    return {
      team,
      games,
      record: { wins, losses, ties },
      recentRanking: rankRow?.rank ?? null,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/teams/:id/topScorers',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'id must be a positive integer' };
      }
      const teamRow = s.getTeamById.get(id) as TeamRow | undefined;
      if (!teamRow) {
        reply.code(404);
        return { error: 'NotFound', message: `Team ${id} not found` };
      }
      const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : 5;
      const limit = Number.isFinite(rawLimit)
        ? Math.min(50, Math.max(1, Math.trunc(rawLimit)))
        : 5;

      const rows = s.topScorersForTeam.all(id, limit) as Array<{
        player_id: number;
        player_name: string;
        goals: number;
        assists: number;
      }>;
      return rows.map((r) => ({
        playerId: r.player_id,
        playerName: r.player_name,
        goals: r.goals,
        assists: r.assists,
      }));
    },
  );
}
