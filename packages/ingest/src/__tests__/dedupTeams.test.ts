import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import { applyExplicitPairs, EXPLICIT_PAIRS } from '../scripts/dedupTeams.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function insertTeam(
  db: Database.Database,
  id: number,
  name: string,
  slug: string,
) {
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);
}

function insertGame(
  db: Database.Database,
  id: number,
  date: string,
  home: number,
  away: number,
) {
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, date, home, away, 10, 8, `post-${id}`, '2026-04-22T00:00:00Z');
}

function insertPlayer(
  db: Database.Database,
  id: number,
  teamId: number,
  name: string,
  norm: string,
) {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, norm, teamId);
}

function insertAlias(db: Database.Database, alias: string, teamId: number) {
  db.prepare(
    `INSERT INTO team_aliases (alias, team_id, source, confidence)
     VALUES (?, ?, 'test', 1.0)`,
  ).run(alias, teamId);
}

const teamCount = (db: Database.Database) =>
  (db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c;
const teamExists = (db: Database.Database, id: number) =>
  db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id) !== undefined;

describe('applyExplicitPairs', () => {
  it('exposes the W8+W10+W17 explicit-pair list', () => {
    // 5 W8 hyphen pairs + 7 W10 dedup pairs (Jack Barrack ×3, Springside ×1,
    // Hatboro-Horsham ×1, WC East ×1, WC Henderson ×1) + 13 W17 cleanup
    // pairs (Springfield ×2, CB East, Henderson, SJP, U Darby, Arch Carroll,
    // ANC, Bonner Prendie, S. Lehigh, Manheim Twp, Lake Lehman, Spring Ford)
    // = 25 total.
    expect(EXPLICIT_PAIRS.length).toBe(25);
    // mergeFromId must be unique across all pairs (no row merged twice).
    const mergeFromIds = EXPLICIT_PAIRS.map((p) => p.mergeFromId);
    expect(new Set(mergeFromIds).size).toBe(mergeFromIds.length);
  });

  it('moves games, players, and aliases from merge-from to keep, then deletes merge-from', () => {
    const db = freshDb();
    insertTeam(db, 1, 'Spring-Ford', 'spring-ford');
    insertTeam(db, 162, 'Spring Ford', 'spring-ford-2');
    insertTeam(db, 999, 'Other', 'other');

    insertGame(db, 100, '2026-04-01', 1, 999);
    insertGame(db, 101, '2026-04-02', 162, 999);
    insertGame(db, 102, '2026-04-03', 999, 162);

    insertPlayer(db, 500, 1, 'Alice Smith', 'alice smith');
    insertPlayer(db, 501, 162, 'Bob Jones', 'bob jones');

    insertAlias(db, 'springford', 1);
    insertAlias(db, 'spring ford', 162);

    const anomalies: string[] = [];
    const reports = applyExplicitPairs(
      db,
      [{ keepId: 1, mergeFromId: 162, reason: 'test' }],
      anomalies,
    );

    expect(reports[0]?.applied).toBe(true);
    expect(reports[0]?.gamesMoved).toBe(2);
    expect(reports[0]?.playersMoved).toBe(1);
    expect(reports[0]?.aliasesMoved).toBe(1);
    expect(anomalies).toEqual([]);

    expect(teamExists(db, 1)).toBe(true);
    expect(teamExists(db, 162)).toBe(false);

    // Games re-attributed to id=1.
    const gamesOnKeep = db
      .prepare(
        'SELECT COUNT(*) AS c FROM games WHERE home_team_id = 1 OR away_team_id = 1',
      )
      .get() as { c: number };
    expect(gamesOnKeep.c).toBe(3);

    // Player moved.
    const player = db
      .prepare('SELECT team_id FROM players WHERE id = 501')
      .get() as { team_id: number } | undefined;
    expect(player?.team_id).toBe(1);

    // Alias moved (and original springford alias still present).
    const aliases = db
      .prepare('SELECT alias FROM team_aliases WHERE team_id = 1 ORDER BY alias')
      .all() as Array<{ alias: string }>;
    expect(aliases.map((a) => a.alias)).toEqual(['spring ford', 'springford']);
  });

  it('is idempotent — second run is a no-op', () => {
    const db = freshDb();
    insertTeam(db, 1, 'Spring-Ford', 'spring-ford');
    insertTeam(db, 162, 'Spring Ford', 'spring-ford-2');
    insertGame(db, 100, '2026-04-01', 1, 162);

    const pairs = [{ keepId: 1, mergeFromId: 162, reason: 'test' }];
    const before = teamCount(db);
    const r1 = applyExplicitPairs(db, pairs, []);
    expect(r1[0]?.applied).toBe(true);
    expect(teamCount(db)).toBe(before - 1);

    // Second run finds no merge-from row → skipped, applied=false, no mutations.
    const r2 = applyExplicitPairs(db, pairs, []);
    expect(r2[0]?.applied).toBe(false);
    expect(r2[0]?.reasonSkipped).toMatch(/merge-from row absent/);
    expect(teamCount(db)).toBe(before - 1);
  });

  it('skips when keep row is missing and records an anomaly', () => {
    const db = freshDb();
    insertTeam(db, 162, 'Spring Ford', 'spring-ford-2');
    const anomalies: string[] = [];
    const reports = applyExplicitPairs(
      db,
      [{ keepId: 1, mergeFromId: 162, reason: 'test' }],
      anomalies,
    );
    expect(reports[0]?.applied).toBe(false);
    expect(reports[0]?.reasonSkipped).toBe('keep row absent');
    expect(anomalies.length).toBe(1);
    expect(anomalies[0]).toMatch(/keep team id=1 missing/);
    // merge-from row untouched.
    expect(teamExists(db, 162)).toBe(true);
  });

  it('handles UNIQUE(date, home, away) game collisions by deleting the source duplicate', () => {
    const db = freshDb();
    insertTeam(db, 1, 'Spring-Ford', 'spring-ford');
    insertTeam(db, 162, 'Spring Ford', 'spring-ford-2');
    insertTeam(db, 999, 'Other', 'other');

    // Same (date, opponent) — once the source-team-id is rewritten to 1, this
    // would collide with the existing target game.
    insertGame(db, 200, '2026-04-10', 1, 999);
    insertGame(db, 201, '2026-04-10', 162, 999);

    const anomalies: string[] = [];
    const reports = applyExplicitPairs(
      db,
      [{ keepId: 1, mergeFromId: 162, reason: 'test' }],
      anomalies,
    );
    expect(reports[0]?.applied).toBe(true);
    expect(reports[0]?.collisions).toBe(1);
    expect(anomalies.some((a) => /game collision/.test(a))).toBe(true);

    // Only the target game survives.
    const games = db
      .prepare(
        "SELECT id FROM games WHERE date = '2026-04-10' AND home_team_id = 1 AND away_team_id = 999",
      )
      .all() as Array<{ id: number }>;
    expect(games.length).toBe(1);
    expect(games[0]?.id).toBe(200);
    expect(teamExists(db, 162)).toBe(false);
  });

  it('handles colliding players (same team_id, name_normalized) by redirecting stats', () => {
    const db = freshDb();
    insertTeam(db, 1, 'Spring-Ford', 'spring-ford');
    insertTeam(db, 162, 'Spring Ford', 'spring-ford-2');
    insertTeam(db, 999, 'Other', 'other');

    insertGame(db, 300, '2026-04-15', 1, 999);
    insertGame(db, 301, '2026-04-16', 162, 999);

    insertPlayer(db, 700, 1, 'Sam Player', 'sam player');
    insertPlayer(db, 701, 162, 'Sam Player', 'sam player');

    db.prepare(
      `INSERT INTO player_stats (id, game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, parser_version, confidence)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'test', 1.0)`,
    ).run(900, 301, 701, 3);

    const reports = applyExplicitPairs(
      db,
      [{ keepId: 1, mergeFromId: 162, reason: 'test' }],
      [],
    );
    expect(reports[0]?.applied).toBe(true);

    // Source player gone, target player still here.
    expect(
      db.prepare('SELECT 1 FROM players WHERE id = 701').get(),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT 1 FROM players WHERE id = 700').get(),
    ).toBeDefined();
    // Stats redirected to the canonical player.
    const stat = db.prepare('SELECT player_id FROM player_stats WHERE id = 900').get() as
      | { player_id: number }
      | undefined;
    expect(stat?.player_id).toBe(700);
  });
});
