import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';

const NOW = '2026-05-01T12:00:00Z';
const PARSER = '0.1.0';

let db: Database;
let app: FastifyInstance;

function seed(d: Database): void {
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Harriton', 'harriton', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Radnor', 'radnor', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (3, 'Conestoga', 'conestoga', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (4, 'Lower Merion', 'lower-merion', 'high-school')").run();

  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (100, 'Alex Attack', 'alex attack', 1, 'full')").run();
  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (101, 'Mason Mid', 'mason mid', 1, 'full')").run();
  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (102, 'Gabe Goalie', 'gabe goalie', 1, 'full')").run();
  d.prepare("INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (200, 'Rival Player', 'rival player', 2, 'full')").run();

  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (10, '2026-04-01', 1, 2, 12, 8, 0, 0, 'p10', NULL, ?, 2026)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (11, '2026-04-05', 3, 1, 10, 7, 0, 0, 'p11', NULL, ?, 2026)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (12, '2026-04-09', 1, 4, 9, 11, 0, 0, 'p12', NULL, ?, 2026)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (13, '2025-04-09', 1, 4, 6, 5, 0, 0, 'p13', NULL, ?, 2025)`,
  ).run(NOW);

  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (10, 100, 4, 2, 0, 0, 0, 0, 0, 'summary', ?, 1.0, 2026)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (10, 101, 2, 1, 0, 0, 0, 0, 0, 'summary', ?, 1.0, 2026)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (11, 100, 3, 0, 0, 0, 0, 0, 0, 'summary', ?, 1.0, 2026)`,
  ).run(PARSER);
  d.prepare(
    `INSERT INTO player_stats (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (13, 102, 1, 0, 0, 0, 0, 0, 0, 'summary', ?, 1.0, 2025)`,
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

describe('GET /api/coach/dashboard', () => {
  it('returns seasonal stat coverage gaps for a team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/coach/dashboard?teamId=1&season=2026' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as {
      team: { id: string; name: string; record: string };
      gamesTotal: number;
      gamesWithStats: number;
      gamesWithoutStats: number;
      missingStatGames: Array<{ gameId: string; opponent: string; date: string }>;
      playerCount: number;
      playersWithNoStats: Array<{ id: string; name: string }>;
      uploadUrl: string;
    };

    expect(body.team).toEqual({ id: '1', name: 'Harriton', record: '1-2' });
    expect(body.gamesTotal).toBe(3);
    expect(body.gamesWithStats).toBe(2);
    expect(body.gamesWithoutStats).toBe(1);
    expect(body.missingStatGames).toEqual([
      { gameId: '12', opponent: 'Lower Merion', date: '2026-04-09' },
    ]);
    expect(body.playerCount).toBe(3);
    expect(body.playersWithNoStats).toEqual([
      { id: '102', name: 'Gabe Goalie' },
    ]);
    expect(body.uploadUrl).toBe('#/coach/upload');
  });

  it('defaults to the latest season when none is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/coach/dashboard?teamId=1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      gamesTotal: number;
      playersWithNoStats: Array<{ id: string; name: string }>;
    };
    expect(body.gamesTotal).toBe(3);
    expect(body.playersWithNoStats).toEqual([{ id: '102', name: 'Gabe Goalie' }]);
  });
});
