// schedule.ts — Wave 16 Lane 2 (Leia). HTTP route for upcoming games.
// GET /api/schedule?season=YYYY&from=DATE&to=DATE&team=ID
// Returns games grouped by date, ordered ascending.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  groupByDate,
  listScheduleGames,
  listUpcomingForTeam,
} from '../queries/schedule.js';

interface Query {
  season?: string;
  from?: string;
  to?: string;
  team?: string;
  limit?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export async function scheduleRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: Query }>('/api/schedule', async (req, reply) => {
    const from = req.query.from ?? todayIsoDate();
    if (!ISO_DATE.test(from)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'from must be YYYY-MM-DD' };
    }
    if (req.query.to !== undefined && !ISO_DATE.test(req.query.to)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'to must be YYYY-MM-DD' };
    }

    let season: number | undefined;
    if (req.query.season !== undefined) {
      const n = Number(req.query.season);
      if (!Number.isInteger(n) || n < 1900 || n > 3000) {
        reply.code(400);
        return { error: 'BadRequest', message: 'season must be a 4-digit year' };
      }
      season = n;
    }

    let teamId: number | undefined;
    if (req.query.team !== undefined) {
      const n = Number(req.query.team);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'team must be a positive integer' };
      }
      teamId = n;
    }

    let limit = 500;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'limit must be a positive integer' };
      }
      limit = Math.min(n, 1000);
    }

    const rows = listScheduleGames(db, {
      season,
      from,
      to: req.query.to,
      teamId,
      limit,
    });
    return {
      from,
      to: req.query.to ?? null,
      season: season ?? null,
      total: rows.length,
      byDate: groupByDate(rows),
    };
  });

  // Convenience: /api/schedule/team/:id/upcoming?limit=3
  app.get<{ Params: { id: string }; Querystring: { limit?: string; from?: string } }>(
    '/api/schedule/team/:id/upcoming',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'id must be a positive integer' };
      }
      let limit = 3;
      if (req.query.limit !== undefined) {
        const n = Number(req.query.limit);
        if (!Number.isInteger(n) || n <= 0 || n > 50) {
          reply.code(400);
          return { error: 'BadRequest', message: 'limit must be between 1 and 50' };
        }
        limit = n;
      }
      const from = req.query.from ?? todayIsoDate();
      if (!ISO_DATE.test(from)) {
        reply.code(400);
        return { error: 'BadRequest', message: 'from must be YYYY-MM-DD' };
      }
      const games = listUpcomingForTeam(db, id, from, limit);
      return { teamId: id, from, games };
    },
  );
}
