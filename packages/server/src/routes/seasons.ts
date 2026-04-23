import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

// Wave 18 W1L2: /api/seasons is hardcoded to 2026 only.
// The db parameter is kept so app.ts registration is unchanged.
// DB query helpers (listSeasons, defaultSeason) are preserved for
// server-side query scoping via resolveSeason.
export async function seasonsRoutes(app: FastifyInstance, _db: Database): Promise<void> {
  app.get('/api/seasons', async () => {
    return { seasons: [2026], default: 2026 };
  });
}
