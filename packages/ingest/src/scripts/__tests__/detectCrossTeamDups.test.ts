import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import {
  detectAndEmit,
  findCrossTeamGroups,
  emitAnomalies,
} from '../detectCrossTeamDups.js';

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: DatabaseType, id: number, name: string, slug: string): void {
  db.prepare(
    `INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, 'high-school')`,
  ).run(id, name, slug);
}

function seedPlayer(
  db: DatabaseType,
  id: number,
  name: string,
  teamId: number,
): void {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, name.toLowerCase().trim(), teamId);
}

function countAnomalies(db: DatabaseType, strategy = 'cross-team-duplicate-name'): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM ingest_anomalies WHERE strategy_attempted = ?`)
      .get(strategy) as { c: number }
  ).c;
}

describe('detectCrossTeamDups', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 1, 'Haverford', 'haverford');
    seedTeam(db, 2, 'Springfield', 'springfield');
    seedTeam(db, 3, 'Pennridge', 'pennridge');
  });

  it('inserts one anomaly per cross-team duplicate group', () => {
    seedPlayer(db, 100, 'Mason Proctor', 1);
    seedPlayer(db, 101, 'Mason Proctor', 2);
    seedPlayer(db, 102, 'Javier Gonzalez-Cruz', 1);
    seedPlayer(db, 103, 'Javier Gonzalez-Cruz', 3);
    // Same-team duplicate — must NOT be flagged (that's dedupPlayers' job).
    seedPlayer(db, 104, 'Solo Player', 1);

    const groups = findCrossTeamGroups(db);
    expect(groups.length).toBe(2);

    const result = detectAndEmit(db);
    expect(result.groupsFound).toBe(2);
    expect(result.anomaliesInserted).toBe(2);
    expect(result.anomaliesSkipped).toBe(0);
    expect(countAnomalies(db)).toBe(2);

    const sample = db
      .prepare(
        `SELECT source_post_id, source_url, raw_line, parent_game_id,
                strategy_attempted, reason
         FROM ingest_anomalies WHERE raw_line = 'player_name=mason proctor'`,
      )
      .get() as Record<string, unknown>;
    expect(sample.source_post_id).toBe('detect-cross-team-dups');
    expect(sample.source_url).toBe('');
    expect(sample.parent_game_id).toBeNull();
    expect(sample.strategy_attempted).toBe('cross-team-duplicate-name');
    expect(sample.reason).toContain('100(team=1)');
    expect(sample.reason).toContain('101(team=2)');
    expect(sample.reason).toContain('dedup:cross-team');
  });

  it('is idempotent — rerun does not duplicate anomaly rows', () => {
    seedPlayer(db, 200, 'Alice Smith', 1);
    seedPlayer(db, 201, 'Alice Smith', 2);

    const r1 = detectAndEmit(db);
    expect(r1.anomaliesInserted).toBe(1);
    expect(r1.anomaliesSkipped).toBe(0);

    const r2 = detectAndEmit(db);
    expect(r2.anomaliesInserted).toBe(0);
    expect(r2.anomaliesSkipped).toBe(1);
    expect(countAnomalies(db)).toBe(1);
  });

  it('inserts zero anomalies when no cross-team duplicates exist', () => {
    seedPlayer(db, 300, 'Bob Jones', 1);
    seedPlayer(db, 301, 'Carol Davis', 2);
    seedPlayer(db, 302, 'Dan Evans', 3);

    const groups = findCrossTeamGroups(db);
    expect(groups).toEqual([]);

    const result = emitAnomalies(db, groups);
    expect(result).toEqual({
      groupsFound: 0,
      anomaliesInserted: 0,
      anomaliesSkipped: 0,
    });
    expect(countAnomalies(db)).toBe(0);
  });
});
