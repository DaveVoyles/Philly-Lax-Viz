// cleanOrphanAliases.test.ts — Wave 15 Lane 1 (Chewy 🐻💪).

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import { cleanOrphanAliases, findOrphanAliases } from './cleanOrphanAliases.js';

function freshDb() {
  const db = new Database(':memory:');
  // Migrations create the schema; foreign_keys OFF so we can intentionally
  // insert orphans for test setup (real cleanup uses FK ON).
  db.pragma('foreign_keys = OFF');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: ReturnType<typeof freshDb>): number {
  const info = db
    .prepare('INSERT INTO teams (name, slug) VALUES (?, ?)')
    .run('Test Team', 'test-team');
  return Number(info.lastInsertRowid);
}

function seedPlayer(db: ReturnType<typeof freshDb>, teamId: number, name: string): number {
  const info = db
    .prepare(
      'INSERT INTO players (team_id, name, name_normalized) VALUES (?, ?, ?)',
    )
    .run(teamId, name, name.toLowerCase());
  return Number(info.lastInsertRowid);
}

describe('cleanOrphanAliases', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it('finds aliases whose player_id is missing from players table', () => {
    const teamId = seedTeam(db);
    const livePlayerId = seedPlayer(db, teamId, 'Alice');
    // Live alias
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('A. Smith', livePlayerId);
    // Orphan aliases — players row never existed (FK off)
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('Ghost One', 99999);
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('Ghost Two', 99998);

    const orphans = findOrphanAliases(db);
    expect(orphans).toHaveLength(2);
    expect(orphans.map((o) => o.alias).sort()).toEqual(['Ghost One', 'Ghost Two']);
  });

  it('dry-run reports orphans but does NOT delete', () => {
    const teamId = seedTeam(db);
    seedPlayer(db, teamId, 'Bob');
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('Orphan', 88888);

    const before = db
      .prepare('SELECT COUNT(*) AS c FROM player_aliases')
      .get() as { c: number };

    const r = cleanOrphanAliases(db, false);
    expect(r.orphans).toHaveLength(1);
    expect(r.deleted).toBe(0);
    expect(r.applied).toBe(false);

    const after = db
      .prepare('SELECT COUNT(*) AS c FROM player_aliases')
      .get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('apply=true deletes orphan aliases and leaves live aliases intact', () => {
    const teamId = seedTeam(db);
    const livePlayerId = seedPlayer(db, teamId, 'Carol');
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('C. Carol', livePlayerId);
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('Orphan A', 77777);
    db.prepare(
      "INSERT INTO player_aliases (alias, player_id, source) VALUES (?, ?, 'manual')",
    ).run('Orphan B', 77776);

    const r = cleanOrphanAliases(db, true);
    expect(r.deleted).toBe(2);
    expect(r.applied).toBe(true);

    const remaining = db
      .prepare('SELECT alias FROM player_aliases ORDER BY alias')
      .all() as Array<{ alias: string }>;
    expect(remaining).toEqual([{ alias: 'C. Carol' }]);

    // Re-running is a no-op
    const second = cleanOrphanAliases(db, true);
    expect(second.deleted).toBe(0);
    expect(second.orphans).toHaveLength(0);
  });
});
