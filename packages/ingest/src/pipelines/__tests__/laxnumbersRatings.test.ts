import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runLaxNumbersRatings, type LaxRawRating } from '../laxnumbersRatings.js';

function makeRating(overrides: Partial<LaxRawRating> = {}): LaxRawRating {
  return {
    team_nbr: 13039,
    name: 'Harriton',
    ranking: 55,
    rating: 73.66,
    agd: -5.16,
    sched: 78.83,
    wins: 5,
    losses: 13,
    ties: 0,
    gp: 18,
    gf: 133,
    ga: 226,
    state: 'PA',
    web: null,
    logo_large_url: null,
    facebook: null,
    twitter: null,
    instagram: null,
    div_rank_live: 1,
    adj_average: 0,
    suffix: '',
    ...overrides,
  };
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT,
      logo_url TEXT,
      maxpreps_slug TEXT,
      laxnumbers_team_id INTEGER
    );
    CREATE TABLE team_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias TEXT NOT NULL,
      team_id INTEGER NOT NULL,
      source TEXT,
      confidence REAL DEFAULT 1.0,
      notes TEXT
    );
    CREATE TABLE laxnumbers_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      laxnumbers_team_id INTEGER NOT NULL,
      view_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      ranking INTEGER NOT NULL,
      rating REAL NOT NULL,
      agd REAL NOT NULL,
      sched REAL NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      ties INTEGER NOT NULL DEFAULT 0,
      gf INTEGER NOT NULL DEFAULT 0,
      ga INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (team_id, view_id, year)
    );
  `);
  // Seed a team
  db.prepare("INSERT INTO teams (id, name, slug) VALUES (1, 'Harriton', 'harriton')").run();
  return db;
}

describe('laxnumbersRatings pipeline', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('dry-run does not write', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify([makeRating()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await runLaxNumbersRatings(db, {
      year: 2026,
      views: [{ id: 3454, label: 'PA East' }],
      apply: false,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    expect(result.fetched).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.upserted).toBe(0);

    const rows = db.prepare('SELECT * FROM laxnumbers_ratings').all();
    expect(rows).toHaveLength(0);
  });

  it('apply mode upserts rating and maps team_id', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify([makeRating()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await runLaxNumbersRatings(db, {
      year: 2026,
      views: [{ id: 3454, label: 'PA East' }],
      apply: true,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    expect(result.fetched).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.teamIdsMapped).toBe(1);

    const row = db.prepare('SELECT * FROM laxnumbers_ratings WHERE team_id = 1').get() as any;
    expect(row.ranking).toBe(55);
    expect(row.rating).toBe(73.66);
    expect(row.agd).toBe(-5.16);
    expect(row.sched).toBe(78.83);
    expect(row.wins).toBe(5);
    expect(row.losses).toBe(13);

    const team = db.prepare('SELECT laxnumbers_team_id FROM teams WHERE id = 1').get() as any;
    expect(team.laxnumbers_team_id).toBe(13039);
  });

  it('upsert overwrites on re-run (idempotent)', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify([makeRating({ wins: 6, losses: 13, rating: 74.0 })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await runLaxNumbersRatings(db, {
      year: 2026,
      views: [{ id: 3454, label: 'PA East' }],
      apply: true,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    // Run again with updated rating
    const mockFetch2 = async () =>
      new Response(JSON.stringify([makeRating({ wins: 7, losses: 13, rating: 75.5 })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await runLaxNumbersRatings(db, {
      year: 2026,
      views: [{ id: 3454, label: 'PA East' }],
      apply: true,
      fetch: mockFetch2 as unknown as typeof globalThis.fetch,
    });

    expect(result.upserted).toBe(1);
    const rows = db.prepare('SELECT * FROM laxnumbers_ratings WHERE team_id = 1').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].wins).toBe(7);
    expect(rows[0].rating).toBe(75.5);
  });

  it('unresolved teams produce anomalies', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify([makeRating({ name: 'Unknown Academy', team_nbr: 99999 })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await runLaxNumbersRatings(db, {
      year: 2026,
      views: [{ id: 3454, label: 'PA East' }],
      apply: true,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    expect(result.unresolved).toBe(1);
    expect(result.anomalies[0]!.kind).toBe('unresolved_team');
    expect(result.anomalies[0]!.detail).toContain('Unknown Academy');
  });

  it('handles fetch errors gracefully', async () => {
    const mockFetch = async () => new Response('', { status: 500 });

    const result = await runLaxNumbersRatings(db, {
      year: 2026,
      views: [{ id: 3454, label: 'PA East' }],
      apply: true,
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    });

    expect(result.fetched).toBe(0);
    expect(result.anomalies[0]!.kind).toBe('fetch_error');
  });
});
