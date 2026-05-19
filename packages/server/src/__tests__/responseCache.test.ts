import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';

const NOW = '2025-04-21T12:00:00Z';

function seed(d: Database): void {
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')").run();
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (10, '2025-04-21', 1, 2, 12, 8, 0, 0, 'p-1', NULL, ?)`,
  ).run(NOW);
}

function expectedEtag(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

let db: Database;
let app: FastifyInstance;

beforeEach(async () => {
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
  it('sets MISS headers and an SHA-256 ETag on first cacheable GET', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['etag']).toBe(expectedEtag(res.body));
  });

  it('returns HIT for the same route pattern and URL', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/teams' });
    const second = await app.inject({ method: 'GET', url: '/api/teams' });

    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.headers['etag']).toBe(first.headers['etag']);
    expect(second.body).toBe(first.body);
  });

  it('returns 304 when If-None-Match matches a cached response', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/teams' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/teams',
      headers: { 'if-none-match': String(first.headers['etag']) },
    });

    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
    expect(res.headers['x-cache']).toBe('HIT');
    expect(res.headers['etag']).toBe(first.headers['etag']);
  });

  it('uses the full request URL in the cache key', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/games?limit=10&offset=0' });
    const b = await app.inject({ method: 'GET', url: '/api/games?offset=0&limit=10' });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.headers['x-cache']).toBe('MISS');
    expect(b.headers['x-cache']).toBe('MISS');
  });

  it('does not cache excluded routes', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/health' });
    const b = await app.inject({ method: 'GET', url: '/api/health' });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.headers['x-cache']).toBeUndefined();
    expect(b.headers['x-cache']).toBeUndefined();
    expect(a.headers['etag']).toBeUndefined();
    expect(b.headers['etag']).toBeUndefined();
  });

  it('does not cache non-2xx responses', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/games?date=garbage' });
    const b = await app.inject({ method: 'GET', url: '/api/games?date=garbage' });

    expect(a.statusCode).toBe(400);
    expect(b.statusCode).toBe(400);
    expect(a.headers['x-cache']).toBeUndefined();
    expect(b.headers['x-cache']).toBeUndefined();
  });

  it('does not cache POST routes', async () => {
    const payload = {
      entityType: 'game',
      entityId: 10,
      field: 'home_score',
      oldValue: '12',
      newValue: '13',
      justification: 'Box score typo',
      submitterName: 'Han Solo',
      submitterEmail: 'han@example.com',
    };

    const first = await app.inject({ method: 'POST', url: '/api/corrections', payload });
    const second = await app.inject({ method: 'POST', url: '/api/corrections', payload });

    expect(first.headers['x-cache']).toBeUndefined();
    expect(second.headers['x-cache']).toBeUndefined();
  });
});
