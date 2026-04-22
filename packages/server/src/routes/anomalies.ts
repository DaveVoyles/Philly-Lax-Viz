import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import { mapAnomaly, type AnomalyRow } from '../queries/mappers.js';
import { getAnomalySummary } from '../queries/anomalies.js';

interface Query {
  limit?: string;
}

interface SummaryQuery {
  limit?: string;
  reason?: string;
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

  // Maintainer browser endpoint (W11 L3, Luke). Aggregates by reason +
  // most-frequent raw lines, used by the /anomalies web page for triage.
  // Kept on a sub-path so the legacy list shape at /api/anomalies stays stable.
  app.get<{ Querystring: SummaryQuery }>('/api/anomalies/summary', async (req, reply) => {
    let limit = 50;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'limit must be a positive integer' };
      }
      limit = Math.min(n, 500);
    }
    const reason = req.query.reason;
    return getAnomalySummary(db, {
      limit,
      ...(reason !== undefined ? { reason } : {}),
    });
  });
}
