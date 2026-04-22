// PIAA join coverage: ensures /api/teams and /api/teams/:id surface the
// piaa block (or null) via direct name match AND the team_aliases path.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2026-04-22T12:00:00Z';

function seed(d: Database): void {
  d.prepare(
    "INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')",
  ).run();
  d.prepare(
    "INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')",
  ).run();
  d.prepare(
    "INSERT INTO teams (id, name, slug, division) VALUES (3, 'Malvern Prep', 'malvern-prep', 'high-school')",
  ).run();

  // Give Malvern Prep at least one player so it survives the listTeams filter
  // (ghost teams without games/players/PIAA mappings are hidden by design).
  d.prepare(
    "INSERT INTO players (team_id, name, name_normalized) VALUES (3, 'Test Player', 'test player')",
  ).run();

  // PIAA rows: Haverford matches via alias, Episcopal matches via name.
  // Malvern Prep intentionally has no PIAA row to exercise the null branch.
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Haverford School', 'haverford school', '3A', 5, 4, 8, 0, 12.5, 0.6, NOW);
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Episcopal Academy', 'episcopal', '3A', null, 10, 2, 1, 30.0, 2.5, NOW);

  d.prepare(
    `INSERT INTO team_aliases (alias, team_id, source, confidence) VALUES (?, ?, 'manual', 1.0)`,
  ).run('haverford school', 1);
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

describe('PIAA enrichment on team endpoints', () => {
  it('GET /api/teams/:id returns piaa block for a team matched via alias', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.piaa).not.toBeNull();
    expect(body.team.piaa).toMatchObject({
      wins: 4,
      losses: 8,
      ties: 0,
      seed: 5,
      classification: '3A',
      ranking: 0.6,
      totalPoints: 12.5,
      nameOfficial: 'Haverford School',
    });
  });

  it('GET /api/teams/:id returns piaa block for a team matched via name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.piaa).not.toBeNull();
    expect(body.team.piaa).toMatchObject({
      wins: 10,
      losses: 2,
      ties: 1,
      seed: null,
      classification: '3A',
      nameOfficial: 'Episcopal Academy',
    });
  });

  it('GET /api/teams/:id returns piaa: null for a team with no PIAA row', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.piaa).toBeNull();
  });

  it('GET /api/teams includes piaa block (or null) on every team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string; piaa: unknown }>;
    expect(body).toHaveLength(3);
    const byName = Object.fromEntries(body.map((t) => [t.name, t.piaa]));
    expect(byName['Haverford']).toMatchObject({ wins: 4, losses: 8 });
    expect(byName['Episcopal']).toMatchObject({ wins: 10, losses: 2 });
    expect(byName['Malvern Prep']).toBeNull();
  });
});
