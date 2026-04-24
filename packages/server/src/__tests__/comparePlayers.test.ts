// Wave H8 Lane 1 (Han) — tests for /api/compare/players.
// Mirrors the seed style used in h2h.test.ts.

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
  d.prepare(
    'INSERT INTO teams (id, name, slug, division, logo_url) VALUES (?, ?, ?, ?, ?)',
  ).run(1, 'Haverford', 'haverford', 'high-school', null);
  d.prepare(
    'INSERT INTO teams (id, name, slug, division, logo_url) VALUES (?, ?, ?, ?, ?)',
  ).run(2, 'Episcopal', 'episcopal', 'high-school', null);

  const games: Array<[number, string, number, number, number, number]> = [
    [10, '2025-04-21', 1, 2, 12, 8],
    [11, '2025-04-15', 2, 1, 9, 11],
  ];
  for (const [id, date, h, a, hs, as_] of games) {
    d.prepare(
      `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?)`,
    ).run(id, date, h, a, hs, as_, `post-${id}`, NOW);
  }

  const players: Array<[number, string, number]> = [
    [100, 'Sam Smith', 1],
    [101, 'Alex Doe', 2],
    [102, 'Chris Lee', 1],
  ];
  for (const [id, name, teamId] of players) {
    d.prepare(
      'INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, name.toLowerCase(), teamId, 'full');
  }

  const stats: Array<[number, number, number, number, number, number, number, number, number]> = [
    [10, 100, 4, 1, 5, 1, 0, 0, 0],
    [11, 100, 5, 2, 4, 1, 0, 0, 0],
    [10, 101, 3, 1, 4, 2, 0, 0, 0],
    [11, 102, 1, 5, 2, 0, 0, 0, 0],
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

describe('GET /api/compare/players', () => {
  it('returns full player details for two ids in request order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players?ids=100,101' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { players: Array<{ player: { id: number }; seasonStats: { goals: number } }> };
    expect(body.players).toHaveLength(2);
    expect(body.players[0]?.player.id).toBe(100);
    expect(body.players[1]?.player.id).toBe(101);
    expect(body.players[0]?.seasonStats.goals).toBe(9);
  });

  it('preserves request order even when reversed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players?ids=101,100' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { players: Array<{ player: { id: number } }> };
    expect(body.players.map((p) => p.player.id)).toEqual([101, 100]);
  });

  it('omits missing ids from the response (documented choice — no 404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players?ids=100,99999' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { players: Array<{ player: { id: number } }> };
    expect(body.players).toHaveLength(1);
    expect(body.players[0]?.player.id).toBe(100);
  });

  it('rejects fewer than 2 ids with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players?ids=100' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects more than 4 ids (cap) with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players?ids=1,2,3,4,5' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects bad-id format with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players?ids=100,abc' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing ids param with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/compare/players' });
    expect(res.statusCode).toBe(400);
  });
});
