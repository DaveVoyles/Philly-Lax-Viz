// Wave 13 Lane 2 — season-aware leaderboard + /api/seasons + season filter.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';
import { defaultSeason, listSeasons, parseSeasonParam, resolveSeason } from '../queries/seasons.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2026-04-22T00:00:00Z';
const PARSER = '0.1.0';

function seed(d: Database): void {
  d.prepare('INSERT INTO teams (id, name, slug, division) VALUES (1, ?, ?, ?)')
    .run('Alpha', 'alpha', 'high-school');
  d.prepare('INSERT INTO teams (id, name, slug, division) VALUES (2, ?, ?, ?)')
    .run('Bravo', 'bravo', 'high-school');

  // 2024 game: Alpha 5 - Bravo 3
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (1, '2024-04-10', 1, 2, 5, 3, 0, 0, 'p24', NULL, ?, 2024)`,
  ).run(NOW);
  // 2025 game: Alpha 8 - Bravo 6
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (2, '2025-04-10', 1, 2, 8, 6, 0, 0, 'p25', NULL, ?, 2025)`,
  ).run(NOW);
  // 2026 game: Bravo 11 - Alpha 4
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (3, '2026-04-10', 2, 1, 11, 4, 0, 0, 'p26', NULL, ?, 2026)`,
  ).run(NOW);

  // Players: one per team
  d.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (1, 'Aaron Apple', 'aaron apple', 1, 'full')`,
  ).run();
  d.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (2, 'Brian Berry', 'brian berry', 2, 'full')`,
  ).run();

  // Aaron: 5g/2a in 2024, 9g/4a in 2025, 1g/0a in 2026
  // Brian: 3g/1a in 2024, 6g/3a in 2025, 11g/2a in 2026
  const ps = d.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 'summary', ?, 1.0, ?)`,
  );
  ps.run(1, 1, 5, 2, PARSER, 2024);
  ps.run(1, 2, 3, 1, PARSER, 2024);
  ps.run(2, 1, 9, 4, PARSER, 2025);
  ps.run(2, 2, 6, 3, PARSER, 2025);
  ps.run(3, 1, 1, 0, PARSER, 2026);
  ps.run(3, 2, 11, 2, PARSER, 2026);
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

describe('seasons helpers', () => {
  it('listSeasons returns distinct seasons newest first', () => {
    expect(listSeasons(db)).toEqual([2026, 2025, 2024]);
  });
  it('defaultSeason returns the newest season with games', () => {
    expect(defaultSeason(db)).toBe(2026);
  });
  it('parseSeasonParam handles undefined / "all" / numeric / invalid', () => {
    expect(parseSeasonParam(undefined)).toBeUndefined();
    expect(parseSeasonParam('')).toBeUndefined();
    expect(parseSeasonParam('all')).toBeNull();
    expect(parseSeasonParam('2024')).toBe(2024);
    expect(() => parseSeasonParam('1999')).toThrow();
    expect(() => parseSeasonParam('abc')).toThrow();
  });
  it('resolveSeason falls back to default when not specified', () => {
    expect(resolveSeason(db, undefined)).toBe(2026);
    expect(resolveSeason(db, '2024')).toBe(2024);
    expect(resolveSeason(db, 'all')).toBeNull();
  });
});

describe('GET /api/seasons', () => {
  it('returns all distinct seasons newest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/seasons' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.seasons).toEqual([2026, 2025, 2024]);
    expect(body.default).toBe(2026);
  });
});

describe('GET /api/leaders/players?season=YYYY', () => {
  it('defaults to newest season (2026) and returns Brian on top', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leaders/players?metric=goals' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBe(2026);
    expect(body.rows[0].playerName).toBe('Brian Berry');
    expect(body.rows[0].goals).toBe(11);
  });
  it('filters to season=2024 and only counts 2024 stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=goals&season=2024',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBe(2024);
    expect(body.rows[0].playerName).toBe('Aaron Apple');
    expect(body.rows[0].goals).toBe(5);
    // Brian's 2025/2026 stats should not contribute.
    const brian = body.rows.find((r: { playerName: string }) => r.playerName === 'Brian Berry');
    expect(brian.goals).toBe(3);
  });
  it('season=all returns aggregated across all years', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=goals&season=all',
    });
    const body = res.json();
    expect(body.season).toBeNull();
    const aaron = body.rows.find((r: { playerName: string }) => r.playerName === 'Aaron Apple');
    const brian = body.rows.find((r: { playerName: string }) => r.playerName === 'Brian Berry');
    expect(aaron.goals).toBe(5 + 9 + 1);
    expect(brian.goals).toBe(3 + 6 + 11);
  });
  it('rejects garbage season values with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/players?metric=goals&season=foo',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/leaders/teams?season=YYYY', () => {
  it('filters team standings to a single season', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaders/teams?metric=wins&season=2024',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.season).toBe(2024);
    const alpha = body.rows.find((r: { teamName: string }) => r.teamName === 'Alpha');
    expect(alpha.wins).toBe(1);
    expect(alpha.gamesPlayed).toBe(1);
    const bravo = body.rows.find((r: { teamName: string }) => r.teamName === 'Bravo');
    expect(bravo.wins).toBe(0);
    expect(bravo.gamesPlayed).toBe(1);
  });
});
