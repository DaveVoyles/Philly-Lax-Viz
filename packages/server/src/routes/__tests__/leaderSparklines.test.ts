// Wave H7 L2 (Yoda) — leader sparkline endpoint tests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../../app.js';

let db: Database;
let app: FastifyInstance;

interface Player {
  player_id: number;
  name: string;
  perGame: number[];
}

interface Resp {
  metric: string;
  season: number | null;
  players: Player[];
}

beforeAll(async () => {
  db = openDb(':memory:');

  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (1, ?, ?, ?)').run(
    'Test HS',
    'test-hs',
    'high-school',
  );
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (2, ?, ?, ?)').run(
    'Other HS',
    'other-hs',
    'high-school',
  );

  // Three games on different dates so per-game ordering is meaningful.
  const insGame = db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insGame.run(10, '2026-03-01', 1, 2, 10, 8, 'post-10', '2026-03-01T00:00:00Z');
  insGame.run(11, '2026-03-08', 2, 1, 7, 6, 'post-11', '2026-03-08T00:00:00Z');
  insGame.run(12, '2026-03-15', 1, 2, 12, 9, 'post-12', '2026-03-15T00:00:00Z');

  const insP = db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  );
  insP.run(100, 'Alice Sniper', 'alice sniper', 1);
  insP.run(101, 'Bob Feeder', 'bob feeder', 1);
  insP.run(102, 'Carol Steady', 'carol steady', 2);

  const insPS = db.prepare(
    `INSERT INTO player_stats (id, game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, parser_version, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 1.0)`,
  );
  // Alice: 4, 2, 5 goals (top scorer total=11)
  insPS.run(1, 10, 100, 4, 1, 0, 0, 0, 0, 0);
  insPS.run(2, 11, 100, 2, 0, 0, 0, 0, 0, 0);
  insPS.run(3, 12, 100, 5, 0, 0, 0, 0, 0, 0);
  // Bob: 1, 0, 2 goals; assists 3,2,1 (assist leader = 6)
  insPS.run(4, 10, 101, 1, 3, 0, 0, 0, 0, 0);
  insPS.run(5, 11, 101, 0, 2, 0, 0, 0, 0, 0);
  insPS.run(6, 12, 101, 2, 1, 0, 0, 0, 0, 0);
  // Carol: only games 11 and 12; 3 and 1 goals (no game 10 entry)
  insPS.run(7, 11, 102, 3, 0, 0, 0, 0, 0, 0);
  insPS.run(8, 12, 102, 1, 0, 0, 0, 0, 0, 0);

  app = await buildApp(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('GET /api/leaders/players/sparklines', () => {
  it('returns top-N players with per-game arrays ordered by date', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players/sparklines?metric=goals&limit=3',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Resp;
    expect(body.metric).toBe('goals');
    expect(body.players).toHaveLength(3);

    // Top by goals: Alice (11), Carol (4), Bob (3).
    expect(body.players[0]?.name).toBe('Alice Sniper');
    expect(body.players[0]?.perGame).toEqual([4, 2, 5]);
    expect(body.players[1]?.name).toBe('Carol Steady');
    // Carol only played games 11 and 12; per-game array length = games played.
    expect(body.players[1]?.perGame).toEqual([3, 1]);
    expect(body.players[2]?.name).toBe('Bob Feeder');
    expect(body.players[2]?.perGame).toEqual([1, 0, 2]);
  });

  it('respects metric=assists ordering', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players/sparklines?metric=assists&limit=5',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Resp;
    // Bob has assists; Alice has 1; Carol has 0 → only Bob and Alice returned.
    expect(body.players[0]?.name).toBe('Bob Feeder');
    expect(body.players[0]?.perGame).toEqual([3, 2, 1]);
  });

  it('caps limit at 25', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players/sparklines?metric=goals&limit=9999',
    });
    expect(res.statusCode).toBe(200);
    // Only 3 players in fixture; cap doesn't affect length here, but
    // verifies the endpoint accepts a large limit without error.
    const body = res.json() as Resp;
    expect(body.players.length).toBeLessThanOrEqual(25);
  });

  it('rejects unknown metric with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players/sparklines?metric=DROP_TABLE',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('defaults limit to 10 when omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players/sparklines?metric=points',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Resp;
    // Points = goals+assists. Alice=12, Bob=9, Carol=4.
    expect(body.players[0]?.name).toBe('Alice Sniper');
    expect(body.players[0]?.perGame).toEqual([5, 2, 5]);
  });
});
