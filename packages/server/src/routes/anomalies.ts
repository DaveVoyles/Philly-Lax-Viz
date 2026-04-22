import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import { mapAnomaly, type AnomalyRow } from '../queries/mappers.js';

interface Query {
  limit?: string;
}

export async function anomaliesRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get<{ Querystring: Query }>('/api/anomalies', async (req, reply) => {
    let limit = 100;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'limit must be a positive integer' };
      }
      limit = Math.min(n, 500);
    }
    const rows = s.listAnomalies.all(limit) as AnomalyRow[];
    return rows.map(mapAnomaly);
  });
}
