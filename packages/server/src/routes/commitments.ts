import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { Commitment, CommitmentSubmission, CommitmentSelfSubmission } from '@pll/shared';

interface CommitmentRow {
  id: string;
  playerId: string;
  playerName: string | null;
  teamName: string | null;
  college: string;
  division: string | null;
  commitDate: string | null;
  status: Commitment['status'];
  source: Commitment['source'];
  verified: number;
  createdAt: string;
  updatedAt: string;
}

interface CommitmentFilters {
  teamId?: string;
  division?: string;
  status?: string;
}

interface CommitmentParams {
  playerId?: string;
  id?: string;
}

interface CommitmentPatchBody {
  verified?: boolean;
  status?: Commitment['status'];
}

const COMMITMENT_STATUSES: ReadonlySet<Commitment['status']> = new Set([
  'verbal',
  'committed',
  'signed',
  'decommitted',
]);
const SUBMISSION_STATUSES: ReadonlySet<NonNullable<CommitmentSubmission['status']>> = new Set([
  'verbal',
  'committed',
  'signed',
]);
const SUBMISSION_SOURCES: ReadonlySet<NonNullable<CommitmentSubmission['source']>> = new Set([
  'player',
  'coach',
]);

const SELECT_COMMITMENTS = `
  SELECT
    c.id AS id,
    CAST(c.player_id AS TEXT) AS playerId,
    p.name AS playerName,
    t.name AS teamName,
    c.college AS college,
    c.division AS division,
    c.commit_date AS commitDate,
    c.status AS status,
    c.source AS source,
    c.verified AS verified,
    c.created_at AS createdAt,
    c.updated_at AS updatedAt
  FROM commitments c
  JOIN players p ON p.id = c.player_id
  LEFT JOIN teams t ON t.id = p.team_id
`;

function mapCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    playerId: String(row.playerId),
    ...(row.playerName ? { playerName: row.playerName } : {}),
    ...(row.teamName ? { teamName: row.teamName } : {}),
    college: row.college,
    ...(row.division ? { division: row.division } : {}),
    ...(row.commitDate ? { commitDate: row.commitDate } : {}),
    status: row.status,
    source: row.source,
    verified: row.verified === 1,
    createdAt: row.createdAt,
  };
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getPositiveInteger(value: unknown): number | null {
  const raw = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

function getCommitmentById(db: Database, id: string): Commitment | null {
  const row = db.prepare(`${SELECT_COMMITMENTS} WHERE c.id = ?`).get(id) as CommitmentRow | undefined;
  return row ? mapCommitment(row) : null;
}

export function getCommitmentForPlayer(db: Database, playerId: number): Commitment | null {
  try {
    const row = db.prepare(`${SELECT_COMMITMENTS} WHERE c.player_id = ? LIMIT 1`).get(playerId) as CommitmentRow | undefined;
    return row ? mapCommitment(row) : null;
  } catch { return null; }
}

export function listCommitments(db: Database, filters: CommitmentFilters = {}): Commitment[] {
  try { db.prepare('SELECT 1 FROM commitments LIMIT 0').run(); } catch { return []; }
  const where: string[] = [];
  const args: Array<string | number> = [];

  const teamId = getPositiveInteger(filters.teamId);
  if (filters.teamId !== undefined && teamId === null) {
    return [];
  }
  if (teamId !== null) {
    where.push('p.team_id = ?');
    args.push(teamId);
  }

  const division = getNonEmptyString(filters.division);
  if (division) {
    where.push('c.division = ?');
    args.push(division);
  }

  const status = getNonEmptyString(filters.status);
  if (status && COMMITMENT_STATUSES.has(status as Commitment['status'])) {
    where.push('c.status = ?');
    args.push(status);
  }

  const sql = `${SELECT_COMMITMENTS}
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(c.commit_date, c.created_at) DESC, c.created_at DESC, p.name COLLATE NOCASE ASC`;

  return (db.prepare(sql).all(...args) as CommitmentRow[]).map(mapCommitment);
}

export async function commitmentsRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: CommitmentFilters }>('/api/commitments', async (req) => {
    return listCommitments(db, req.query ?? {});
  });

  app.get<{ Params: CommitmentParams }>('/api/commitments/:playerId', async (req, reply) => {
    const playerId = getPositiveInteger(req.params.playerId);
    if (playerId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'playerId must be a positive integer' };
    }

    const commitment = getCommitmentForPlayer(db, playerId);
    if (!commitment) {
      reply.code(404);
      return { error: 'NotFound', message: `Commitment for player ${playerId} not found` };
    }

    return commitment;
  });

  app.post<{ Body: CommitmentSubmission }>('/api/commitments', async (req, reply) => {
    const playerId = getPositiveInteger(req.body?.playerId);
    if (playerId === null) {
      reply.code(400);
      return { error: 'BadRequest', message: 'playerId must be a positive integer' };
    }

    const playerExists = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId) as { id: number } | undefined;
    if (!playerExists) {
      reply.code(404);
      return { error: 'NotFound', message: `Player ${playerId} not found` };
    }

    const college = getNonEmptyString(req.body?.college);
    if (!college) {
      reply.code(400);
      return { error: 'BadRequest', message: 'college must be a non-empty string' };
    }

    const division = getNonEmptyString(req.body?.division);
    const commitDate = getNonEmptyString(req.body?.commitDate);
    const status = req.body?.status ?? 'verbal';
    if (!SUBMISSION_STATUSES.has(status)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'status must be verbal, committed, or signed' };
    }

    const source = req.body?.source ?? 'player';
    if (!SUBMISSION_SOURCES.has(source)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'source must be player or coach' };
    }

    const existing = db.prepare('SELECT id FROM commitments WHERE player_id = ? LIMIT 1').get(playerId) as { id: string } | undefined;
    if (existing) {
      reply.code(409);
      return { error: 'Conflict', message: `Player ${playerId} already has a commitment` };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO commitments (
        id,
        player_id,
        college,
        division,
        commit_date,
        status,
        source,
        verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(id, playerId, college, division, commitDate, status, source);

    const commitment = getCommitmentById(db, id);
    reply.code(201);
    return commitment ?? {
      id,
      playerId: String(playerId),
      college,
      ...(division ? { division } : {}),
      ...(commitDate ? { commitDate } : {}),
      status,
      source,
      verified: false,
      createdAt: new Date().toISOString(),
    };
  });

  app.patch<{ Params: CommitmentParams; Body: CommitmentPatchBody }>(
    '/api/commitments/:id',
    async (req, reply) => {
      const id = getNonEmptyString(req.params.id);
      if (!id) {
        reply.code(400);
        return { error: 'BadRequest', message: 'id must be a non-empty string' };
      }

      const updates: string[] = [];
      const args: Array<string | number> = [];

      if (typeof req.body?.verified === 'boolean') {
        updates.push('verified = ?');
        args.push(req.body.verified ? 1 : 0);
      }

      if (req.body?.status !== undefined) {
        if (!COMMITMENT_STATUSES.has(req.body.status)) {
          reply.code(400);
          return { error: 'BadRequest', message: 'status is invalid' };
        }
        updates.push('status = ?');
        args.push(req.body.status);
      }

      if (updates.length === 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'Provide verified and/or status to update' };
      }

      updates.push("updated_at = datetime('now')");
      const result = db.prepare(`UPDATE commitments SET ${updates.join(', ')} WHERE id = ?`).run(...args, id);
      if (result.changes === 0) {
        reply.code(404);
        return { error: 'NotFound', message: `Commitment ${id} not found` };
      }

      return getCommitmentById(db, id) ?? { ok: true };
    },
  );

  app.delete<{ Params: CommitmentParams }>('/api/commitments/:id', async (req, reply) => {
    const id = getNonEmptyString(req.params.id);
    if (!id) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a non-empty string' };
    }

    const result = db.prepare('DELETE FROM commitments WHERE id = ?').run(id);
    if (result.changes === 0) {
      reply.code(404);
      return { error: 'NotFound', message: `Commitment ${id} not found` };
    }

    return { ok: true };
  });

  // Self-service commitment submission (no existing player ID required)
  app.post<{ Body: CommitmentSelfSubmission }>('/api/commitments/submit', async (req, reply) => {
    const firstName = getNonEmptyString(req.body?.firstName);
    const lastName = getNonEmptyString(req.body?.lastName);
    if (!firstName || !lastName) {
      reply.code(400);
      return { error: 'BadRequest', message: 'firstName and lastName are required' };
    }

    const position = getNonEmptyString(req.body?.position);
    const validPositions = new Set(['Attack', 'Midfield', 'LSM', 'Defense', 'Goalie']);
    if (!position || !validPositions.has(position)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'position must be Attack, Midfield, LSM, Defense, or Goalie' };
    }

    const highSchool = getNonEmptyString(req.body?.highSchool);
    if (!highSchool) {
      reply.code(400);
      return { error: 'BadRequest', message: 'highSchool is required' };
    }

    const college = getNonEmptyString(req.body?.college);
    if (!college) {
      reply.code(400);
      return { error: 'BadRequest', message: 'college is required' };
    }

    const division = getNonEmptyString(req.body?.division);
    const validDivisions = new Set(['D1', 'D2', 'D3', 'JUCO', 'MCLA']);
    if (!division || !validDivisions.has(division)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'division must be D1, D2, D3, JUCO, or MCLA' };
    }

    const status = req.body?.status ?? 'committed';
    if (!SUBMISSION_STATUSES.has(status)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'status must be verbal, committed, or signed' };
    }

    const fullName = `${firstName} ${lastName}`;

    // Find or create the player
    let playerRow = db.prepare(
      'SELECT id FROM players WHERE name = ? COLLATE NOCASE LIMIT 1',
    ).get(fullName) as { id: number } | undefined;

    if (!playerRow) {
      // Try to find team by high school name
      const teamRow = db.prepare(
        'SELECT id FROM teams WHERE name LIKE ? COLLATE NOCASE LIMIT 1',
      ).get(`%${highSchool}%`) as { id: number } | undefined;

      const insertPlayer = db.prepare(
        'INSERT INTO players (name, team_id) VALUES (?, ?)',
      );
      const result = insertPlayer.run(fullName, teamRow?.id ?? null);
      playerRow = { id: Number(result.lastInsertRowid) };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO commitments (
        id, player_id, college, division, commit_date, status, source, verified
      ) VALUES (?, ?, ?, ?, datetime('now'), ?, 'player', 0)`,
    ).run(id, playerRow.id, college, division, status);

    const commitment = getCommitmentById(db, id);
    reply.code(201);
    return commitment ?? {
      id,
      playerId: String(playerRow.id),
      playerName: fullName,
      college,
      division,
      status,
      source: 'player' as const,
      verified: false,
      createdAt: new Date().toISOString(),
    };
  });
}
