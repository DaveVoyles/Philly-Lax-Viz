// Wave 15 Lane 3 (Han 🧑‍🚀🍔) — server route tests for /api/commits.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

beforeAll(async () => {
  db = openDb(':memory:');
  db.prepare(`INSERT INTO teams (id, name, slug, division) VALUES (1, 'Twin Valley', 'twin-valley', 'high-school')`).run();
  db.prepare(
    `INSERT INTO commits (player_id, player_name_raw, high_school_team_id, college, division, announced_date, source_post_id, source_url)
     VALUES (NULL, 'Colin Gallagher', 1, 'Marquette',  'D1', '2025-09-03', 'p1', 'https://x/p1')`,
  ).run();
  db.prepare(
    `INSERT INTO commits (player_id, player_name_raw, high_school_team_id, college, division, announced_date, source_post_id, source_url)
     VALUES (NULL, 'Roman Ippoldo',   NULL, 'Cornell',   'D1', '2025-09-03', 'p1', 'https://x/p1')`,
  ).run();
  db.prepare(
    `INSERT INTO commits (player_id, player_name_raw, high_school_team_id, college, division, announced_date, source_post_id, source_url)
     VALUES (NULL, 'Andrew Haney',    NULL, 'Widener',   'D3', '2024-05-01', 'p2', 'https://x/p2')`,
  ).run();

  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('GET /api/commits', () => {
  it('returns all commits with season=all filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commits?season=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBeNull();
    expect(body.rows.length).toBe(3);
    expect(body.rows[0].playerName).toBeDefined();
    expect(body.rows[0].college).toBeDefined();
  });

  it('filters by season=2024 using announced_date prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commits?season=2024' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].playerName).toBe('Andrew Haney');
  });

  it('filters by college (case-insensitive)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/commits?college=marquette&season=all',
    });
    const body = res.json();
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].playerName).toBe('Colin Gallagher');
    expect(body.rows[0].highSchoolName).toBe('Twin Valley');
  });
});

describe('GET /api/commits/colleges', () => {
  it('aggregates commit counts by college', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commits/colleges?season=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const map = new Map<string, number>(
      (body.rows as Array<{ college: string; commits: number }>).map((r) => [r.college, r.commits]),
    );
    expect(map.get('Marquette')).toBe(1);
    expect(map.get('Cornell')).toBe(1);
    expect(map.get('Widener')).toBe(1);
  });

  it('respects season filter on the colleges aggregate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/commits/colleges?season=2025' });
    const body = res.json();
    expect(body.rows.length).toBe(2); // Marquette + Cornell, no Widener
  });
});
