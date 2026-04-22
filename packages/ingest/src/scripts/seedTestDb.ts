/*
 * seedTestDb.ts — Build a frozen, tiny, deterministic test database.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live ingest DB (data/lacrosse.db) is a shared, mutable resource: ingest
 * runs append rows, ad-hoc `sqlite3` audits read it, scripts back it up, and
 * vitest *used* to crack it open mid-suite. Concurrent opens are technically
 * fine (WAL), but a runaway test or a forgotten teardown can hold a write
 * lock long enough to break interactive workflows. Wave 1-3 hit that pain
 * more than once.
 *
 * THE PATTERN
 * -----------
 * 1. All DB consumers read `process.env.DB_PATH` (preferred) or
 *    `process.env.PLL_DB_PATH` (legacy) before falling back to the live path.
 * 2. vitest's globalSetup (packages/{ingest,server}/test/globalSetup.ts) calls
 *    `seedTestDb()` to wipe + rebuild `data/lacrosse.test.db` from scratch
 *    using the real migration files, then sets DB_PATH to point there.
 * 3. Tests that need a DB either use `:memory:` (preferred, isolated per
 *    suite) or read from the seeded test DB. Either way: the live DB is
 *    NEVER touched by `pnpm test`.
 *
 * The fixture is intentionally tiny (~5 teams / 3 games / 10 players) and
 * realistic enough to exercise joins, leaderboards, logo-presence branches,
 * and rankings ordering without being a maintenance burden.
 *
 * Idempotent: deletes the file (and WAL/SHM siblings) before rebuilding.
 */

import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src/scripts → repo root is ../../../..
export const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
export const DEFAULT_TEST_DB_PATH = join(REPO_ROOT, 'data', 'lacrosse.test.db');

const NOW = '2026-04-20T12:00:00Z';
const PARSER = 'test-0.1.0';

function removeIfExists(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const p = path + suffix;
    if (existsSync(p)) rmSync(p, { force: true });
  }
}

/**
 * Wipe and rebuild a test database at `path` (default: data/lacrosse.test.db).
 * Applies all migrations and seeds a tiny realistic fixture. Returns the path.
 */
export function seedTestDb(path: string = DEFAULT_TEST_DB_PATH): string {
  removeIfExists(path);
  const db = openDb(path); // applies migrations 001..NNN

  const insertTeam = db.prepare(
    'INSERT INTO teams (id, name, slug, division, logo_url, maxpreps_slug) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertGame = db.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPeriod = db.prepare(
    'INSERT INTO game_periods (game_id, team_id, period_number, goals) VALUES (?, ?, ?, ?)',
  );
  const insertPlayer = db.prepare(
    'INSERT INTO players (id, name, name_normalized, team_id, name_resolution) VALUES (?, ?, ?, ?, ?)',
  );
  const insertStat = db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'summary', ?, 1.0)`,
  );
  const insertRanking = db.prepare(
    `INSERT INTO rankings (week_start, ranking_source, team_id, rank, source_post_id, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    // 5 teams — three with logos, two without (exercise both UI branches).
    insertTeam.run(1, 'Haverford', 'haverford', 'high-school', '/logos/haverford.gif', 'haverford/haverford-fords');
    insertTeam.run(2, 'Episcopal', 'episcopal', 'high-school', '/logos/episcopal.gif', 'newtown-square/episcopal-academy-churchmen');
    insertTeam.run(3, 'Malvern Prep', 'malvern-prep', 'high-school', '/logos/malvern-prep.gif', 'malvern/malvern-prep-friars');
    insertTeam.run(4, 'Springside Chestnut Hill', 'springside-chestnut-hill', 'high-school', null, null);
    insertTeam.run(5, 'Penn Charter', 'penn-charter', 'high-school', null, null);

    // 3 games covering home/away wins, OT, and a postponed flag.
    insertGame.run(10, '2026-04-15', 1, 2, 12, 8, 0, 0, 'post-1', 'https://example.com/recap/10', NOW);
    insertGame.run(11, '2026-04-17', 3, 1, 9, 11, 1, 0, 'post-2', 'https://example.com/recap/11', NOW);
    insertGame.run(12, '2026-04-19', 4, 5, 7, 7, 0, 0, 'post-3', null, NOW);

    // Periods for game 10 (regulation) — exercises game_periods joins.
    for (let p = 1; p <= 4; p += 1) {
      insertPeriod.run(10, 1, p, 3);
      insertPeriod.run(10, 2, p, 2);
    }

    // 10 players spread across the 5 teams (2 per team).
    const players: Array<[number, string, number]> = [
      [100, 'Sam Smith', 1],
      [101, 'Drew Carter', 1],
      [102, 'Alex Doe', 2],
      [103, 'Jordan Lee', 2],
      [104, 'Riley Quinn', 3],
      [105, 'Casey Park', 3],
      [106, 'Morgan Reed', 4],
      [107, 'Taylor Brooks', 4],
      [108, 'Jamie Cole', 5],
      [109, 'Hayden Voss', 5],
    ];
    for (const [id, name, teamId] of players) {
      insertPlayer.run(id, name, name.toLowerCase(), teamId, 'full');
    }

    // 12 player_stats rows across the 3 games — enough to drive leaderboards.
    const stats: Array<[number, number, number, number, number, number, number, number, number]> = [
      // game 10 (Haverford 12 - Episcopal 8)
      [10, 100, 4, 2, 5, 1, 0, 0, 0],
      [10, 101, 3, 1, 3, 0, 0, 0, 0],
      [10, 102, 3, 1, 4, 2, 0, 0, 0],
      [10, 103, 2, 0, 2, 1, 0, 0, 0],
      // game 11 (Malvern 9 - Haverford 11 OT)
      [11, 100, 2, 3, 6, 0, 0, 0, 0],
      [11, 101, 4, 1, 2, 0, 0, 0, 0],
      [11, 104, 3, 2, 5, 1, 0, 0, 0],
      [11, 105, 2, 1, 3, 0, 0, 0, 0],
      // game 12 (Springside 7 - Penn Charter 7)
      [12, 106, 3, 1, 4, 1, 0, 0, 0],
      [12, 107, 2, 2, 3, 0, 0, 0, 0],
      [12, 108, 4, 0, 5, 2, 0, 0, 0],
      [12, 109, 0, 0, 0, 0, 12, 0, 0],
    ];
    for (const row of stats) {
      insertStat.run(...row, PARSER);
    }

    // Rankings — two weeks so "recent" ordering is exercised.
    insertRanking.run('2026-04-20', 'philly', 1, 1, 'rk-1', NOW);
    insertRanking.run('2026-04-20', 'philly', 2, 3, 'rk-1', NOW);
    insertRanking.run('2026-04-20', 'philly', 3, 5, 'rk-1', NOW);
    insertRanking.run('2026-04-13', 'philly', 1, 2, 'rk-0', NOW);

    // PIAA official team rows — Haverford matches via team_aliases (alias path),
    // Episcopal matches directly via name_normalized = LOWER(t.name).
    // Malvern Prep, Springside, Penn Charter intentionally omitted to exercise
    // the "no PIAA data" branch.
    db.prepare(
      `INSERT INTO piaa_official_teams
         (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Haverford School', 'haverford school', '3A', 5, 4, 8, 0, 12.5, 0.6, NOW);
    db.prepare(
      `INSERT INTO piaa_official_teams
         (name_official, name_normalized, classification, seed, wins, losses, ties, total_points, ranking, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('Episcopal Academy', 'episcopal', '3A', null, 10, 2, 1, 30.0, 2.5, NOW);

    // Alias so Haverford (team name) resolves to "haverford school" PIAA row.
    db.prepare(
      `INSERT INTO team_aliases (alias, team_id, source, confidence) VALUES (?, ?, 'manual', 1.0)`,
    ).run('haverford school', 1);
  });
  tx();

  db.close();
  return path;
}

// CLI entry: `pnpm --filter @pll/ingest test:db:seed [path]`
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_TEST_DB_PATH;
  const out = seedTestDb(target);
  // eslint-disable-next-line no-console
  console.log(`seeded test db: ${out}`);
}
