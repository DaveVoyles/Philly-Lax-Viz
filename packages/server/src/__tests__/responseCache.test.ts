// RFC 03 — response cache + ETag/Cache-Control behaviour.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';
import { resetSnapshotEpochCache } from '../snapshot.js';

const NOW = '2025-04-21T12:00:00Z';

function seed(d: Database): void {
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')").run();
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (10, '2025-04-21', 1, 2, 12, 8, 0, 0, 'p-1', NULL, ?)`,
  ).run(NOW);
}

let db: Database;
let app: FastifyInstance;

beforeEach(async () => {
  resetSnapshotEpochCache();
  db = openDb(':memory:');
  seed(db);
  app = await buildApp(db);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('responseCache plugin', () => {
  it('first request is a MISS and sets ETag + Cache-Control', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.headers['etag']).toMatch(/^W\/"[0-9a-f]{16}"$/);
    expect(res.headers['cache-control']).toMatch(/public, max-age=30, must-revalidate/);
    expect(res.headers['vary']).toBe('Accept-Encoding');
  });

  it('second identical request is a HIT and returns the same body + etag', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/teams' });
    const second = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.headers['etag']).toBe(first.headers['etag']);
    expect(second.body).toBe(first.body);
  });

  it('If-None-Match matching the cached etag returns 304 with empty body', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/teams' });
    const etag = first.headers['etag'] as string;
    const res = await app.inject({
      method: 'GET',
      url: '/api/teams',
      headers: { 'if-none-match': etag },
    });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
    expect(res.headers['x-cache']).toBe('HIT-304');
    expect(res.headers['etag']).toBe(etag);
  });

  it('normalises query-string ordering', async () => {
    // Use /api/games which accepts query params; both should hit the same key.
    const a = await app.inject({ method: 'GET', url: '/api/games?limit=10&offset=0' });
    const b = await app.inject({ method: 'GET', url: '/api/games?offset=0&limit=10' });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.headers['x-cache']).toBe('MISS');
    expect(b.headers['x-cache']).toBe('HIT');
    expect(b.headers['etag']).toBe(a.headers['etag']);
  });

  it('does NOT cache /api/health (snapshot exposed there must stay live)', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/health' });
    const b = await app.inject({ method: 'GET', url: '/api/health' });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.headers['x-cache']).toBeUndefined();
    expect(b.headers['x-cache']).toBeUndefined();
    expect(a.headers['etag']).toBeUndefined();
  });

  it('exposes snapshotEpoch on /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const body = res.json();
    expect(typeof body.snapshotEpoch).toBe('string');
    expect(body.snapshotEpoch.length).toBeGreaterThan(0);
  });

  it('clearResponseCache invalidates entries (simulated snapshot rollover)', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(first.headers['x-cache']).toBe('MISS');
    const cached = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(cached.headers['x-cache']).toBe('HIT');

    app.clearResponseCache();

    const afterFlush = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(afterFlush.headers['x-cache']).toBe('MISS');
  });

  it('does not cache 4xx responses', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/games?date=garbage' });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({ method: 'GET', url: '/api/games?date=garbage' });
    expect(b.statusCode).toBe(400);
    // Neither response should set the response-cache headers since they aren't 200.
    expect(a.headers['x-cache']).toBeUndefined();
    expect(b.headers['x-cache']).toBeUndefined();
  });
});
