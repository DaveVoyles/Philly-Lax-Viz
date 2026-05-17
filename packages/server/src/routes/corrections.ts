import { createHash } from 'node:crypto';
import fp from 'fastify-plugin';
import type { Database } from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';

interface CorrectionsBody {
  submitterFirst?: string;
  submitterLast?: string;
  submitterEmail?: string;
  entityType?: 'player_stat' | 'game';
  entityId?: number;
  fieldName?: string;
  newValue?: string;
  note?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAILY_LIMIT = 10;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const emailRateLimit = new Map<string, { count: number; resetAt: number }>();

const CORRECTABLE_FIELDS = {
  goals:            { entityType: 'player_stat', table: 'player_stats', hardCap: 15, maxMultiplier: 5 },
  assists:          { entityType: 'player_stat', table: 'player_stats', hardCap: 15, maxMultiplier: 5 },
  ground_balls:     { entityType: 'player_stat', table: 'player_stats', hardCap: 30 },
  caused_turnovers: { entityType: 'player_stat', table: 'player_stats', hardCap: 20 },
  saves:            { entityType: 'player_stat', table: 'player_stats', hardCap: 40 },
  fo_won:           { entityType: 'player_stat', table: 'player_stats', hardCap: 40 },
  fo_taken:         { entityType: 'player_stat', table: 'player_stats', hardCap: 50 },
  home_score:       { entityType: 'game',        table: 'games',        hardCap: 30, maxMultiplier: 10 },
  away_score:       { entityType: 'game',        table: 'games',        hardCap: 30, maxMultiplier: 10 },
} as const satisfies Record<string, {
  entityType: 'player_stat' | 'game';
  table: string;
  hardCap?: number;
  maxMultiplier?: number;
}>;

type CorrectableFieldName = keyof typeof CORRECTABLE_FIELDS;

function parsePositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getRateLimitEntry(email: string, now: number): { count: number; resetAt: number } {
  const existing = emailRateLimit.get(email);
  if (!existing || existing.resetAt <= now) {
    // Purge all expired entries to prevent unbounded memory growth
    for (const [key, val] of emailRateLimit) {
      if (val.resetAt <= now) emailRateLimit.delete(key);
    }
    const entry = { count: 0, resetAt: now + ONE_DAY_MS };
    emailRateLimit.set(email, entry);
    return entry;
  }
  return existing;
}

function isCorrectableFieldName(value: string): value is CorrectableFieldName {
  return value in CORRECTABLE_FIELDS;
}

const correctionsRoutesImpl: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CorrectionsBody }>('/corrections', async (request, reply) => {
    const submitterFirst = getNonEmptyString(request.body?.submitterFirst);
    if (!submitterFirst) {
      reply.code(400);
      return { error: 'BadRequest', message: 'submitterFirst must be a non-empty string' };
    }

    const submitterLast = getNonEmptyString(request.body?.submitterLast);
    if (!submitterLast) {
      reply.code(400);
      return { error: 'BadRequest', message: 'submitterLast must be a non-empty string' };
    }

    const submitterEmail = getNonEmptyString(request.body?.submitterEmail)?.toLowerCase();
    if (!submitterEmail || !EMAIL_REGEX.test(submitterEmail)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'submitterEmail must be a valid email address' };
    }

    const fieldName = getNonEmptyString(request.body?.fieldName);
    if (!fieldName || !isCorrectableFieldName(fieldName)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'fieldName must be one of the supported correctable fields' };
    }

    const fieldConfig = CORRECTABLE_FIELDS[fieldName];
    if (request.body?.entityType !== fieldConfig.entityType) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: `entityType must match ${fieldName} (${fieldConfig.entityType})`,
      };
    }

    const entityId = parsePositiveInt(request.body?.entityId);
    if (entityId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'entityId must be a positive integer' };
    }

    const newValueRaw = getNonEmptyString(request.body?.newValue);
    if (!newValueRaw) {
      reply.code(400);
      return { error: 'BadRequest', message: 'newValue must be a non-empty string' };
    }

    const newValue = Number.parseInt(newValueRaw, 10);
    if (Number.isNaN(newValue)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'newValue must parse to an integer' };
    }

    const note = request.body?.note;
    if (note !== undefined && typeof note !== 'string') {
      reply.code(400);
      return { error: 'BadRequest', message: 'note must be a string when provided' };
    }
    if (typeof note === 'string' && note.length > 500) {
      reply.code(400);
      return { error: 'BadRequest', message: 'note must be 500 characters or fewer' };
    }

    const row = app.db
      .prepare(`SELECT ${fieldName} AS value FROM ${fieldConfig.table} WHERE id = ?`)
      .get(entityId) as { value: number | string | null } | undefined;

    if (!row) {
      reply.code(404);
      return {
        error: 'NotFound',
        message: `${fieldConfig.entityType} ${entityId} not found`,
      };
    }

    const oldValueText = row.value === null || row.value === undefined ? null : String(row.value);
    const oldValueNumber = typeof row.value === 'number' ? row.value : Number(row.value);

    const maxMultiplier = 'maxMultiplier' in fieldConfig ? fieldConfig.maxMultiplier : undefined;

    let status: 'pending' | 'outlier' = 'pending';
    if (fieldConfig.hardCap !== undefined && newValue > fieldConfig.hardCap) {
      status = 'outlier';
    } else if (
      maxMultiplier !== undefined &&
      Number.isFinite(oldValueNumber) &&
      oldValueNumber > 0 &&
      newValue / oldValueNumber > maxMultiplier
    ) {
      status = 'outlier';
    }

    const now = Date.now();
    const rateLimit = getRateLimitEntry(submitterEmail, now);
    if (rateLimit.count >= DAILY_LIMIT) {
      reply.code(429);
      return {
        error: 'TooManyRequests',
        message: 'Too many correction submissions for this email today',
      };
    }

    const ipHash = createHash('sha256').update(request.ip).digest('hex');
    const result = app.db
      .prepare(
        `INSERT INTO community_corrections (
          submitter_first,
          submitter_last,
          submitter_email,
          entity_type,
          entity_id,
          field_name,
          old_value,
          new_value,
          note,
          status,
          ip_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        submitterFirst,
        submitterLast,
        submitterEmail,
        fieldConfig.entityType,
        entityId,
        fieldName,
        oldValueText,
        String(newValue),
        note?.trim() || null,
        status,
        ipHash,
      );

    rateLimit.count += 1;
    return reply.code(201).send({ id: Number(result.lastInsertRowid), status });
  });
};

const correctionsRoutes = fp(correctionsRoutesImpl, {
  name: 'pll-corrections-routes',
  fastify: '5.x',
});

export default correctionsRoutes;
