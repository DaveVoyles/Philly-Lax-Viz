import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';

export async function healthRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get('/api/health', async () => {
    const num = (stmt: import('better-sqlite3').Statement): number => {
      const row = stmt.get() as { c: number };
      return row.c;
    };
    return {
      ok: true,
      dbRows: {
        teams: num(s.countTeams),
        games: num(s.countGames),
        players: num(s.countPlayers),
        playerStats: num(s.countPlayerStats),
        rankings: num(s.countRankings),
        anomalies: num(s.countAnomalies),
      },
    };
  });
}
