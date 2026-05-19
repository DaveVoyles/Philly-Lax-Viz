import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';
import { parseUploadSheet } from '../util/parseUploadSheet.js';

let db: Database;
let app: FastifyInstance;

function seed(d: Database): void {
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')").run();
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (10, '2025-04-21', 1, 2, 12, 8, 0, 0, 'post-1', NULL, '2025-04-21T12:00:00Z', 2025)`,
  ).run();
  d.prepare(
    "INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (100, 'Sam Smith', 'sam smith', 1, 'full')",
  ).run();
  d.prepare(
    `INSERT INTO player_stats (
       id, game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence, season
     ) VALUES (1000, 10, 100, 2, 1, 3, 0, 0, 0, 0, 'summary', 'test', 1.0, 2025)`,
  ).run();
}

function buildMultipartPayload(fields: Record<string, string>, fileName: string, mimeType: string, content: string): {
  body: Buffer;
  boundary: string;
} {
  const boundary = '----pll-upload-test-boundary';
  const chunks: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`));
  chunks.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
  chunks.push(Buffer.from(content));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), boundary };
}

beforeAll(async () => {
  db = openDb(':memory:');
  seed(db);
  app = await buildApp(db, { logger: false, responseCache: false, logosDir: process.cwd() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('parseUploadSheet', () => {
  it('parses xlsx buffers and normalizes flexible column names', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Player Name', 'Game Date', 'Opp', 'G', 'A', 'GB', 'CT', 'SV', 'FO Won', 'FO Taken'],
      ['Sam Smith', '2025-04-21', 'Episcopal', 4, 2, 5, 1, 0, 3, 4],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Upload');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const parsed = parseUploadSheet(Buffer.from(buffer), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        playerName: 'Sam Smith',
        gameDate: '2025-04-21',
        opponent: 'Episcopal',
        goals: 4,
        assists: 2,
        groundBalls: 5,
        causedTurnovers: 1,
        saves: 0,
        foWon: 3,
        foTaken: 4,
      },
    ]);
  });

  it('returns row errors when required fields are missing', () => {
    const csv = ['player,game date,goals', ',2025-04-21,3'].join('\n');
    const parsed = parseUploadSheet(Buffer.from(csv), 'text/csv');
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([{ row: 2, message: 'playerName is required' }]);
  });
});

describe('upload routes', () => {
  it('previews, confirms, and reverts a coach upload', async () => {
    const csv = [
      'player,game date,opponent,goals,assists,gb',
      'Sam Smith,2025-04-21,Episcopal,4,2,5',
      'New Kid,2025-04-21,Episcopal,1,0,1',
    ].join('\n');

    const payload = buildMultipartPayload(
      {
        submitterName: 'Coach Han',
        submitterEmail: 'han@example.com',
        teamId: '1',
      },
      'stats.csv',
      'text/csv',
      csv,
    );

    const previewRes = await app.inject({
      method: 'POST',
      url: '/api/upload/preview',
      headers: {
        'content-type': `multipart/form-data; boundary=${payload.boundary}`,
      },
      payload: payload.body,
    });

    expect(previewRes.statusCode).toBe(200);
    const previewBody = previewRes.json() as {
      uploadId: string;
      matchedPlayers: Array<{ id: number; name: string }>;
      newPlayers: Array<{ name: string }>;
      statDiffs: Array<{ playerName: string; diffs: Array<{ field: string; from: number; to: number }> }>;
      rows: Array<{ action: string }>;
    };

    expect(previewBody.uploadId).toEqual(expect.any(String));
    expect(previewBody.matchedPlayers).toEqual([{ id: 100, name: 'Sam Smith', rows: 1 }]);
    expect(previewBody.newPlayers).toEqual([{ name: 'New Kid', rows: 1 }]);
    expect(previewBody.rows.map((row) => row.action)).toEqual(['replace', 'create_player']);
    expect(previewBody.statDiffs).toEqual([
      {
        row: 2,
        playerName: 'Sam Smith',
        gameId: 10,
        diffs: [
          { field: 'goals', from: 2, to: 4 },
          { field: 'assists', from: 1, to: 2 },
          { field: 'groundBalls', from: 3, to: 5 },
        ],
      },
    ]);

    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/upload/confirm',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ uploadId: previewBody.uploadId }),
    });

    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json()).toMatchObject({ uploadId: previewBody.uploadId, appliedRows: 2, createdPlayers: 1 });

    const uploadRow = db.prepare('SELECT status FROM manual_uploads WHERE id = ?').get(previewBody.uploadId) as { status: string };
    expect(uploadRow.status).toBe('applied');

    const uploadedStats = db.prepare(
      `SELECT player_id AS playerId, goals, assists, ground_balls AS groundBalls, source, upload_id AS uploadId
         FROM player_stats
        WHERE upload_id = ?
        ORDER BY player_id ASC`,
    ).all(previewBody.uploadId) as Array<{
      playerId: number;
      goals: number;
      assists: number;
      groundBalls: number;
      source: string;
      uploadId: string;
    }>;

    expect(uploadedStats).toHaveLength(2);
    expect(uploadedStats.every((row) => row.source === 'coach_upload')).toBe(true);
    expect(uploadedStats.map((row) => row.goals)).toEqual([4, 1]);

    const revertRes = await app.inject({
      method: 'POST',
      url: `/api/upload/revert/${previewBody.uploadId}`,
    });

    expect(revertRes.statusCode).toBe(200);
    expect(revertRes.json()).toMatchObject({ uploadId: previewBody.uploadId, revertedRows: 2, restoredRows: 1 });

    const revertedUploadRow = db.prepare('SELECT status FROM manual_uploads WHERE id = ?').get(previewBody.uploadId) as { status: string };
    expect(revertedUploadRow.status).toBe('reverted');

    const restoredSam = db.prepare(
      `SELECT goals, assists, ground_balls AS groundBalls, source, upload_id AS uploadId
         FROM player_stats
        WHERE game_id = 10 AND player_id = 100`,
    ).get() as { goals: number; assists: number; groundBalls: number; source: string; uploadId: string | null };
    expect(restoredSam).toEqual({ goals: 2, assists: 1, groundBalls: 3, source: 'summary', uploadId: null });

    const uploadRowCount = db.prepare('SELECT COUNT(*) AS c FROM player_stats WHERE upload_id = ?').get(previewBody.uploadId) as { c: number };
    expect(uploadRowCount.c).toBe(0);
  });
});
