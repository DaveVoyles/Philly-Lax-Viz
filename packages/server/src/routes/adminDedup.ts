import fp from 'fastify-plugin';
import type { Database } from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import {
  getDedupCandidate,
  listDedupCandidates,
  mergeDedupCandidate,
  updateDedupCandidate,
} from '../queries/adminDedup.js';

interface AdminDedupRoutesOptions {
  db: Database;
}

interface DedupCandidatesQuery {
  status?: string;
  limit?: string;
  offset?: string;
}

interface DedupCandidateParams {
  id: string;
}

interface UpdateDedupCandidateBody {
  status?: string;
  reviewer_notes?: string;
}

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'skipped']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePositiveInt(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseStatus(raw?: string): string | null {
  if (!raw) return null;
  return VALID_STATUSES.has(raw) ? raw : null;
}

function parseLimit(raw?: string): number {
  const value = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function parseOffset(raw?: string): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

const adminDedupRoutesImpl: FastifyPluginAsync<AdminDedupRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  app.get<{ Querystring: DedupCandidatesQuery }>('/api/admin/dedup-candidates', async (req, reply) => {
    const rawStatus = req.query.status?.trim();
    if (rawStatus && !VALID_STATUSES.has(rawStatus)) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: 'status must be one of pending, approved, rejected, skipped',
      };
    }

    const status = parseStatus(rawStatus ?? undefined);
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const candidates = listDedupCandidates(db, { status: status ?? undefined, limit, offset });
    const total = (
      db.prepare(
        `SELECT COUNT(*) AS c
         FROM dedup_candidates dc
         JOIN players pa ON pa.id = dc.player_a_id
         JOIN teams ta ON ta.id = pa.team_id
         JOIN players pb ON pb.id = dc.player_b_id
         JOIN teams tb ON tb.id = pb.team_id
         WHERE (? IS NULL OR dc.status = ?)`,
      ).get(status ?? null, status ?? null) as { c: number }
    ).c;

    return { candidates, total };
  });

  app.get<{ Params: DedupCandidateParams }>('/api/admin/dedup-candidates/:id', async (req, reply) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }

    const candidate = getDedupCandidate(db, id);
    if (!candidate) {
      reply.code(404);
      return { error: 'NotFound', message: `Dedup candidate ${id} not found` };
    }

    return candidate;
  });

  app.patch<{ Params: DedupCandidateParams; Body: UpdateDedupCandidateBody }>(
    '/api/admin/dedup-candidates/:id',
    async (req, reply) => {
      const id = parsePositiveInt(req.params.id);
      if (id === null) {
        reply.code(400);
        return { error: 'BadRequest', message: 'id must be a positive integer' };
      }

      const status = parseStatus(req.body?.status);
      if (!status || status === 'pending') {
        reply.code(400);
        return { error: 'BadRequest', message: 'status must be approved, rejected, or skipped' };
      }

      const candidate = getDedupCandidate(db, id);
      if (!candidate) {
        reply.code(404);
        return { error: 'NotFound', message: `Dedup candidate ${id} not found` };
      }

      updateDedupCandidate(db, id, {
        status,
        reviewer_notes: req.body?.reviewer_notes,
      });
      return { ok: true };
    },
  );

  app.post<{ Params: DedupCandidateParams }>('/api/admin/dedup-candidates/:id/merge', async (req, reply) => {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }

    const candidate = getDedupCandidate(db, id);
    if (!candidate) {
      reply.code(400);
      return { error: 'BadRequest', message: 'Candidate not found or already merged' };
    }

    if (candidate.status !== 'approved') {
      updateDedupCandidate(db, id, {
        status: 'approved',
        reviewer_notes: candidate.reviewer_notes ?? undefined,
      });
    }

    try {
      const { statsRedirected, statsDropped } = mergeDedupCandidate(db, id);
      return { ok: true, statsRedirected, statsDropped };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Candidate not found or already merged';
      reply.code(400);
      return { error: 'BadRequest', message };
    }
  });
};

const adminDedupRoutes = fp(adminDedupRoutesImpl, {
  name: 'pll-admin-dedup-routes',
  fastify: '5.x',
});

export default adminDedupRoutes;
