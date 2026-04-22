// Tests for /api/rivalries (W12 L2, Han).
// Seeds 3 teams + 2 games and verifies one edge with correct counts/margins.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2025-04-22T12:00:00Z';

beforeAll(async () => {
  db = openDb(':memory:');

  db.prepare("INSERT INTO teams (id, name, slug, division, logo_url) VALUES (1, 'Spring-Ford', 'spring-ford', 'high-school', '/logos/spring-ford.gif')").run();
  db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Boyertown', 'boyertown', 'high-school')").run();
  db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (3, 'Owen J. Roberts', 'ojr', 'high-school')").run();

  // Two completed Spring-Ford vs Boyertown games (one as home, one as away),
  // margins 4 and 3 → 2 games, totalMarginSum=7, avgMargin=3.5.
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (10, '2025-04-10', 1, 2, 12, 8, 0, 0, 'p1', NULL, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (11, '2025-04-18', 2, 1, 6, 9, 0, 0, 'p2', NULL, ?)`,
  ).run(NOW);

  // Postponed game (should be ignored even though scores are present).
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (12, '2025-04-20', 1, 3, 0, 0, 0, 1, 'p3', NULL, ?)`,
  ).run(NOW);

  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('GET /api/rivalries', () => {
  it('returns nodes and one aggregated edge with correct counts/margins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rivalries' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      nodes: { id: number; name: string; wins: number; losses: number; games: number; logo: string | null }[];
      edges: { source: number; target: number; games: number; totalMarginSum: number; avgMargin: number }[];
    };

    // Only Spring-Ford and Boyertown have completed games. OJR's only game is postponed.
    const ids = body.nodes.map((n) => n.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);

    const sf = body.nodes.find((n) => n.id === 1);
    expect(sf).toMatchObject({
      id: 1,
      name: 'Spring-Ford',
      games: 2,
      wins: 2,
      losses: 0,
      logo: '/logos/spring-ford.gif',
    });

    const by = body.nodes.find((n) => n.id === 2);
    expect(by).toMatchObject({
      id: 2,
      name: 'Boyertown',
      games: 2,
      wins: 0,
      losses: 2,
      logo: null,
    });

    expect(body.edges).toHaveLength(1);
    expect(body.edges[0]).toEqual({
      source: 1,
      target: 2,
      games: 2,
      totalMarginSum: 7,
      avgMargin: 3.5,
    });
  });
});
