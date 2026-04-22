// GET /api/players/constellation?season=YYYY — flat scatter-plot data set.
// W15 L2 (R2). Honors the same season query parameter as /api/leaders/*.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getConstellation } from '../queries/constellation.js';
import { resolveSeason } from '../queries/seasons.js';

export async function constellationRoutes(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  app.get<{ Querystring: { season?: string } }>(
    '/api/players/constellation',
    async (req, reply) => {
      let season: number | undefined;
      try {
        const s = resolveSeason(db, req.query.season);
        season = s ?? undefined;
      } catch (e) {
        reply.code(400);
        return { error: (e as Error).message };
      }

      const players = getConstellation(db, { season });
      return { season: season ?? null, players };
    },
  );
}
