import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { Database } from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import type { HudlTeam } from '@pll/shared';

interface HudlRoutesOptions {
  db: Database;
}

interface HudlTeamBody {
  teamId?: string;
  hudlTeamUrl?: string;
  hudlTeamName?: string;
}

interface HudlTeamParams {
  id: string;
}

interface HudlTeamPatchBody {
  status?: 'active' | 'paused';
}

type HudlTeamRow = HudlTeam;

const MUTABLE_STATUSES = new Set(['active', 'paused']);

const SELECT_HUDL_TEAMS = `
  SELECT
    h.id AS id,
    CAST(h.team_id AS TEXT) AS teamId,
    t.name AS teamName,
    h.hudl_team_url AS hudlTeamUrl,
    h.hudl_team_name AS hudlTeamName,
    h.status AS status,
    h.last_synced AS lastSynced,
    h.last_error AS lastError,
    h.created_at AS createdAt
  FROM hudl_teams h
  LEFT JOIN teams t ON t.id = h.team_id
`;

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getHudlTeamById(db: Database, id: string): HudlTeamRow | undefined {
  return db.prepare(`${SELECT_HUDL_TEAMS} WHERE h.id = ?`).get(id) as HudlTeamRow | undefined;
}

const hudlRoutesImpl: FastifyPluginAsync<HudlRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  app.get('/api/admin/hudl/teams', async () => {
    return db.prepare(`${SELECT_HUDL_TEAMS} ORDER BY t.name COLLATE NOCASE, h.created_at DESC`).all() as HudlTeamRow[];
  });

  app.post<{ Body: HudlTeamBody }>('/api/admin/hudl/teams', async (req, reply) => {
    const teamId = getNonEmptyString(req.body?.teamId);
    if (!teamId) {
      reply.code(400);
      return { error: 'BadRequest', message: 'teamId must be a non-empty string' };
    }

    const hudlTeamUrl = getNonEmptyString(req.body?.hudlTeamUrl);
    if (!hudlTeamUrl) {
      reply.code(400);
      return { error: 'BadRequest', message: 'hudlTeamUrl must be a non-empty string' };
    }

    const hudlTeamName = getNonEmptyString(req.body?.hudlTeamName);
    const teamExists = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId) as { id: number } | undefined;
    if (!teamExists) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${teamId} not found` };
    }

    const existing = db.prepare('SELECT id FROM hudl_teams WHERE team_id = ?').get(teamId) as { id: string } | undefined;
    if (existing) {
      reply.code(409);
      return { error: 'Conflict', message: `Hudl team already registered for team ${teamId}` };
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO hudl_teams (
        id,
        team_id,
        hudl_team_url,
        hudl_team_name,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, teamId, hudlTeamUrl, hudlTeamName, 'active', createdAt);

    const row = getHudlTeamById(db, id);
    reply.code(201);
    return row ?? { id, teamId, hudlTeamUrl, hudlTeamName, status: 'active', createdAt };
  });

  app.delete<{ Params: HudlTeamParams }>('/api/admin/hudl/teams/:id', async (req, reply) => {
    const result = db.prepare('DELETE FROM hudl_teams WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      reply.code(404);
      return { error: 'NotFound', message: `Hudl team ${req.params.id} not found` };
    }
    return { ok: true };
  });

  app.patch<{ Params: HudlTeamParams; Body: HudlTeamPatchBody }>(
    '/api/admin/hudl/teams/:id',
    async (req, reply) => {
      const status = getNonEmptyString(req.body?.status);
      if (!status || !MUTABLE_STATUSES.has(status)) {
        reply.code(400);
        return { error: 'BadRequest', message: 'status must be active or paused' };
      }

      const result = db.prepare('UPDATE hudl_teams SET status = ? WHERE id = ?').run(status, req.params.id);
      if (result.changes === 0) {
        reply.code(404);
        return { error: 'NotFound', message: `Hudl team ${req.params.id} not found` };
      }

      const row = getHudlTeamById(db, req.params.id);
      return row ?? { ok: true };
    },
  );
};

const hudlRoutes = fp(hudlRoutesImpl, {
  name: 'pll-hudl-routes',
  fastify: '5.x',
});

export default hudlRoutes;
