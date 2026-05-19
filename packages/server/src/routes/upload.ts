import { createHash, randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { Database } from 'better-sqlite3';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { normalizePlayerName } from '@pll/ingest/src/normalize/playerName.js';
import { parseUploadSheet, type ParsedUploadRow } from '../util/parseUploadSheet.js';

interface UploadPreviewBody {
  uploadId: string;
  fileName: string;
  rowCount: number;
  errors: Array<{ row: number; message: string }>;
  matchedPlayers: Array<{ id: number; name: string; rows: number }>;
  newPlayers: Array<{ name: string; rows: number }>;
  statDiffs: Array<{
    row: number;
    playerName: string;
    gameId: number;
    diffs: Array<{ field: string; from: number; to: number }>;
  }>;
  rows: Array<{
    row: number;
    playerName: string;
    gameId: number;
    opponent: string;
    action: 'insert' | 'replace' | 'create_player';
  }>;
}

interface MultipartUploadInput {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  submitterName: string;
  submitterEmail: string | null;
  teamId: number;
}

interface TeamPlayer {
  id: number;
  name: string;
  normalized: string;
  aliases: string[];
}

interface TeamGame {
  id: number;
  date: string;
  season: number;
  opponentName: string;
  opponentSlug: string;
  opponentAliases: string[];
}

interface ExistingStatRow {
  id: number;
  gameId: number;
  playerId: number;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
  source: string;
  parserVersion: string;
  confidence: number;
  season: number | null;
  uploadId: string | null;
}

interface UploadOperation {
  rowNumber: number;
  parsedRow: ParsedUploadRow;
  game: TeamGame;
  matchedPlayer?: TeamPlayer;
  playerNormalized: string;
  existingStat?: ExistingStatRow;
}

interface PendingUploadPlan {
  uploadId: string;
  teamId: number;
  fileName: string;
  rowCount: number;
  operations: UploadOperation[];
}

interface ConfirmBody {
  uploadId?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COACH_UPLOAD_PARSER_VERSION = 'coach-upload-v1';

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildLookupSet(...values: string[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeLookup(value);
    if (normalized) out.add(normalized);
  }
  return out;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

async function readMultipartUpload(request: FastifyRequest): Promise<MultipartUploadInput> {
  if (!request.isMultipart()) throw new Error('multipart/form-data request required');

  let fileBuffer: Buffer | null = null;
  let fileName = '';
  let mimeType = '';
  let submitterName = '';
  let submitterEmail: string | null = null;
  let teamIdRaw = '';

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      fileBuffer = await part.toBuffer();
      fileName = part.filename;
      mimeType = part.mimetype;
      continue;
    }

    const value = typeof part.value === 'string' ? part.value.trim() : '';
    if (part.fieldname === 'submitterName') submitterName = value;
    if (part.fieldname === 'submitterEmail') submitterEmail = value || null;
    if (part.fieldname === 'teamId') teamIdRaw = value;
  }

  if (!fileBuffer) throw new Error('file is required');
  if (!fileName) throw new Error('file name is required');

  const teamId = Number.parseInt(teamIdRaw, 10);
  if (!Number.isInteger(teamId) || teamId <= 0) throw new Error('teamId must be a positive integer');

  if (submitterEmail && !EMAIL_REGEX.test(submitterEmail)) {
    throw new Error('submitterEmail must be a valid email address');
  }

  return {
    fileBuffer,
    fileName,
    mimeType: mimeType || (fileName.toLowerCase().endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    submitterName: readRequiredString(submitterName, 'submitterName'),
    submitterEmail,
    teamId,
  };
}

function loadTeamPlayers(db: Database, teamId: number): TeamPlayer[] {
  const rows = db.prepare(
    `SELECT p.id, p.name, p.name_normalized, pa.alias
       FROM players p
       LEFT JOIN player_aliases pa ON pa.player_id = p.id
      WHERE p.team_id = ?
      ORDER BY p.id ASC`,
  ).all(teamId) as Array<{ id: number; name: string; name_normalized: string; alias: string | null }>;

  const byId = new Map<number, TeamPlayer>();
  for (const row of rows) {
    const existing = byId.get(row.id) ?? {
      id: row.id,
      name: row.name,
      normalized: row.name_normalized,
      aliases: [],
    };
    if (row.alias) existing.aliases.push(row.alias);
    byId.set(row.id, existing);
  }
  return Array.from(byId.values());
}

function loadTeamGames(db: Database, teamId: number): TeamGame[] {
  const rows = db.prepare(
    `SELECT g.id, g.date, g.season,
            opponent.name AS opponent_name,
            opponent.slug AS opponent_slug,
            ta.alias AS opponent_alias
       FROM games g
       JOIN teams opponent ON opponent.id = CASE
         WHEN g.home_team_id = ? THEN g.away_team_id
         ELSE g.home_team_id
       END
       LEFT JOIN team_aliases ta ON ta.team_id = opponent.id
      WHERE g.home_team_id = ? OR g.away_team_id = ?
      ORDER BY g.date ASC, g.id ASC`,
  ).all(teamId, teamId, teamId) as Array<{
    id: number;
    date: string;
    season: number;
    opponent_name: string;
    opponent_slug: string;
    opponent_alias: string | null;
  }>;

  const byId = new Map<number, TeamGame>();
  for (const row of rows) {
    const existing = byId.get(row.id) ?? {
      id: row.id,
      date: row.date,
      season: row.season,
      opponentName: row.opponent_name,
      opponentSlug: row.opponent_slug,
      opponentAliases: [],
    };
    if (row.opponent_alias) existing.opponentAliases.push(row.opponent_alias);
    byId.set(row.id, existing);
  }
  return Array.from(byId.values());
}

function resolvePlayer(players: TeamPlayer[], rawName: string): TeamPlayer | undefined {
  const normalized = normalizePlayerName(rawName);
  if (!normalized) return undefined;
  return players.find((player) => {
    if (player.normalized === normalized) return true;
    return player.aliases.some((alias) => normalizePlayerName(alias) === normalized);
  });
}

function resolveGame(games: TeamGame[], row: ParsedUploadRow): TeamGame | undefined {
  const onDate = games.filter((game) => game.date === row.gameDate);
  if (onDate.length <= 1) return onDate[0];
  const opponentToken = normalizeLookup(row.opponent);
  if (!opponentToken) return undefined;

  const matched = onDate.filter((game) => {
    const options = buildLookupSet(game.opponentName, game.opponentSlug, ...game.opponentAliases);
    return Array.from(options).some((option) => option === opponentToken || option.includes(opponentToken) || opponentToken.includes(option));
  });
  return matched.length === 1 ? matched[0] : undefined;
}

function loadExistingStat(db: Database, gameId: number, playerId: number): ExistingStatRow | undefined {
  return db.prepare(
    `SELECT id,
            game_id AS gameId,
            player_id AS playerId,
            goals,
            assists,
            ground_balls AS groundBalls,
            caused_turnovers AS causedTurnovers,
            saves,
            fo_won AS foWon,
            fo_taken AS foTaken,
            source,
            parser_version AS parserVersion,
            confidence,
            season,
            upload_id AS uploadId
       FROM player_stats
      WHERE game_id = ? AND player_id = ?`,
  ).get(gameId, playerId) as ExistingStatRow | undefined;
}

function buildDiffs(existing: ExistingStatRow, row: ParsedUploadRow): Array<{ field: string; from: number; to: number }> {
  const pairs = [
    ['goals', existing.goals, row.goals],
    ['assists', existing.assists, row.assists],
    ['groundBalls', existing.groundBalls, row.groundBalls],
    ['causedTurnovers', existing.causedTurnovers, row.causedTurnovers],
    ['saves', existing.saves, row.saves],
    ['foWon', existing.foWon, row.foWon],
    ['foTaken', existing.foTaken, row.foTaken],
  ] as const;

  return pairs
    .filter(([, from, to]) => from !== to)
    .map(([field, from, to]) => ({ field, from, to }));
}

function buildPreview(db: Database, teamId: number, parsedRows: ParsedUploadRow[], parserErrors: Array<{ row: number; message: string }>, fileName: string): { preview: UploadPreviewBody; plan: PendingUploadPlan } {
  const players = loadTeamPlayers(db, teamId);
  const games = loadTeamGames(db, teamId);
  const uploadId = randomUUID();
  const matchedPlayers = new Map<number, { id: number; name: string; rows: number }>();
  const newPlayers = new Map<string, { name: string; rows: number }>();
  const statDiffs: UploadPreviewBody['statDiffs'] = [];
  const previewRows: UploadPreviewBody['rows'] = [];
  const errors = [...parserErrors];
  const operations: UploadOperation[] = [];

  parsedRows.forEach((parsedRow, index) => {
    const rowNumber = index + 2;
    const game = resolveGame(games, parsedRow);
    if (!game) {
      errors.push({ row: rowNumber, message: `Unable to resolve game for ${parsedRow.gameDate}${parsedRow.opponent ? ` vs ${parsedRow.opponent}` : ''}` });
      return;
    }

    const playerNormalized = normalizePlayerName(parsedRow.playerName);
    if (!playerNormalized) {
      errors.push({ row: rowNumber, message: 'Unable to normalize playerName' });
      return;
    }

    const matchedPlayer = resolvePlayer(players, parsedRow.playerName);
    const existingStat = matchedPlayer ? loadExistingStat(db, game.id, matchedPlayer.id) : undefined;
    operations.push({ rowNumber, parsedRow, game, matchedPlayer, playerNormalized, existingStat });

    if (matchedPlayer) {
      const current = matchedPlayers.get(matchedPlayer.id) ?? { id: matchedPlayer.id, name: matchedPlayer.name, rows: 0 };
      current.rows += 1;
      matchedPlayers.set(matchedPlayer.id, current);
    } else {
      const current = newPlayers.get(playerNormalized) ?? { name: parsedRow.playerName, rows: 0 };
      current.rows += 1;
      newPlayers.set(playerNormalized, current);
    }

    const action = matchedPlayer ? (existingStat ? 'replace' : 'insert') : 'create_player';
    previewRows.push({
      row: rowNumber,
      playerName: parsedRow.playerName,
      gameId: game.id,
      opponent: game.opponentName,
      action,
    });

    if (existingStat) {
      const diffs = buildDiffs(existingStat, parsedRow);
      if (diffs.length > 0) {
        statDiffs.push({ row: rowNumber, playerName: matchedPlayer!.name, gameId: game.id, diffs });
      }
    }
  });

  return {
    preview: {
      uploadId,
      fileName,
      rowCount: parsedRows.length,
      errors,
      matchedPlayers: Array.from(matchedPlayers.values()),
      newPlayers: Array.from(newPlayers.values()),
      statDiffs,
      rows: previewRows,
    },
    plan: {
      uploadId,
      teamId,
      fileName,
      rowCount: parsedRows.length,
      operations,
    },
  };
}

const uploadRoutesImpl: FastifyPluginAsync = async (app) => {
  // TODO: Persist preview plans and overwritten stat snapshots in SQLite so
  // confirm/revert survive server restarts instead of relying on process memory.
  const pendingUploads = new Map<string, PendingUploadPlan>();
  const revertSnapshots = new Map<string, ExistingStatRow[]>();

  app.post('/api/upload/preview', async (request, reply) => {
    try {
      const input = await readMultipartUpload(request);
      const team = app.db.prepare('SELECT id, name FROM teams WHERE id = ?').get(input.teamId) as { id: number; name: string } | undefined;
      if (!team) {
        reply.code(404);
        return { error: 'NotFound', message: `team ${input.teamId} not found` };
      }

      const parsed = parseUploadSheet(input.fileBuffer, input.mimeType);
      const { preview, plan } = buildPreview(app.db, input.teamId, parsed.rows, parsed.errors, input.fileName);
      if (plan.operations.length === 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'No valid upload rows were found', errors: preview.errors };
      }

      const fileHash = createHash('sha256').update(input.fileBuffer).digest('hex');
      app.db.prepare(
        `INSERT INTO manual_uploads (
           id, submitter_name, submitter_email, team_id, file_hash, file_name, row_count, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      ).run(
        preview.uploadId,
        input.submitterName,
        input.submitterEmail,
        input.teamId,
        fileHash,
        input.fileName,
        plan.operations.length,
      );

      pendingUploads.set(preview.uploadId, plan);
      return reply.send(preview);
    } catch (error) {
      reply.code(400);
      return {
        error: 'BadRequest',
        message: error instanceof Error ? error.message : 'Unable to preview upload',
      };
    }
  });

  app.post<{ Body: ConfirmBody }>('/api/upload/confirm', async (request, reply) => {
    const uploadId = typeof request.body?.uploadId === 'string' ? request.body.uploadId : '';
    if (!uploadId) {
      reply.code(400);
      return { error: 'BadRequest', message: 'uploadId is required' };
    }

    const uploadRow = app.db.prepare('SELECT id, status FROM manual_uploads WHERE id = ?').get(uploadId) as { id: string; status: string } | undefined;
    if (!uploadRow) {
      reply.code(404);
      return { error: 'NotFound', message: `upload ${uploadId} not found` };
    }
    if (uploadRow.status !== 'pending') {
      reply.code(409);
      return { error: 'Conflict', message: `upload ${uploadId} is already ${uploadRow.status}` };
    }

    const plan = pendingUploads.get(uploadId);
    if (!plan) {
      reply.code(404);
      return { error: 'NotFound', message: `upload ${uploadId} is no longer available for confirmation` };
    }

    const insertPlayer = app.db.prepare(
      `INSERT INTO players (name, name_normalized, team_id, name_resolution)
       VALUES (?, ?, ?, 'full')`,
    );
    const selectPlayer = app.db.prepare(
      `SELECT id, name, name_normalized
         FROM players
        WHERE team_id = ? AND name_normalized = ?`,
    );
    const deleteStatById = app.db.prepare('DELETE FROM player_stats WHERE id = ?');
    const insertStat = app.db.prepare(
      `INSERT INTO player_stats (
         game_id,
         player_id,
         goals,
         assists,
         ground_balls,
         caused_turnovers,
         saves,
         fo_won,
         fo_taken,
         source,
         parser_version,
         confidence,
         season,
         upload_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'coach_upload', ?, 1.0, ?, ?)`,
    );
    const markApplied = app.db.prepare(
      `UPDATE manual_uploads
          SET status = 'applied', applied_at = datetime('now'), row_count = ?
        WHERE id = ?`,
    );

    const snapshots: ExistingStatRow[] = [];
    const createdPlayers = new Map<string, number>();
    const tx = app.db.transaction(() => {
      for (const operation of plan.operations) {
        let playerId = operation.matchedPlayer?.id;
        if (!playerId) {
          const cached = createdPlayers.get(operation.playerNormalized);
          if (cached) {
            playerId = cached;
          } else {
            const existing = selectPlayer.get(plan.teamId, operation.playerNormalized) as { id: number; name: string; name_normalized: string } | undefined;
            if (existing) {
              playerId = existing.id;
            } else {
              const inserted = insertPlayer.run(operation.parsedRow.playerName, operation.playerNormalized, plan.teamId);
              playerId = Number(inserted.lastInsertRowid);
            }
            createdPlayers.set(operation.playerNormalized, playerId);
          }
        }

        const existingStat = loadExistingStat(app.db, operation.game.id, playerId);
        if (existingStat) {
          snapshots.push(existingStat);
          deleteStatById.run(existingStat.id);
        }

        insertStat.run(
          operation.game.id,
          playerId,
          operation.parsedRow.goals,
          operation.parsedRow.assists,
          operation.parsedRow.groundBalls,
          operation.parsedRow.causedTurnovers,
          operation.parsedRow.saves,
          operation.parsedRow.foWon,
          operation.parsedRow.foTaken,
          COACH_UPLOAD_PARSER_VERSION,
          operation.game.season,
          uploadId,
        );
      }

      markApplied.run(plan.operations.length, uploadId);
    });

    tx();
    revertSnapshots.set(uploadId, snapshots);
    pendingUploads.delete(uploadId);

    return reply.send({
      uploadId,
      appliedRows: plan.operations.length,
      createdPlayers: createdPlayers.size,
    });
  });

  app.post<{ Params: { uploadId: string } }>('/api/upload/revert/:uploadId', async (request, reply) => {
    const uploadId = request.params.uploadId;
    const uploadRow = app.db.prepare('SELECT id, status FROM manual_uploads WHERE id = ?').get(uploadId) as { id: string; status: string } | undefined;
    if (!uploadRow) {
      reply.code(404);
      return { error: 'NotFound', message: `upload ${uploadId} not found` };
    }
    if (uploadRow.status !== 'applied') {
      reply.code(409);
      return { error: 'Conflict', message: `upload ${uploadId} is ${uploadRow.status}` };
    }

    const uploadedRows = app.db.prepare(
      `SELECT id,
              game_id AS gameId,
              player_id AS playerId,
              goals,
              assists,
              ground_balls AS groundBalls,
              caused_turnovers AS causedTurnovers,
              saves,
              fo_won AS foWon,
              fo_taken AS foTaken,
              source,
              parser_version AS parserVersion,
              confidence,
              season,
              upload_id AS uploadId
         FROM player_stats
        WHERE upload_id = ?`,
    ).all(uploadId) as ExistingStatRow[];

    const snapshots = revertSnapshots.get(uploadId) ?? [];
    const deleteUploadedRows = app.db.prepare('DELETE FROM player_stats WHERE upload_id = ?');
    const restoreRow = app.db.prepare(
      `INSERT INTO player_stats (
         id,
         game_id,
         player_id,
         goals,
         assists,
         ground_balls,
         caused_turnovers,
         saves,
         fo_won,
         fo_taken,
         source,
         parser_version,
         confidence,
         season,
         upload_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const markReverted = app.db.prepare(
      `UPDATE manual_uploads
          SET status = 'reverted', reverted_at = datetime('now')
        WHERE id = ?`,
    );

    const tx = app.db.transaction(() => {
      deleteUploadedRows.run(uploadId);
      for (const snapshot of snapshots) {
        restoreRow.run(
          snapshot.id,
          snapshot.gameId,
          snapshot.playerId,
          snapshot.goals,
          snapshot.assists,
          snapshot.groundBalls,
          snapshot.causedTurnovers,
          snapshot.saves,
          snapshot.foWon,
          snapshot.foTaken,
          snapshot.source,
          snapshot.parserVersion,
          snapshot.confidence,
          snapshot.season,
          snapshot.uploadId,
        );
      }
      markReverted.run(uploadId);
    });

    tx();
    revertSnapshots.delete(uploadId);

    return reply.send({
      uploadId,
      revertedRows: uploadedRows.length,
      restoredRows: snapshots.length,
    });
  });
};

const uploadRoutes = fp(uploadRoutesImpl, {
  name: 'pll-upload-routes',
  fastify: '5.x',
});

export default uploadRoutes;
