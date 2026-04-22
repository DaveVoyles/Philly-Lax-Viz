// Tests for /api/anomalies/summary (W11 L3, Luke).
// Seeds a handful of anomaly rows and asserts the aggregate response shape.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2025-04-22T12:00:00Z';

function insertAnomaly(
  d: Database,
  postId: string,
  url: string,
  rawLine: string,
  strategy: string,
  reason: string,
): void {
  d.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(postId, url, rawLine, strategy, reason, NOW);
}

beforeAll(async () => {
  db = openDb(':memory:');

  // Two reasons, one with a duplicated raw line to exercise topRawLines aggregation.
  insertAnomaly(
    db,
    'post-A',
    'https://phillylacrosse.com/a/1',
    'Christian Jones 0g 0a',
    'player-stat-line',
    'sub-header did not match either game team; likely a score line the parser missed',
  );
  insertAnomaly(
    db,
    'post-A',
    'https://phillylacrosse.com/a/2',
    'Christian Jones 0g 0a',
    'player-stat-line',
    'sub-header did not match either game team; likely a score line the parser missed',
  );
  insertAnomaly(
    db,
    'post-B',
    'https://phillylacrosse.com/b/1',
    'Some other dropped line',
    'player-stat-line',
    'sub-header did not match either game team; likely a score line the parser missed',
  );
  insertAnomaly(
    db,
    'post-C',
    'https://phillylacrosse.com/c/1',
    'team hint Foo',
    'team-hint',
    'team hint did not resolve to either side of the score line',
  );

  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('GET /api/anomalies/summary', () => {
  it('returns totalCount, byReason, and topRawLines aggregates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomalies/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totalCount: number;
      byReason: { reason: string; count: number }[];
      topRawLines: { rawLine: string; reason: string; count: number; exampleSourceUrl: string | null }[];
    };

    expect(body.totalCount).toBe(4);
    expect(body.byReason).toHaveLength(2);
    expect(body.byReason[0]).toEqual({
      reason: 'sub-header did not match either game team; likely a score line the parser missed',
      count: 3,
    });
    expect(body.byReason[1]).toEqual({
      reason: 'team hint did not resolve to either side of the score line',
      count: 1,
    });

    // Most-frequent raw line should be the duplicated one (count: 2), with a source URL.
    expect(body.topRawLines[0]).toMatchObject({
      rawLine: 'Christian Jones 0g 0a',
      count: 2,
    });
    expect(body.topRawLines[0]?.exampleSourceUrl).toMatch(/^https:\/\/phillylacrosse\.com\//);
    // Three distinct (raw_line, reason) groups in seed.
    expect(body.topRawLines).toHaveLength(3);
  });

  it('honors ?limit=', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomalies/summary?limit=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { topRawLines: unknown[] };
    expect(body.topRawLines).toHaveLength(1);
  });

  it('400s on bad limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomalies/summary?limit=0' });
    expect(res.statusCode).toBe(400);
  });

  it('filters by ?reason=', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/anomalies/summary?reason=' +
        encodeURIComponent('team hint did not resolve to either side of the score line'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totalCount: number;
      byReason: { reason: string; count: number }[];
      topRawLines: unknown[];
    };
    expect(body.totalCount).toBe(1);
    expect(body.byReason).toHaveLength(1);
    expect(body.topRawLines).toHaveLength(1);
  });
});
