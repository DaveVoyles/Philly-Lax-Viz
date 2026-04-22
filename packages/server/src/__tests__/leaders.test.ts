// League leaders endpoint tests against a seeded :memory: DB.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2025-04-21T12:00:00Z';
const PARSER = '0.1.0';

function seed(d: Database): void {
  // Teams — Haverford has a logo (proves teamLogoUrl flows through), others don't.
  const teams: Array<[number, string, string, string | null]> = [
    [1, 'Haverford', 'haverford', 'haverford.gif'],
    [2, 'Episcopal', 'episcopal', null],
    [3, 'Malvern Prep', 'malvern-prep', null],
    [4, 'Ridley', 'ridley', null],
    [5, 'Penn Charter', 'penn-charter', null],
  ];
  for (const [id, name, slug, logoUrl] of teams) {
    d.prepare(
      'INSERT INTO teams (id, name, slug, division, logo_url) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, slug, 'high-school', logoUrl);
  }

  // Games — designed so wins/losses/goal differential are interesting.
  // (id, date, home, away, hScore, aScore)
  // Team 1 (Haverford):  W vs 2 (12-8), W @ 3 (11-9), W vs 4 (15-5)  -> 3-0-0, GF=38 GA=22, +16
  // Team 2 (Episcopal):  L @ 1 (8-12), W vs 5 (10-6), L @ 4 (4-9)    -> 1-2-0, GF=22 GA=25, -3
  // Team 3 (Malvern):    L vs 1 (9-11), L @ 5 (3-7)                  -> 0-2-0, GF=12 GA=18, -6
  // Team 4 (Ridley):     L @ 1 (5-15), W vs 2 (9-4)                  -> 1-1-0, GF=14 GA=19, -5
  // Team 5 (Penn C):     L @ 2 (6-10), W vs 3 (7-3)                  -> 1-1-0, GF=13 GA=15, -2
  const games: Array<[number, string, number, number, number, number]> = [
    [10, '2025-04-21', 1, 2, 12, 8],
    [11, '2025-04-19', 3, 1, 9, 11],
    [12, '2025-04-17', 1, 4, 15, 5],
    [13, '2025-04-15', 2, 5, 10, 6],
    [14, '2025-04-13', 4, 2, 9, 4],
    [15, '2025-04-11', 5, 3, 7, 3],
  ];
  for (const [id, date, h, a, hs, as_] of games) {
    d.prepare(
      `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
    ).run(id, date, h, a, hs, as_, `post-${id}`, NOW);
  }

  // Players
  const players: Array<[number, string, number]> = [
    [100, 'Sam Smith',     1], // Haverford — leader in points
    [101, 'Alex Doe',      2], // Episcopal
    [102, 'Chris Lee',     1], // Haverford — assists machine
    [103, 'Jordan Park',   3], // Malvern — FO specialist (high attempts)
    [104, 'Taylor Quinn',  4], // Ridley — FO specialist (low attempts, should be filtered for fo_pct)
    [105, 'Morgan Reed',   5], // Penn Charter — single game (filtered by minGames)
  ];
  for (const [id, name, teamId] of players) {
    d.prepare(
      'INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, name.toLowerCase(), teamId, 'full');
  }

  // player_stats
  // (game_id, player_id, g, a, gb, ct, sv, fow, fot)
  const stats: Array<[number, number, number, number, number, number, number, number, number]> = [
    // Sam Smith (100) — Haverford, 3 games: 4+2, 2+3, 5+1 = G=11 A=6 P=17
    [10, 100, 4, 2, 5, 1, 0, 0, 0],
    [11, 100, 2, 3, 6, 0, 0, 0, 0],
    [12, 100, 5, 1, 4, 1, 0, 0, 0],
    // Chris Lee (102) — Haverford, 3 games: 1+5, 2+4, 1+6 = G=4 A=15 P=19
    [10, 102, 1, 5, 2, 0, 0, 0, 0],
    [11, 102, 2, 4, 1, 0, 0, 0, 0],
    [12, 102, 1, 6, 3, 0, 0, 0, 0],
    // Alex Doe (101) — Episcopal, 3 games: 3+1, 4+2, 1+0 = G=8 A=3 P=11
    [10, 101, 3, 1, 4, 2, 0, 0, 0],
    [13, 101, 4, 2, 3, 1, 0, 0, 0],
    [14, 101, 1, 0, 2, 0, 0, 0, 0],
    // Jordan Park (103) — Malvern FO specialist: 2 games, fow/fot = 8/12 + 7/10 = 15/22 ≈ 0.6818
    [11, 103, 1, 0, 8, 0, 0, 8, 12],
    [15, 103, 0, 1, 6, 0, 0, 7, 10],
    // Taylor Quinn (104) — Ridley FO with too-few attempts: 2 games, 4/5 + 3/4 = 7/9 ≈ 0.778
    [12, 104, 0, 0, 1, 0, 0, 4, 5],
    [14, 104, 1, 0, 2, 0, 0, 3, 4],
    // Morgan Reed (105) — single game player, useful for minGames test
    [15, 105, 3, 2, 4, 1, 0, 0, 0],
  ];
  for (const row of stats) {
    d.prepare(
      `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'summary', ?, 1.0)`,
    ).run(...row, PARSER);
  }
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

describe('GET /api/leaders/players', () => {
  it('metric=points returns rows ordered by points desc with full shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=points' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric).toBe('points');
    expect(body.rows.length).toBeGreaterThan(0);
    // Chris Lee = 19, Sam Smith = 17, Alex Doe = 11, Morgan Reed = 5, Jordan Park = 2, Taylor Quinn = 1
    expect(body.rows[0]).toMatchObject({
      rank: 1,
      playerId: 102,
      playerName: 'Chris Lee',
      teamId: 1,
      teamName: 'Haverford',
      gamesPlayed: 3,
      goals: 4,
      assists: 15,
      points: 19,
      value: 19,
    });
    expect(body.rows[1]).toMatchObject({ playerId: 100, points: 17, value: 17 });
    expect(body.rows[2]).toMatchObject({ playerId: 101, points: 11 });
    // descending invariant
    const points = body.rows.map((r: { points: number }) => r.points);
    expect([...points]).toEqual([...points].sort((a, b) => b - a));
  });

  it('metric=goals re-orders by goals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=goals' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric).toBe('goals');
    // Sam Smith=11g, Alex Doe=8g, Chris Lee=4g
    expect(body.rows[0]).toMatchObject({ playerId: 100, goals: 11, value: 11 });
    expect(body.rows[1]).toMatchObject({ playerId: 101, goals: 8 });
    expect(body.rows[2]).toMatchObject({ playerId: 102, goals: 4 });
  });

  it('metric=fo_pct excludes players below minAttempts (default 20) and computes %', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=fo_pct' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric).toBe('fo_pct');
    // Only Jordan Park qualifies (22 attempts >= 20). Taylor Quinn has 9.
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      playerId: 103,
      foWon: 15,
      foTaken: 22,
    });
    // 15/22 = 0.6818..., rounded to 0.68
    expect(body.rows[0].foPct).toBeCloseTo(0.68, 2);
    expect(body.rows[0].value).toBeCloseTo(0.68, 2);
  });

  it('metric=fo_pct honors explicit ?minAttempts override (lower threshold)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=fo_pct&minAttempts=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Both Jordan Park (22) and Taylor Quinn (9) now qualify.
    const ids = body.rows.map((r: { playerId: number }) => r.playerId);
    expect(ids).toContain(103);
    expect(ids).toContain(104);
  });

  it('metric=saves applies default minGames>=3 (filters single-game players)', async () => {
    // Seed has no saves data, but we can still verify the gate applies:
    // Morgan Reed (1 game) must not appear under metric=saves with default thresholds.
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=saves' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.minGames).toBe(3);
    const ids = body.rows.map((r: { playerId: number }) => r.playerId);
    expect(ids).not.toContain(105);
  });

  it('metric=ground_balls applies default minGames>=3 and orders by GBs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=ground_balls',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric).toBe('ground_balls');
    expect(body.minGames).toBe(3);
    // Sam Smith (100): 5+6+4=15 GBs across 3 games. Chris Lee (102): 2+1+3=6.
    // Alex Doe (101): 4+3+2=9. All 3 have 3 games, so all qualify.
    expect(body.rows[0]).toMatchObject({ playerId: 100, groundBalls: 15, value: 15 });
    const gbs = body.rows.map((r: { groundBalls: number }) => r.groundBalls);
    expect([...gbs]).toEqual([...gbs].sort((a, b) => b - a));
    // Single-game Morgan Reed (105) excluded.
    const ids = body.rows.map((r: { playerId: number }) => r.playerId);
    expect(ids).not.toContain(105);
  });

  it('minGames filters players with fewer games', async () => {
    // Morgan Reed has 1 game; with minGames=2 they should be excluded.
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=points&minGames=2',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.minGames).toBe(2);
    const ids = body.rows.map((r: { playerId: number }) => r.playerId);
    expect(ids).not.toContain(105);
    // Sanity: with default (1), Morgan should appear.
    const all = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=points' });
    const allIds = all.json().rows.map((r: { playerId: number }) => r.playerId);
    expect(allIds).toContain(105);
  });

  it('rejects invalid metric with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=foo_invalid',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('teamLogoUrl is populated as /logos/<file> when team has a logo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=points' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Chris Lee (Haverford, teamId 1) should be #1 in points and Haverford has a logo.
    const haverfordRow = body.rows.find((r: { teamId: number }) => r.teamId === 1);
    expect(haverfordRow).toBeDefined();
    expect(haverfordRow.teamLogoUrl).toBe('/logos/haverford.gif');
    expect(haverfordRow.teamLogoUrl.startsWith('/logos/')).toBe(true);
  });

  it('teamLogoUrl is null when team has no logo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=points' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Alex Doe (Episcopal, teamId 2) — Episcopal has no logo in seed.
    const episcopalRow = body.rows.find((r: { teamId: number }) => r.teamId === 2);
    expect(episcopalRow).toBeDefined();
    expect(episcopalRow.teamLogoUrl).toBeNull();
  });
});

describe('GET /api/leaders/teams', () => {
  it('metric=wins returns wins descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/teams?metric=wins' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric).toBe('wins');
    // Haverford 3 wins is top
    expect(body.rows[0]).toMatchObject({
      rank: 1,
      teamId: 1,
      teamName: 'Haverford',
      wins: 3,
      losses: 0,
      value: 3,
    });
    const wins = body.rows.map((r: { wins: number }) => r.wins);
    expect([...wins]).toEqual([...wins].sort((a, b) => b - a));
  });

  it('metric=goal_diff returns rows including positive and negative differentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/teams?metric=goal_diff' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metric).toBe('goal_diff');
    // Haverford +16 should lead; some teams should be negative.
    expect(body.rows[0]).toMatchObject({ teamId: 1, goalDiff: 16, value: 16 });
    const diffs = body.rows.map((r: { goalDiff: number }) => r.goalDiff);
    expect(diffs.some((d: number) => d > 0)).toBe(true);
    expect(diffs.some((d: number) => d < 0)).toBe(true);
    expect([...diffs]).toEqual([...diffs].sort((a, b) => b - a));
  });

  it('limit=N caps row count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/teams?metric=wins&limit=2',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(2);
  });

  it('every row includes goalsFor/goalsAgainst/goalDiff/winPct/gpg/gapg', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/teams?metric=wins' });
    const body = res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      expect(r).toHaveProperty('goalsFor');
      expect(r).toHaveProperty('goalsAgainst');
      expect(r).toHaveProperty('goalDiff');
      expect(r).toHaveProperty('winPct');
      expect(r).toHaveProperty('gpg');
      expect(r).toHaveProperty('gapg');
      expect(r.goalDiff).toBe(r.goalsFor - r.goalsAgainst);
    }
  });

  it('rejects invalid metric with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/teams?metric=invalid' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });
});
