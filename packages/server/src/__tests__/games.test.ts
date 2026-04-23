// Wave 14 Lane 3 (Leia) — game scrubber endpoint + synthesis tests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';
import { synthesizeScoringEvents } from '../queries/games.js';

const NOW = '2025-04-21T12:00:00Z';
const PARSER = '0.1.0';

let db: Database;
let app: FastifyInstance;

function seed(d: Database): void {
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')").run();

  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (10, '2025-04-21', 1, 2, 12, 8, 0, 0, 'p1', NULL, ?, 2025)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (11, '2024-05-01', 1, 2, 5, 6, 0, 0, 'p2', NULL, ?, 2024)`,
  ).run(NOW);

  // Periods: home 3+3+3+3=12, away 2+2+2+2=8.
  for (let p = 1; p <= 4; p += 1) {
    d.prepare('INSERT INTO game_periods (game_id, team_id, period_number, goals) VALUES (?, ?, ?, ?)').run(10, 1, p, 3);
    d.prepare('INSERT INTO game_periods (game_id, team_id, period_number, goals) VALUES (?, ?, ?, ?)').run(10, 2, p, 2);
  }

  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (100, 'Sam Smith', 'sam smith', 1, 'full')").run();
  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (101, 'Pat Jones', 'pat jones', 1, 'full')").run();
  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (200, 'Alex Doe', 'alex doe', 2, 'full')").run();

  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (10, 100, 7, 2, 0, 0, 0, 0, 0, 'summary', ?, 1.0)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (10, 101, 5, 3, 0, 0, 0, 0, 0, 'summary', ?, 1.0)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (10, 200, 8, 1, 0, 0, 0, 0, 0, 'summary', ?, 1.0)`,
  ).run(PARSER);
}

beforeAll(async () => {
  db = openDb(':memory:');
  seed(db);
  app = await buildApp(db, { logger: false, logosDir: process.cwd() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('synthesizeScoringEvents (pure)', () => {
  it('emits exactly one event per goal in game_periods, ordered by quarter', () => {
    const periods = [
      { id: 1, gameId: 10, teamId: 1, periodNumber: 1, goals: 3 },
      { id: 2, gameId: 10, teamId: 1, periodNumber: 2, goals: 3 },
      { id: 3, gameId: 10, teamId: 1, periodNumber: 3, goals: 3 },
      { id: 4, gameId: 10, teamId: 1, periodNumber: 4, goals: 3 },
      { id: 5, gameId: 10, teamId: 2, periodNumber: 1, goals: 2 },
      { id: 6, gameId: 10, teamId: 2, periodNumber: 2, goals: 2 },
      { id: 7, gameId: 10, teamId: 2, periodNumber: 3, goals: 2 },
      { id: 8, gameId: 10, teamId: 2, periodNumber: 4, goals: 2 },
    ];
    const players = [
      { id: 1, gameId: 10, playerId: 100, goals: 7, assists: 2, groundBalls: 0, causedTurnovers: 0, saves: 0, foWon: 0, foTaken: 0, source: 'summary' as const, parserVersion: PARSER, confidence: 1, playerName: 'Sam Smith', teamId: 1 },
      { id: 2, gameId: 10, playerId: 101, goals: 5, assists: 3, groundBalls: 0, causedTurnovers: 0, saves: 0, foWon: 0, foTaken: 0, source: 'summary' as const, parserVersion: PARSER, confidence: 1, playerName: 'Pat Jones', teamId: 1 },
      { id: 3, gameId: 10, playerId: 200, goals: 8, assists: 1, groundBalls: 0, causedTurnovers: 0, saves: 0, foWon: 0, foTaken: 0, source: 'summary' as const, parserVersion: PARSER, confidence: 1, playerName: 'Alex Doe', teamId: 2 },
    ];
    const events = synthesizeScoringEvents(periods, players, 1, 2);
    expect(events).toHaveLength(20);
    expect(events.every((e) => e.synthesized === true)).toBe(true);
    // Final running score == sum of period goals
    const last = events[events.length - 1]!;
    expect(last.homeScoreAfter).toBe(12);
    expect(last.awayScoreAfter).toBe(8);
    // Quarters monotonically non-decreasing
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.quarter).toBeGreaterThanOrEqual(events[i - 1]!.quarter);
    }
  });

  it('attributes goals to the highest-remaining scorer; null when team total > sum(player goals)', () => {
    const periods = [{ id: 1, gameId: 99, teamId: 1, periodNumber: 1, goals: 5 }];
    const players = [
      { id: 1, gameId: 99, playerId: 100, goals: 3, assists: 0, groundBalls: 0, causedTurnovers: 0, saves: 0, foWon: 0, foTaken: 0, source: 'summary' as const, parserVersion: PARSER, confidence: 1, playerName: 'Sam', teamId: 1 },
    ];
    const events = synthesizeScoringEvents(periods, players, 1, 2);
    expect(events).toHaveLength(5);
    const credited = events.filter((e) => e.playerId === 100);
    const orphan = events.filter((e) => e.playerId === null);
    expect(credited).toHaveLength(3);
    expect(orphan).toHaveLength(2);
  });
});

describe('GET /api/games/:id (with scoringEvents)', () => {
  it('returns scoringEvents whose count matches sum(game_periods.goals)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/10' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      game: { homeScore: number; awayScore: number };
      scoringEvents: Array<{ quarter: number; side: 'home' | 'away'; homeScoreAfter: number; awayScoreAfter: number }>;
      scoringEventsHeuristic: string;
    };
    expect(body.scoringEvents.length).toBe(body.game.homeScore + body.game.awayScore);
    expect(body.scoringEventsHeuristic).toMatch(/no per-goal timestamps/);
    const last = body.scoringEvents[body.scoringEvents.length - 1]!;
    expect(last.homeScoreAfter).toBe(body.game.homeScore);
    expect(last.awayScoreAfter).toBe(body.game.awayScore);
  });
});

describe('GET /api/games/:id periods field (Wave H5 Lane 2, Yoda)', () => {
  it('returns periods array with periodNumber + goals + teamId for a game that has periods', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/10' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      periods: Array<{ gameId: number; teamId: number; periodNumber: number; goals: number }>;
    };
    expect(Array.isArray(body.periods)).toBe(true);
    // Seed inserts 4 quarters x 2 teams = 8 rows for game 10.
    expect(body.periods).toHaveLength(8);
    for (const p of body.periods) {
      expect(p.gameId).toBe(10);
      expect([1, 2]).toContain(p.teamId);
      expect(p.periodNumber).toBeGreaterThanOrEqual(1);
      expect(p.periodNumber).toBeLessThanOrEqual(4);
      expect(typeof p.goals).toBe('number');
    }
    // Sanity: per-team totals match game score.
    const sumFor = (tid: number) =>
      body.periods.filter((p) => p.teamId === tid).reduce((acc, p) => acc + p.goals, 0);
    expect(sumFor(1)).toBe(12); // home
    expect(sumFor(2)).toBe(8); // away
  });

  it('returns periods: [] for a game with no period rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/11' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { periods: unknown[] };
    expect(Array.isArray(body.periods)).toBe(true);
    expect(body.periods).toHaveLength(0);
  });
});

describe('GET /api/games?team=&season= (W14 alias + season filter)', () => {
  it('filters by team alias + season year', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games?team=1&season=2025' });
    expect(res.statusCode).toBe(200);
    const games = JSON.parse(res.body) as Array<{ id: number; date: string }>;
    expect(games.map((g) => g.id)).toEqual([10]);
  });

  it('rejects malformed season', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games?team=1&season=banana' });
    expect(res.statusCode).toBe(400);
  });
});
