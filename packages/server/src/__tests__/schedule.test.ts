// schedule.test.ts — Wave 16 Lane 2 (Leia). HTTP route smoke tests for
// /api/schedule and /api/schedule/team/:id/upcoming.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from '../app.js';

const NOW = '2026-04-22T12:00:00Z';

let db: Database;
let app: FastifyInstance;

function seed(d: Database): void {
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
  d.prepare("INSERT INTO teams (id, name, slug, division) VALUES (2, 'Episcopal Academy', 'episcopal-academy', 'high-school')").run();

  const ins = d.prepare(
    `INSERT INTO schedule_games
       (home_team_id, away_team_id, home_team_name_raw, away_team_name_raw,
        game_date, game_time, location, source, source_url, season, scraped_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  );
  // Future games
  ins.run(1, 2, 'Haverford', 'Episcopal Academy', '2026-05-01', 'piaa-d1', 'https://example/sched', 2026, NOW);
  ins.run(2, 1, 'Episcopal Academy', 'Haverford', '2026-05-08', 'piaa-d1', 'https://example/sched', 2026, NOW);
  ins.run(1, null, 'Haverford', 'Mystery School', '2026-06-01', 'piaa-d1', 'https://example/sched', 2026, NOW);
  // Past game (relative to from=today=2026-04-22 default isn't applied to
  // these tests since we pass explicit `from`, but we keep one row to make
  // sure the date filter actually filters).
  ins.run(1, 2, 'Haverford', 'Episcopal Academy', '2026-03-01', 'piaa-d1', 'https://example/sched', 2026, NOW);
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

describe('GET /api/schedule', () => {
  it('returns games grouped by date and respects from filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedule?from=2026-04-22' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; byDate: { date: string; games: unknown[] }[] };
    expect(body.total).toBe(3);
    expect(body.byDate.map((d) => d.date)).toEqual(['2026-05-01', '2026-05-08', '2026-06-01']);
  });

  it('respects to filter to bound the upper window', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedule?from=2026-04-22&to=2026-05-31' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number };
    expect(body.total).toBe(2);
  });

  it('rejects malformed from date', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedule?from=not-a-date' });
    expect(res.statusCode).toBe(400);
  });

  it('returns enriched team names + slugs from the join', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedule?from=2026-04-22' });
    const body = res.json() as {
      byDate: { games: { homeTeamName: string; awayTeamName: string; homeTeamSlug: string | null; awayTeamSlug: string | null }[] }[];
    };
    const firstGame = body.byDate[0]!.games[0]!;
    expect(firstGame.homeTeamName).toBe('Haverford');
    expect(firstGame.awayTeamName).toBe('Episcopal Academy');
    expect(firstGame.homeTeamSlug).toBe('haverford');
  });
});

describe('GET /api/schedule/team/:id/upcoming', () => {
  it('returns only games for that team, future only, limited', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedule/team/1/upcoming?limit=2&from=2026-04-22' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { teamId: number; games: { gameDate: string }[] };
    expect(body.teamId).toBe(1);
    expect(body.games.length).toBe(2);
    expect(body.games[0]!.gameDate).toBe('2026-05-01');
  });

  it('rejects bad limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedule/team/1/upcoming?limit=999' });
    expect(res.statusCode).toBe(400);
  });
});
