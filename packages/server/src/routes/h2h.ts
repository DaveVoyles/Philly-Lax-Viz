// Head-to-head route (W13 L3, R2).
// GET /api/h2h/teams?a=ID&b=ID
// GET /api/h2h/players?a=ID&b=ID

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getH2HPlayers, getH2HTeams } from '../queries/h2h.js';

function parseId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function h2hRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: { a?: string; b?: string } }>(
    '/api/h2h/teams',
    async (req, reply) => {
      const a = parseId(req.query.a);
      const b = parseId(req.query.b);
      if (a === null || b === null) {
        reply.code(400);
        return {
          error: 'BadRequest',
          message: 'Both query params a and b must be positive integers',
        };
      }
      return getH2HTeams(db, a, b);
    },
  );

  app.get<{ Querystring: { a?: string; b?: string } }>(
    '/api/h2h/players',
    async (req, reply) => {
      const a = parseId(req.query.a);
      const b = parseId(req.query.b);
      if (a === null || b === null) {
        reply.code(400);
        return {
          error: 'BadRequest',
          message: 'Both query params a and b must be positive integers',
        };
      }
      return getH2HPlayers(db, a, b);
    },
  );
}
