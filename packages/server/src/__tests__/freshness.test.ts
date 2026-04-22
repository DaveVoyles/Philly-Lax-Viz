// W17 L3 (R2) — health + freshness endpoint smoke tests.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb } from '@pll/ingest/src/db.js';
import type { Database } from 'better-sqlite3';
import { buildApp } from '../app.js';

let db: Database;
let app: FastifyInstance;

const NOW = '2026-04-22T00:00:00Z';

function seed(d: Database): void {
  d.prepare('INSERT INTO teams (id, name, slug, division) VALUES (1, ?, ?, ?)')
    .run('Alpha', 'alpha', 'high-school');
  d.prepare('INSERT INTO teams (id, name, slug, division) VALUES (2, ?, ?, ?)')
    .run('Bravo', 'bravo', 'high-school');

  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (1, '2025-04-10', 1, 2, 5, 3, 0, 0, 'p25', NULL, ?, 2025)`,
  ).run(NOW);
  d.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (2, '2026-04-10', 2, 1, 11, 4, 0, 0, 'p26', NULL, ?, 2026)`,
  ).run(NOW);

  // ingest_post_log entries spanning multiple categories so freshness has signal.
  d.prepare(
    `INSERT INTO ingest_post_log (post_id, parser_version, category, status, processed_at, season)
     VALUES (?, ?, ?, 'ok', ?, ?)`,
  ).run('post-sb-1', '0.1.0', 'scoreboard', '2026-04-22T16:30:00Z', 2026);
  d.prepare(
    `INSERT INTO ingest_post_log (post_id, parser_version, category, status, processed_at, season)
     VALUES (?, ?, ?, 'ok', ?, ?)`,
  ).run('post-sum-1', '0.1.0', 'hs-summaries', '2026-04-22T18:00:00Z', 2026);
  d.prepare(
    `INSERT INTO ingest_post_log (post_id, parser_version, category, status, processed_at, season)
     VALUES (?, ?, ?, 'ok', ?, ?)`,
  ).run('post-rk-1', '0.1.0', 'rankings', '2026-04-21T09:00:00Z', 2026);
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

describe('GET /api/health (W17 enriched shape)', () => {
  it('returns status, version, schemaVersion, seasons[], and counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // back-compat fields preserved
    expect(body.ok).toBe(true);
    expect(body.dbRows.teams).toBe(2);
    expect(body.dbRows.games).toBe(2);

    // new W17 fields
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.schemaVersion === null || typeof body.schemaVersion === 'number').toBe(true);
    expect(Array.isArray(body.seasons)).toBe(true);
    // Two distinct seasons (2025, 2026), both should appear with games:1
    const yearMap = new Map<number, number>(
      body.seasons.map((s: { year: number; games: number }) => [s.year, s.games]),
    );
    expect(yearMap.get(2025)).toBe(1);
    expect(yearMap.get(2026)).toBe(1);
    expect(body.counts.teams).toBe(2);
    expect(body.counts.games).toBe(2);
  });
});

describe('GET /api/freshness', () => {
  it('returns per-source last timestamps + counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/freshness' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.scoreboardLast).toBe('2026-04-22T16:30:00Z');
    expect(body.recapsLast).toBe('2026-04-22T18:00:00Z');
    expect(body.rankingsLast).toBe('2026-04-21T09:00:00Z');
    // lastIngestAt is the max across categories.
    expect(body.lastIngestAt).toBe('2026-04-22T18:00:00Z');

    // Optional sources may be null when their tables are empty.
    expect(body.commitsLast === null || typeof body.commitsLast === 'string').toBe(true);
    expect(body.scheduleLast === null || typeof body.scheduleLast === 'string').toBe(true);

    expect(body.counts.teams).toBe(2);
    expect(body.counts.games).toBe(2);
    expect(typeof body.generatedAt).toBe('string');
  });

  it('returns nulls (not 500) when ingest_post_log has no rows for a category', async () => {
    // Fresh DB, no log rows at all.
    const empty = openDb(':memory:');
    const a = await buildApp(empty);
    await a.ready();
    try {
      const res = await a.inject({ method: 'GET', url: '/api/freshness' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.scoreboardLast).toBeNull();
      expect(body.recapsLast).toBeNull();
      expect(body.lastIngestAt).toBeNull();
    } finally {
      await a.close();
      empty.close();
    }
  });
});
