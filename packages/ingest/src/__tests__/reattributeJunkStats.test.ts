import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import {
  buildPlan,
  applyPlan,
  type JunkSpec,
} from '../scripts/reattributeJunkStats.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    23,
    'Abington Heights',
    'abington-heights',
  );
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    41,
    'WC Henderson',
    'wc-henderson',
  );
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    1,
    'Spring-Ford',
    'spring-ford',
  );
  // Game rows for stats + soft-flag anomaly source columns. Vary the date so
  // the UNIQUE(date, home_team_id, away_team_id) index doesn't collide.
  let day = 1;
  for (const id of [32, 150, 154]) {
    db.prepare(
      `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, source_post_id, recap_url, parsed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      `2026-04-0${day++}`,
      23,
      41,
      10,
      8,
      `post-${id}`,
      `https://example.com/${id}`,
      '2026-04-22T00:00:00Z',
    );
  }
  return db;
}

function insertPlayer(db: Database.Database, id: number, name: string, teamId: number) {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
       VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, name.toLowerCase(), teamId);
}

function insertStat(db: Database.Database, id: number, gameId: number, playerId: number) {
  db.prepare(
    `INSERT INTO player_stats
       (id, game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence)
     VALUES (?, ?, ?, 0, 0, 0, 0, 1, 0, 0, 'summary', 'test', 1.0)`,
  ).run(id, gameId, playerId);
}

const SPECS: JunkSpec[] = [
  { junkId: 434, resolution: { kind: 'rename', toName: 'Dylan Bella' } },
  { junkId: 974, resolution: { kind: 'reattribute', canonicalName: 'Ryan Turse' } },
  { junkId: 1007, resolution: { kind: 'soft-flag' } },
];

describe('reattributeJunkStats', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    insertPlayer(db, 434, "Dylan Bella's", 23);
    insertStat(db, 1, 32, 434);

    insertPlayer(db, 974, "Ryan's Turse", 41);
    insertPlayer(db, 258, 'Ryan Turse', 41);
    insertStat(db, 2, 150, 974);

    insertPlayer(db, 1007, 'No name provided', 1);
    insertStat(db, 3, 154, 1007);
  });

  it('applies all three resolution kinds correctly', () => {
    const planResult = buildPlan(db, SPECS);
    expect(planResult.unresolved).toEqual([]);
    expect(planResult.alreadyResolved).toEqual([]);
    expect(planResult.plans).toHaveLength(3);

    const result = applyPlan(db, planResult);
    expect(result.renamed).toBe(1);
    expect(result.reattributed).toBe(1);
    expect(result.reattributedStats).toBe(1);
    expect(result.deletedJunkPlayers).toBe(1);
    expect(result.softFlagged).toBe(1);
    expect(result.anomaliesInserted).toBe(1);

    // 434 renamed in place.
    const p434 = db.prepare('SELECT name, name_normalized FROM players WHERE id = 434').get() as
      | { name: string; name_normalized: string }
      | undefined;
    expect(p434?.name).toBe('Dylan Bella');
    expect(p434?.name_normalized).toBe('dylan bella');

    // 974 deleted, stat now points at 258.
    expect(db.prepare('SELECT id FROM players WHERE id = 974').get()).toBeUndefined();
    const stat2 = db.prepare('SELECT player_id FROM player_stats WHERE id = 2').get() as
      | { player_id: number }
      | undefined;
    expect(stat2?.player_id).toBe(258);

    // 1007 still present, FK on stat unchanged, anomaly logged.
    expect(db.prepare('SELECT id FROM players WHERE id = 1007').get()).toBeTruthy();
    const anomaly = db
      .prepare('SELECT raw_line, parent_game_id, strategy_attempted FROM ingest_anomalies LIMIT 1')
      .get() as
      | { raw_line: string; parent_game_id: number; strategy_attempted: string }
      | undefined;
    expect(anomaly?.raw_line).toBe('No name provided');
    expect(anomaly?.parent_game_id).toBe(154);

    // FK clean.
    const fk = db.pragma('foreign_key_check') as unknown[];
    expect(fk).toEqual([]);
  });

  it('is idempotent: re-running the script produces no further changes', () => {
    applyPlan(db, buildPlan(db, SPECS));
    const playersBefore = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
    const statsBefore = (
      db.prepare('SELECT COUNT(*) AS n FROM player_stats').get() as { n: number }
    ).n;
    const anomaliesBefore = (
      db.prepare('SELECT COUNT(*) AS n FROM ingest_anomalies').get() as { n: number }
    ).n;

    const planResult2 = buildPlan(db, SPECS);
    // 434 was renamed in place -> already resolved on second run.
    // 974 was deleted -> already resolved.
    // 1007 still exists -> still in plans (soft-flag), but anomaly is dedup'd.
    const result2 = applyPlan(db, planResult2);
    expect(result2.renamed).toBe(0);
    expect(result2.reattributed).toBe(0);
    expect(result2.anomaliesInserted).toBe(0);

    const playersAfter = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
    const statsAfter = (
      db.prepare('SELECT COUNT(*) AS n FROM player_stats').get() as { n: number }
    ).n;
    const anomaliesAfter = (
      db.prepare('SELECT COUNT(*) AS n FROM ingest_anomalies').get() as { n: number }
    ).n;
    expect(playersAfter).toBe(playersBefore);
    expect(statsAfter).toBe(statsBefore);
    expect(anomaliesAfter).toBe(anomaliesBefore);
  });

  it('reports unresolved when canonical target is missing', () => {
    db.prepare('DELETE FROM players WHERE id = 258').run();
    const planResult = buildPlan(db, [
      { junkId: 974, resolution: { kind: 'reattribute', canonicalName: 'Ryan Turse' } },
    ]);
    expect(planResult.unresolved).toHaveLength(1);
    expect(planResult.plans).toHaveLength(0);
  });
});
