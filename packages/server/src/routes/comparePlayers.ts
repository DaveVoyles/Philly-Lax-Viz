// Wave H8 Lane 1 (Han) — batch player-detail endpoint backing the
// side-by-side compare view. Reuses `buildPlayerDetail` from players.ts so
// the wire shape matches `GET /api/players/:id` exactly.
//
// Contract: GET /api/compare/players?ids=12,34[,56[,78]]
//   - 2..4 ids, all positive integers
//   - returns { players: PlayerDetail[] } in request order
//   - missing ids are silently omitted (no 404). Documented choice: the
//     compare view shows a "not found" placeholder for any id the request
//     listed but the response did not return.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { buildPlayerDetail } from './players.js';

const MIN_IDS = 2;
const MAX_IDS = 4;

export function parseIdsParam(raw: unknown): { ok: true; ids: number[] } | { ok: false; message: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: 'ids query param is required' };
  }
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < MIN_IDS) {
    return { ok: false, message: `at least ${MIN_IDS} ids required` };
  }
  if (parts.length > MAX_IDS) {
    return { ok: false, message: `at most ${MAX_IDS} ids allowed` };
  }
  const ids: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      return { ok: false, message: `bad id "${p}": ids must be positive integers` };
    }
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, message: `bad id "${p}": ids must be positive integers` };
    }
    ids.push(n);
  }
  return { ok: true, ids };
}

export async function comparePlayersRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: { ids?: string } }>('/api/compare/players', async (req, reply) => {
    const parsed = parseIdsParam(req.query.ids);
    if (!parsed.ok) {
      reply.code(400);
      return { error: 'BadRequest', message: parsed.message };
    }
    // Sequential is fine — better-sqlite3 is synchronous; no I/O concurrency
    // win from Promise.all here, and order is naturally preserved.
    const players = parsed.ids
      .map((id) => buildPlayerDetail(db, id))
      .filter((d): d is NonNullable<ReturnType<typeof buildPlayerDetail>> => d !== null);
    return { players };
  });
}
