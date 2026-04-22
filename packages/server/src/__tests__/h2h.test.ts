// H2H route tests against a seeded :memory: DB.
// Reuses a similar shape to leaders.test.ts but with extra games / players
// to give common-opponents and direct-meetings something to find.

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

  // Game design:
  //   1 vs 2 twice (direct meetings) — Haverford wins both.
  //   1 vs 3 (Haverford W) — gives 1+2 a common opponent (3) since 2 also plays 3.
  //   2 vs 3, 2 vs 4 — Episcopal common opps: 3,4
  //   1 vs 4 — Haverford common opps with Ep: 3,4
  //   3 vs 5 unrelated.
  const games: Array<[number, string, number, number, number, number]> = [
    [10, '2025-04-21', 1, 2, 12, 8],   // direct A vs B
    [11, '2025-04-15', 2, 1, 9, 11],   // direct B vs A (Haverford wins again)
    [12, '2025-04-19', 1, 3, 11, 9],   // common opp 3
    [13, '2025-04-17', 2, 3, 8, 7],    // common opp 3
    [14, '2025-04-13', 1, 4, 15, 5],   // common opp 4
    [15, '2025-04-11', 4, 2, 9, 4],    // common opp 4
    [16, '2025-04-09', 3, 5, 7, 3],
  ];
  for (const [id, date, h, a, hs, as_] of games) {
    d.prepare(
      `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
    ).run(id, date, h, a, hs, as_, `post-${id}`, NOW);
  }

  // Players: two on Haverford for player h2h.
  const players: Array<[number, string, number]> = [
    [100, 'Sam Smith',  1], // Haverford
    [101, 'Alex Doe',   2], // Episcopal
    [102, 'Chris Lee',  1], // Haverford
  ];
  for (const [id, name, teamId] of players) {
    d.prepare(
      'INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, name.toLowerCase(), teamId, 'full');
  }

  // player_stats — Sam: lots of goals; Chris: lots of assists.
  const stats: Array<[number, number, number, number, number, number, number, number, number]> = [
    // Sam (100) — 3 games: G=11 A=4
    [10, 100, 4, 1, 5, 1, 0, 0, 0],
    [12, 100, 5, 2, 4, 1, 0, 0, 0],
    [14, 100, 2, 1, 3, 0, 0, 0, 0],
    // Chris (102) — 3 games: G=4 A=12
    [10, 102, 1, 5, 2, 0, 0, 0, 0],
    [12, 102, 1, 4, 1, 0, 0, 0, 0],
    [14, 102, 2, 3, 3, 0, 0, 0, 0],
    // Alex (101) — Episcopal, 2 games
    [10, 101, 3, 1, 4, 2, 0, 0, 0],
    [13, 101, 4, 2, 3, 1, 0, 0, 0],
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

describe('GET /api/h2h/teams', () => {
  it('returns both team summaries plus direct meetings and common opponents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/h2h/teams?a=1&b=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a.teamId).toBe(1);
    expect(body.b.teamId).toBe(2);
    // Haverford 4-0 (games 10,11,12,14), Episcopal 1-3 (games 10,11,13,15).
    expect(body.a.wins).toBe(4);
    expect(body.a.losses).toBe(0);
    expect(body.b.wins).toBe(1);
    expect(body.b.losses).toBe(3);
    // Two direct meetings, both Haverford wins.
    expect(body.directMeetings).toHaveLength(2);
    expect(body.directMeetings.every((m: { aResult: string }) => m.aResult === 'W')).toBe(true);
    // Common opponents: Malvern (3) and Ridley (4).
    const oppIds = body.commonOpponents.map((o: { opponentId: number }) => o.opponentId).sort();
    expect(oppIds).toEqual([3, 4]);
  });

  it('returns empty meetings/opponents and null sides when team ids are unknown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/h2h/teams?a=1&b=999' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a.teamId).toBe(1);
    expect(body.b).toBeNull();
    expect(body.commonOpponents).toEqual([]);
    expect(body.directMeetings).toEqual([]);
  });

  it('rejects missing or invalid query params with 400', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/h2h/teams?a=1' });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({ method: 'GET', url: '/api/h2h/teams?a=foo&b=2' });
    expect(r2.statusCode).toBe(400);
  });
});

describe('GET /api/h2h/players', () => {
  it('returns season totals, per-game averages, and category leads for both players', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/h2h/players?a=100&b=102' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a.playerId).toBe(100);
    expect(body.b.playerId).toBe(102);
    expect(body.a.goals).toBe(11);
    expect(body.b.assists).toBe(12);
    expect(body.a.points).toBe(15);
    expect(body.b.points).toBe(16);
    expect(body.a.goalsPerGame).toBeCloseTo(11 / 3, 2);
    expect(body.b.assistsPerGame).toBeCloseTo(12 / 3, 2);

    // Sam (a) leads in goals and goals/game; Chris (b) leads in assists, assists/game, points.
    const aLeadKeys = body.aLeads.map((l: { key: string }) => l.key);
    const bLeadKeys = body.bLeads.map((l: { key: string }) => l.key);
    expect(aLeadKeys).toContain('goals');
    expect(aLeadKeys).toContain('goalsPerGame');
    expect(bLeadKeys).toContain('assists');
    expect(bLeadKeys).toContain('points');
    // At most 3 each.
    expect(body.aLeads.length).toBeLessThanOrEqual(3);
    expect(body.bLeads.length).toBeLessThanOrEqual(3);
  });

  it('handles unknown player ids gracefully (no 500)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/h2h/players?a=100&b=9999' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.a.playerId).toBe(100);
    expect(body.b).toBeNull();
    expect(body.aLeads).toEqual([]);
    expect(body.bLeads).toEqual([]);
  });

  it('rejects missing query params with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/h2h/players' });
    expect(res.statusCode).toBe(400);
  });
});
