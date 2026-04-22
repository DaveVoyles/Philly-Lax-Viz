import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { defaultSeason, listSeasons } from '../queries/seasons.js';

export async function seasonsRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get('/api/seasons', async () => {
    const seasons = listSeasons(db);
    return { seasons, default: defaultSeason(db) };
  });
}
