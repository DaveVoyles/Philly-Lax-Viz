// Wave 11 Lane 2 (R2) — PIAA validation badge.
// Parametric tests for `classifyPiaaValidation` + integration check that
// `team.piaaValidation` and `team.derivedRecord` flow through both
// /api/teams and /api/teams/:id.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';
import { classifyPiaaValidation, PIAA_SOURCE_URL } from '../queries/mappers.js';

describe('classifyPiaaValidation', () => {
  it('unmapped when no PIAA W or L is provided', () => {
    const v = classifyPiaaValidation(10, 2, null, null);
    expect(v.status).toBe('unmapped');
    expect(v.winDiff).toBeNull();
    expect(v.lossDiff).toBeNull();
    expect(v.totalDiff).toBeNull();
    expect(v.sourceUrl).toBe(PIAA_SOURCE_URL);
  });

  it.each([
    { dW: 12, dL: 3, pW: 12, pL: 3, status: 'match', total: 0 },
    { dW: 0, dL: 0, pW: 0, pL: 0, status: 'match', total: 0 },
    { dW: 11, dL: 4, pW: 12, pL: 3, status: 'close', total: 2 },
    { dW: 10, dL: 5, pW: 11, pL: 4, status: 'close', total: 2 },
    { dW: 12, dL: 3, pW: 13, pL: 3, status: 'close', total: 1 },
    { dW: 8, dL: 2, pW: 12, pL: 2, status: 'divergent', total: 4 },
    { dW: 5, dL: 5, pW: 10, pL: 1, status: 'divergent', total: 9 },
    { dW: 12, dL: 0, pW: 9, pL: 0, status: 'divergent', total: 3 },
  ])(
    'derived $dW-$dL vs PIAA $pW-$pL → $status (totalDiff=$total)',
    ({ dW, dL, pW, pL, status, total }) => {
      const v = classifyPiaaValidation(dW, dL, pW, pL);
      expect(v.status).toBe(status);
      expect(v.totalDiff).toBe(total);
      expect(v.winDiff).toBe(pW - dW);
      expect(v.lossDiff).toBe(pL - dL);
      expect(v.sourceUrl).toBe(PIAA_SOURCE_URL);
    },
  );
});

let db: Database;
let app: FastifyInstance;
const NOW = '2026-04-22T12:00:00Z';

function seed(d: Database): void {
  // Three teams: A matches PIAA exactly, B is off by 2 (close), C is off by 4 (divergent).
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Alpha', 'alpha', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Beta', 'beta', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (3, 'Gamma', 'gamma', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (4, 'Delta', 'delta', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (99, 'Opp', 'opp', 'high-school')").run();
  // Give Delta a player so the listTeams ghost-team filter doesn't drop it.
  d.prepare(
    "INSERT INTO players (team_id, name, name_normalized) VALUES (4, 'Test Player', 'test player')",
  ).run();

  const ins = d.prepare(
    `INSERT INTO games (date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
  );
  // Alpha: 2W, 1L
  ins.run('2026-04-01', 1, 99, 10, 5, 'a1', NOW);
  ins.run('2026-04-02', 99, 1, 6, 9, 'a2', NOW);
  ins.run('2026-04-03', 1, 99, 4, 7, 'a3', NOW);
  // Beta: 1W, 1L
  ins.run('2026-04-01', 2, 99, 10, 5, 'b1', NOW);
  ins.run('2026-04-02', 99, 2, 8, 4, 'b2', NOW);
  // Gamma: 1W, 0L (one postponed should NOT count)
  ins.run('2026-04-01', 3, 99, 10, 5, 'c1', NOW);
  d.prepare(
    `INSERT INTO games (date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
  ).run('2026-04-02', 3, 99, 0, 0, 'c2', NOW);

  // PIAA snapshots:
  //   Alpha = 2-1 (match)
  //   Beta  = 2-2 (close, totalDiff=2)
  //   Gamma = 5-0 (divergent, totalDiff=4)
  //   Delta = no PIAA row -> unmapped
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Alpha HS', 'alpha', '3A', 1, 2, 1, 0, 5.0, 1.0, NOW);
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Beta HS', 'beta', '3A', 2, 2, 2, 0, 4.0, 0.8, NOW);
  d.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('Gamma HS', 'gamma', '2A', 3, 5, 0, 0, 9.0, 0.9, NOW);
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

describe('PIAA validation badge on team endpoints', () => {
  it('GET /api/teams returns derivedRecord and piaaValidation for every team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: number;
      name: string;
      derivedRecord: { wins: number; losses: number; ties: number };
      piaaWins: number | null;
      piaaLosses: number | null;
      piaaMatch: 'match' | 'mismatch' | 'unknown';
      piaaValidation: { status: string; winDiff: number | null; lossDiff: number | null; totalDiff: number | null; sourceUrl: string };
    }>;
    const byName = Object.fromEntries(body.map((t) => [t.name, t]));

    expect(byName['Alpha']?.derivedRecord).toEqual({ wins: 2, losses: 1, ties: 0 });
    expect(byName['Alpha']?.piaaWins).toBe(2);
    expect(byName['Alpha']?.piaaLosses).toBe(1);
    expect(byName['Alpha']?.piaaMatch).toBe('match');
    expect(byName['Alpha']?.piaaValidation.status).toBe('match');
    expect(byName['Alpha']?.piaaValidation.totalDiff).toBe(0);

    expect(byName['Beta']?.derivedRecord).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(byName['Beta']?.piaaWins).toBe(2);
    expect(byName['Beta']?.piaaLosses).toBe(2);
    expect(byName['Beta']?.piaaMatch).toBe('mismatch');
    expect(byName['Beta']?.piaaValidation.status).toBe('close');
    expect(byName['Beta']?.piaaValidation.totalDiff).toBe(2);

    expect(byName['Gamma']?.derivedRecord).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(byName['Gamma']?.piaaWins).toBe(5);
    expect(byName['Gamma']?.piaaLosses).toBe(0);
    expect(byName['Gamma']?.piaaMatch).toBe('mismatch');
    expect(byName['Gamma']?.piaaValidation.status).toBe('divergent');
    expect(byName['Gamma']?.piaaValidation.totalDiff).toBe(4);

    expect(byName['Delta']?.derivedRecord).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(byName['Delta']?.piaaWins).toBeNull();
    expect(byName['Delta']?.piaaLosses).toBeNull();
    expect(byName['Delta']?.piaaMatch).toBe('unknown');
    expect(byName['Delta']?.piaaValidation.status).toBe('unmapped');
    expect(byName['Delta']?.piaaValidation.totalDiff).toBeNull();
    expect(byName['Delta']?.piaaValidation.sourceUrl).toContain('piaad1.org');
  });

  it('GET /api/teams/:id returns derivedRecord and piaaValidation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.derivedRecord).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(body.team.piaaWins).toBe(2);
    expect(body.team.piaaLosses).toBe(2);
    expect(body.team.piaaMatch).toBe('mismatch');
    expect(body.team.piaaValidation).toMatchObject({
      status: 'close',
      winDiff: 1,
      lossDiff: 1,
      totalDiff: 2,
    });
  });
});
