// laxnumbers.test.ts — unit tests for the LaxNumbers PA-only additive ingest pipeline.
// All HTTP calls are mocked via the `fetch` injection point in LaxNumbersOpts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDb } from '../../db.js';
import { runLaxNumbersIngest } from '../laxnumbers.js';
import type { Database } from 'better-sqlite3';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeDb(): Database {
  const db = openDb(':memory:');
  db.prepare(
    "INSERT INTO teams (name, slug, division) VALUES ('Team Alpha', 'team-alpha', 'high-school')",
  ).run();
  db.prepare(
    "INSERT INTO teams (name, slug, division) VALUES ('Team Beta', 'team-beta', 'high-school')",
  ).run();
  db.prepare(
    "INSERT INTO teams (name, slug, division) VALUES ('Team Gamma', 'team-gamma', 'high-school')",
  ).run();
  return db;
}

type PartialGame = {
  home_team_name?: string;
  visitor_team_name?: string;
  home_state?: string;
  visitor_state?: string;
  level_desc?: string;
  game_home_score?: number;
  game_visitor_score?: number;
  game_date?: string;
  game_postponed?: number;
};

function makeGame(overrides: PartialGame = {}) {
  return {
    home_team_name: 'Team Alpha',
    visitor_team_name: 'Team Beta',
    home_state: 'PA',
    visitor_state: 'PA',
    level_desc: 'Boys HS',
    game_home_score: 8,
    game_visitor_score: 5,
    game_date: '20260415',
    game_postponed: 0,
    ...overrides,
  };
}

function makeFetch(games: object[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => games,
  } as Response);
}

function getTeamId(db: Database, name: string): number {
  const row = db.prepare('SELECT id FROM teams WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`team not found: ${name}`);
  return row.id;
}

function insertGame(
  db: Database,
  opts: {
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number;
    awayScore: number;
    date?: string;
    source?: string;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO games
         (date, home_team_id, away_team_id, home_score, away_score,
          ot_periods, postponed, source_post_id, parsed_at, season, source)
       VALUES (?, ?, ?, ?, ?, 0, 0, '', datetime('now'), 2026, ?)`,
    )
    .run(
      opts.date ?? '2026-04-15',
      opts.homeTeamId,
      opts.awayTeamId,
      opts.homeScore,
      opts.awayScore,
      opts.source ?? 'phillylacrosse',
    );
  return Number(info.lastInsertRowid);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runLaxNumbersIngest', () => {
  let db: Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  // ── Case 1: both teams resolve, no existing row → INSERT ──────────────────
  it('inserts a new game when both teams resolve and no existing row', async () => {
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame()]),
    });

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped.alreadyComplete).toBe(0);
    expect(result.anomalies).toHaveLength(0);

    const row = db
      .prepare(
        `SELECT home_score, away_score, source FROM games
         WHERE date = '2026-04-15'`,
      )
      .get() as { home_score: number; away_score: number; source: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.home_score).toBe(8);
    expect(row!.away_score).toBe(5);
    expect(row!.source).toBe('laxnumbers');
  });

  // ── Case 2: existing PL row with non-zero scores → skipped.alreadyComplete ─
  it('skips a game when an existing row already has non-zero scores', async () => {
    const alphaId = getTeamId(db, 'Team Alpha');
    const betaId = getTeamId(db, 'Team Beta');
    insertGame(db, { homeTeamId: alphaId, awayTeamId: betaId, homeScore: 5, awayScore: 3 });

    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame()]),
    });

    expect(result.skipped.alreadyComplete).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);

    // Verify the original PL scores were NOT overwritten
    const row = db
      .prepare('SELECT home_score, away_score, source FROM games WHERE date = ?')
      .get('2026-04-15') as { home_score: number; away_score: number; source: string };
    expect(row.home_score).toBe(5);
    expect(row.away_score).toBe(3);
    expect(row.source).toBe('phillylacrosse');
  });

  // ── Case 3: existing row with 0/0 scores → UPDATE, source → 'laxnumbers' ──
  it('updates scores for an existing row that has 0/0 scores', async () => {
    const alphaId = getTeamId(db, 'Team Alpha');
    const betaId = getTeamId(db, 'Team Beta');
    insertGame(db, { homeTeamId: alphaId, awayTeamId: betaId, homeScore: 0, awayScore: 0 });

    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame()]),
    });

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.skipped.alreadyComplete).toBe(0);

    const row = db
      .prepare('SELECT home_score, away_score, source FROM games WHERE date = ?')
      .get('2026-04-15') as { home_score: number; away_score: number; source: string };
    expect(row.home_score).toBe(8);
    expect(row.away_score).toBe(5);
    expect(row.source).toBe('laxnumbers');
  });

  // ── Case 4: unknown home team → skipped.unknownTeam + anomaly ─────────────
  it('skips and logs anomaly when home team is unknown', async () => {
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame({ home_team_name: 'Ghost Squad Lacrosse' })]),
    });

    expect(result.skipped.unknownTeam).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]!.kind).toBe('unknown_team');
    expect(result.anomalies[0]!.detail).toContain('Ghost Squad Lacrosse');
  });

  // ── Case 5: Girls HS → skipped.nonPA ──────────────────────────────────────
  it('skips games with level_desc !== "Boys HS"', async () => {
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame({ level_desc: 'Girls HS' })]),
    });

    expect(result.skipped.nonPA).toBe(1);
    expect(result.paGames).toBe(0);
    expect(result.inserted).toBe(0);
  });

  // ── Case 6: postponed game → skipped.postponed ────────────────────────────
  it('skips postponed games', async () => {
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame({ game_postponed: 1 })]),
    });

    expect(result.skipped.postponed).toBe(1);
    expect(result.inserted).toBe(0);
  });

  // ── Case 7: reverse home/away → no duplicate ──────────────────────────────
  it('detects a game stored with home/away swapped and does not duplicate it', async () => {
    const alphaId = getTeamId(db, 'Team Alpha');
    const betaId = getTeamId(db, 'Team Beta');
    // DB has Beta as home, Alpha as away (with real scores)
    insertGame(db, { homeTeamId: betaId, awayTeamId: alphaId, homeScore: 10, awayScore: 7 });

    // LaxNumbers returns Alpha as home, Beta as visitor (reversed)
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: true,
      fetch: makeFetch([makeGame({ home_team_name: 'Team Alpha', visitor_team_name: 'Team Beta' })]),
    });

    expect(result.skipped.alreadyComplete).toBe(1);
    expect(result.inserted).toBe(0);

    // Exactly one game row — no duplicate
    const count = db
      .prepare("SELECT COUNT(*) as c FROM games WHERE date = '2026-04-15'")
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  // ── Dry-run: apply=false counts but does not write ─────────────────────────
  it('dry-run (apply=false) counts inserts but writes nothing', async () => {
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: false,
      fetch: makeFetch([makeGame()]),
    });

    expect(result.inserted).toBe(1);
    const count = db
      .prepare("SELECT COUNT(*) as c FROM games WHERE date = '2026-04-15'")
      .get() as { c: number };
    expect(count.c).toBe(0); // nothing written
  });

  // ── Non-PA out-of-state game (neither team PA) → skipped.nonPA ────────────
  it('skips games where neither team is from PA', async () => {
    const result = await runLaxNumbersIngest(db, {
      date: '2026-04-15',
      apply: false,
      fetch: makeFetch([makeGame({ home_state: 'NY', visitor_state: 'NJ' })]),
    });

    expect(result.skipped.nonPA).toBe(1);
    expect(result.inserted).toBe(0);
  });
});
