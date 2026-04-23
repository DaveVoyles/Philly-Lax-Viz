// Endpoint smoke tests against a seeded :memory: DB.

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
  // teams
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal', 'episcopal', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (3, 'Malvern Prep', 'malvern-prep', 'high-school')").run();

  // games
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (10, '2025-04-21', 1, 2, 12, 8, 0, 0, 'post-1', 'https://example.com/recap/10', ?)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (11, '2025-04-19', 3, 1, 9, 11, 0, 0, 'post-2', NULL, ?)`,
  ).run(NOW);

  // periods for game 10
  for (let p = 1; p <= 4; p += 1) {
    d.prepare(
      'INSERT INTO game_periods (game_id, team_id, period_number, goals) VALUES (?, ?, ?, ?)',
    ).run(10, 1, p, 3);
    d.prepare(
      'INSERT INTO game_periods (game_id, team_id, period_number, goals) VALUES (?, ?, ?, ?)',
    ).run(10, 2, p, 2);
  }

  // players
  d.prepare(
    "INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (100, 'Sam Smith', 'sam smith', 1, 'full')",
  ).run();
  d.prepare(
    "INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (101, 'Alex Doe', 'alex doe', 2, 'full')",
  ).run();

  // player_stats
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (10, 100, 4, 2, 5, 1, 0, 0, 0, 'summary', ?, 1.0)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (10, 101, 3, 1, 4, 2, 0, 0, 0, 'summary', ?, 1.0)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (11, 100, 2, 3, 6, 0, 0, 0, 0, 'summary', ?, 1.0)`,
  ).run(PARSER);

  // rankings
  d.prepare(
    `INSERT INTO rankings (week_start, ranking_source, team_id, rank, source_post_id, captured_at)
     VALUES ('2025-04-21', 'philly', 1, 1, 'rk-1', ?)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO rankings (week_start, ranking_source, team_id, rank, source_post_id, captured_at)
     VALUES ('2025-04-21', 'philly', 2, 4, 'rk-1', ?)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO rankings (week_start, ranking_source, team_id, rank, source_post_id, captured_at)
     VALUES ('2025-04-14', 'philly', 1, 2, 'rk-0', ?)`,
  ).run(NOW);

  // anomalies
  d.prepare(
    `INSERT INTO ingest_anomalies (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES ('post-1', 'https://example.com/p/1', 'FO – 14/18', NULL, 'player-stat-line', 'orphan continuation', ?)`,
  ).run(NOW);
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

describe('GET /api/health', () => {
  it('reports row counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.dbRows.teams).toBe(3);
    expect(body.dbRows.games).toBe(2);
    expect(body.dbRows.players).toBe(2);
    expect(body.dbRows.playerStats).toBe(3);
    expect(body.dbRows.rankings).toBe(3);
    expect(body.dbRows.anomalies).toBe(1);
  });
});

describe('GET /api/teams', () => {
  it('returns teams sorted by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(3);
    expect(body.map((t: { name: string }) => t.name)).toEqual([
      'Episcopal',
      'Haverford',
      'Malvern Prep',
    ]);
    expect(body[0]).toMatchObject({ id: expect.any(Number), slug: 'episcopal', division: 'high-school' });
  });
});

describe('GET /api/teams/:id', () => {
  it('returns team detail with computed record + games + recent ranking', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.team.name).toBe('Haverford');
    expect(body.games).toHaveLength(2);
    // Haverford: won as home (12-8) and won as away (11-9) -> 2-0-0
    // No PIAA row seeded in this test, so record falls back to derived.
    expect(body.record).toEqual({ wins: 2, losses: 0, ties: 0 });
    expect(body.derivedRecord).toEqual({ wins: 2, losses: 0, ties: 0 });
    expect(body.recordSource).toBe('phillylacrosse');
    expect(body.recentRanking).toBe(1);
    // verify camelCase
    expect(body.games[0]).toHaveProperty('homeTeamId');
    expect(body.games[0]).toHaveProperty('awayScore');
  });

  it('uses PIAA record as authoritative when team has a PIAA row', async () => {
    // Seed PIAA row for Haverford that disagrees with derived 2-0-0.
    db.prepare(
      `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
       VALUES ('Haverford', 'haverford', '3A', 5, 8, 4, 0, 12.5, 0.6, '2026-04-23T00:00:00Z')`,
    ).run();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/teams/1' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // PIAA wins on conflict -> record reflects PIAA, not derived 2-0-0.
      expect(body.record).toEqual({ wins: 8, losses: 4, ties: 0 });
      expect(body.derivedRecord).toEqual({ wins: 2, losses: 0, ties: 0 });
      expect(body.recordSource).toBe('piaa');
    } finally {
      db.prepare(`DELETE FROM piaa_official_teams WHERE name_normalized = 'haverford'`).run();
    }
  });

  it('404s on missing team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/999' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NotFound' });
  });

  it('400s on bad id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/abc' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/games', () => {
  it('lists games newest-first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].date).toBe('2025-04-21');
  });

  it('filters by date', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games?date=2025-04-19' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(11);
  });

  it('filters by team_id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games?team_id=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('rejects bad date', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games?date=garbage' });
    expect(res.statusCode).toBe(400);
  });

  it('caps limit at 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games?limit=9999' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/games/:id', () => {
  it('returns full game detail', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.game.id).toBe(10);
    expect(body.periods).toHaveLength(8);
    expect(body.playerStats).toHaveLength(2);
    expect(body.playerStats[0]).toHaveProperty('playerName');
    expect(body.playerStats[0]).toHaveProperty('teamName');
    expect(body.playerStats[0]).toHaveProperty('groundBalls');
    // Wave H5 Lane 3 (Leia) — confidence is on the wire for badge rendering.
    expect(body.playerStats[0]).toHaveProperty('confidence');
    expect(typeof body.playerStats[0].confidence).toBe('number');
  });

  it('404s on missing game', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/9999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/players/:id', () => {
  it('aggregates season stats and per-game lines', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/players/100' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.player.name).toBe('Sam Smith');
    expect(body.team.name).toBe('Haverford');
    expect(body.seasonStats).toMatchObject({
      games: 2,
      goals: 6,
      assists: 5,
      points: 11,
      groundBalls: 11,
    });
    expect(body.perGame).toHaveLength(2);
    expect(body.perGame[0]).toHaveProperty('date');
    // Wave H5 Lane 3 (Leia) — confidence is on the wire for badge rendering.
    expect(body.perGame[0]).toHaveProperty('confidence');
    expect(typeof body.perGame[0].confidence).toBe('number');
    expect(body.perGame.map((p: { date: string }) => p.date).sort()).toEqual([
      '2025-04-19',
      '2025-04-21',
    ]);
  });
});

describe('GET /api/teams/:id/topScorers', () => {
  it('returns top scorers for a team sorted by points desc', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/1/topScorers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Haverford has Sam Smith (6g+5a=11). Alex Doe is on Episcopal so should not appear.
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      playerId: 100,
      playerName: 'Sam Smith',
      goals: 6,
      assists: 5,
    });
  });

  it('honors ?limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/1/topScorers?limit=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('404s on missing team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/999/topScorers' });
    expect(res.statusCode).toBe(404);
  });

  it('400s on bad id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/teams/abc/topScorers' });
    expect(res.statusCode).toBe(400);
  });

  it('returns empty array for team with no stats', async () => {
    // Malvern Prep (id=3) has no player stats
    const res = await app.inject({ method: 'GET', url: '/api/teams/3/topScorers' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('GET /api/rankings', () => {
  it('returns latest week when ?week omitted', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rankings' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].weekStart).toBe('2025-04-21');
    expect(body[0].rank).toBe(1);
    expect(body[0].team.name).toBe('Haverford');
  });

  it('accepts source=phillylax alias', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rankings?source=phillylax' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('returns specific week', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rankings?week=2025-04-14' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].rank).toBe(2);
  });
});

describe('GET /api/anomalies', () => {
  it('returns anomalies', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/anomalies' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      sourcePostId: 'post-1',
      strategyAttempted: 'player-stat-line',
      rawLine: 'FO – 14/18',
    });
  });
});

describe('CORS', () => {
  it('allows http://localhost:5173', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
