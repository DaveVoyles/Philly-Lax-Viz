// /api/players/constellation tests (W15 L2, R2).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';
import { getConstellation } from '../queries/constellation.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2026-04-22T12:00:00Z';
const PARSER = '0.1.0';

function seed(d: Database): void {
  d.prepare('INSERT INTO teams (id, name, slug, division) VALUES (1, ?, ?, ?)')
    .run('Alpha', 'alpha', 'high-school');
  d.prepare('INSERT INTO teams (id, name, slug, division) VALUES (2, ?, ?, ?)')
    .run('Bravo', 'bravo', 'high-school');

  // Two seasons of games: 2025 and 2026.
  const insertGame = d.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?)`,
  );
  insertGame.run(1, '2025-04-10', 1, 2, 7, 4, 'p25-1', NOW, 2025);
  insertGame.run(2, '2025-04-17', 2, 1, 9, 8, 'p25-2', NOW, 2025);
  insertGame.run(3, '2026-04-10', 1, 2, 11, 5, 'p26-1', NOW, 2026);
  insertGame.run(4, '2026-04-17', 2, 1, 6, 10, 'p26-2', NOW, 2026);

  // Players: 1 = Alpha goal-scorer, 2 = Alpha set-up man, 3 = Bravo do-it-all,
  // 4 = Alpha rookie (only plays 2026 — must be filtered out of 2025).
  const insertPlayer = d.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  );
  insertPlayer.run(1, 'Alpha Striker', 'alpha striker', 1);
  insertPlayer.run(2, 'Alpha Feeder', 'alpha feeder', 1);
  insertPlayer.run(3, 'Bravo All-Star', 'bravo all-star', 2);
  insertPlayer.run(4, 'Rookie', 'rookie', 1);

  const ps = d.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 'summary', ?, 1.0, ?)`,
  );
  // 2025: Striker 5g/1a in g1, 4g/2a in g2 → 9g/3a (12p, 2 games)
  ps.run(1, 1, 5, 1, PARSER, 2025);
  ps.run(2, 1, 4, 2, PARSER, 2025);
  // 2025: Feeder 1g/4a in g1, 0g/3a in g2 → 1g/7a (8p, 2 games)
  ps.run(1, 2, 1, 4, PARSER, 2025);
  ps.run(2, 2, 0, 3, PARSER, 2025);
  // 2025: Bravo 3g/2a g1, 6g/1a g2 → 9g/3a (12p, 2 games)
  ps.run(1, 3, 3, 2, PARSER, 2025);
  ps.run(2, 3, 6, 1, PARSER, 2025);

  // 2026: Striker 6g/2a in g3, 7g/1a in g4 → 13g/3a (16p, 2 games)
  ps.run(3, 1, 6, 2, PARSER, 2026);
  ps.run(4, 1, 7, 1, PARSER, 2026);
  // 2026: Rookie 1g/0a in g3 only (1 game; included in 2026, not 2025)
  ps.run(3, 4, 1, 0, PARSER, 2026);
  // 2026: Bravo 2g/1a g3, 3g/2a g4 → 5g/3a (8p, 2 games)
  ps.run(3, 3, 2, 1, PARSER, 2026);
  ps.run(4, 3, 3, 2, PARSER, 2026);
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

describe('getConstellation query', () => {
  it('returns one row per player with derived points + per-game rates', () => {
    const all = getConstellation(db, {}); // no season → aggregate across years
    const striker = all.find((p) => p.id === 1);
    expect(striker).toBeDefined();
    // 9g+13g=22g, 3a+3a=6a → 28p over 4 games
    expect(striker!.goals).toBe(22);
    expect(striker!.assists).toBe(6);
    expect(striker!.points).toBe(28);
    expect(striker!.gamesPlayed).toBe(4);
    expect(striker!.goalsPerGame).toBeCloseTo(5.5, 3);
    expect(striker!.assistsPerGame).toBeCloseTo(1.5, 3);
    expect(striker!.teamName).toBe('Alpha');
    expect(striker!.teamId).toBe(1);
    // Sorted by points desc → striker (28) before Bravo (20) before Feeder (8)
    expect(all[0]!.id).toBe(1);
  });
});

describe('GET /api/players/constellation', () => {
  it('defaults to the newest season and returns the expected shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players/constellation',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBe(2026);
    expect(Array.isArray(body.players)).toBe(true);

    // 2026: Striker (id 1), Bravo (id 3), Rookie (id 4). Feeder (id 2)
    // had no 2026 stats so must NOT appear.
    const ids = body.players.map((p: { id: number }) => p.id).sort();
    expect(ids).toEqual([1, 3, 4]);

    const striker = body.players.find((p: { id: number }) => p.id === 1);
    expect(striker).toMatchObject({
      name: 'Alpha Striker',
      teamId: 1,
      teamName: 'Alpha',
      teamColor: null,
      gamesPlayed: 2,
      goals: 13,
      assists: 3,
      points: 16,
    });
    expect(striker.goalsPerGame).toBeCloseTo(6.5, 3);
    expect(striker.assistsPerGame).toBeCloseTo(1.5, 3);
  });

  it('filters to ?season=2025 and excludes players with no 2025 games', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players/constellation?season=2025',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBe(2025);
    const ids = body.players.map((p: { id: number }) => p.id).sort();
    // Rookie (4) only played 2026 — must be absent. Feeder (2) returns.
    expect(ids).toEqual([1, 2, 3]);
    const feeder = body.players.find((p: { id: number }) => p.id === 2);
    expect(feeder).toMatchObject({ goals: 1, assists: 7, points: 8, gamesPlayed: 2 });
  });

  it('rejects invalid season values with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players/constellation?season=banana',
    });
    expect(res.statusCode).toBe(400);
  });
});
