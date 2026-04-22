// Coverage block: surfaces gap between PhillyLacrosse-tracked games and PIAA truth.
// team.coverage = { ourGames, piaaGames, gap }; piaaGames/gap null when no PIAA row.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2026-04-22T12:00:00Z';

function seed(d: Database): void {
  // Team 1: Harriton-like — has PIAA row AND tracked games.
  // Team 2: Episcopal-like — has PIAA row but ZERO tracked games.
  // Team 3: Malvern Prep-like — no PIAA row, but has tracked games.
  d.prepare(
    "INSERT INTO teams (id, name, slug, division) VALUES (1, 'Harriton', 'harriton', 'high-school')",
  ).run();
  d.prepare(
    "INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')",
  ).run();
  d.prepare(
    "INSERT INTO teams (id, name, slug, division) VALUES (3, 'Malvern Prep', 'malvern-prep', 'high-school')",
  ).run();

  // PIAA rows for teams 1 and 2; team 3 deliberately has none.
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Harriton', 'harriton', '3A', 4, 7, 4, 1, 22.0, 1.4, NOW);
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Episcopal Academy', 'episcopal', '3A', null, 10, 2, 0, 30.0, 2.5, NOW);

  // Two games for Harriton (id 1): one home, one away. Total ourGames = 2.
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
  ).run(101, '2026-04-10', 1, 3, 9, 8, 'post-101', NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
  ).run(102, '2026-04-15', 3, 1, 5, 11, 'post-102', NOW);
  // Episcopal (id 2) has zero games — it never appears in home_team_id or away_team_id.
}

beforeAll(async () => {
  db = openDb(':memory:');
  seed(db);
  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('coverage block on team endpoints', () => {
  it('team WITH PIAA + games surfaces ourGames, piaaGames, and gap', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.coverage).toEqual({
      ourGames: 2,
      piaaGames: 12, // 7 + 4 + 1
      gap: 10, // 12 - 2
    });
  });

  it('team WITH PIAA but ZERO games has gap equal to piaaGames', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.coverage).toEqual({
      ourGames: 0,
      piaaGames: 12, // 10 + 2 + 0
      gap: 12,
    });
  });

  it('team WITHOUT PIAA has piaaGames=null and gap=null but real ourGames', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.piaa).toBeNull();
    expect(body.team.coverage).toEqual({
      ourGames: 2,
      piaaGames: null,
      gap: null,
    });
  });

  it('GET /api/teams emits coverage on every team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string; coverage: unknown }>;
    expect(body).toHaveLength(3);
    for (const t of body) {
      expect(t.coverage).toBeDefined();
    }
    const byName = Object.fromEntries(body.map((t) => [t.name, t.coverage]));
    expect(byName['Harriton']).toEqual({ ourGames: 2, piaaGames: 12, gap: 10 });
    expect(byName['Episcopal']).toEqual({ ourGames: 0, piaaGames: 12, gap: 12 });
    expect(byName['Malvern Prep']).toEqual({ ourGames: 2, piaaGames: null, gap: null });
  });
});
