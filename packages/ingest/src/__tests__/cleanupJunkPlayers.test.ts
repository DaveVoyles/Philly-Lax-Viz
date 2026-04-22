import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import { buildPlan, applyPlan } from '../scripts/cleanupJunkPlayers.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    1,
    'Team Alpha',
    'team-alpha',
  );
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(100, '2026-04-01', 1, 1, 10, 8, 'post-100', '2026-04-22T00:00:00Z');
  return db;
}

function insertPlayer(db: Database.Database, id: number, name: string, teamId = 1) {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
       VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, name.toLowerCase(), teamId);
}

describe('cleanupJunkPlayers', () => {
  describe('buildPlan', () => {
    let db: Database.Database;
    beforeEach(() => {
      db = freshDb();
    });

    it('identifies all four junk shapes', () => {
      insertPlayer(db, 1, "Dylan Bella's");
      insertPlayer(db, 2, "Ryan's Turse");
      insertPlayer(db, 3, 'No name provided');
      insertPlayer(db, 4, 'None');
      insertPlayer(db, 5, 'Real Player');
      insertPlayer(db, 6, "Sam O'Kane");
      insertPlayer(db, 7, "Joe O'Leary");

      const plan = buildPlan(db);
      const ids = plan.deletable.map((r) => r.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3, 4]);
      expect(plan.skipped).toHaveLength(0);
    });

    it("does NOT match legitimate Irish surnames (O'Kane, O'Leary, D'Annunzio)", () => {
      insertPlayer(db, 1, "Sam O'Kane");
      insertPlayer(db, 2, "Joe O'Leary");
      insertPlayer(db, 3, "Tony D'Annunzio");
      const plan = buildPlan(db);
      expect(plan.deletable).toHaveLength(0);
      expect(plan.skipped).toHaveLength(0);
    });

    it('moves rows with linked player_stats into `skipped` (FK confirm)', () => {
      insertPlayer(db, 1, "Dylan Bella's");
      insertPlayer(db, 2, 'None');
      db.prepare(
        `INSERT INTO player_stats (id, game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, parser_version, confidence)
           VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'test', 1.0)`,
      ).run(500, 100, 1, 4);

      const plan = buildPlan(db);
      expect(plan.deletable.map((r) => r.id)).toEqual([2]);
      expect(plan.skipped.map((r) => r.id)).toEqual([1]);
      expect(plan.skipped[0]?.linkedStats).toBe(1);
    });
  });

  describe('applyPlan', () => {
    it('deletes deletable rows and is idempotent on re-run', () => {
      const db = freshDb();
      insertPlayer(db, 1, "Dylan Bella's");
      insertPlayer(db, 2, 'None');
      insertPlayer(db, 3, 'Real Player');

      const plan1 = buildPlan(db);
      const r1 = applyPlan(db, plan1);
      expect(r1.deleted).toBe(2);
      expect(r1.postCount).toBe(1);

      const plan2 = buildPlan(db);
      expect(plan2.deletable).toHaveLength(0);
      const r2 = applyPlan(db, plan2);
      expect(r2.deleted).toBe(0);
      expect(r2.postCount).toBe(1);

      const fk = db.pragma('foreign_key_check') as unknown[];
      expect(fk).toHaveLength(0);
    });

    it('preserves rows with linked stats — never orphans a player_stat', () => {
      const db = freshDb();
      insertPlayer(db, 1, "Dylan Bella's");
      insertPlayer(db, 2, 'No name provided');
      db.prepare(
        `INSERT INTO player_stats (id, game_id, player_id, goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, parser_version, confidence)
           VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'test', 1.0)`,
      ).run(501, 100, 1, 3);

      const plan = buildPlan(db);
      const result = applyPlan(db, plan);
      expect(result.deleted).toBe(1);
      // Linked row survives.
      const survivor = db
        .prepare('SELECT id FROM players WHERE id = 1')
        .get() as { id: number } | undefined;
      expect(survivor?.id).toBe(1);
      // Stat still attaches cleanly.
      const fk = db.pragma('foreign_key_check') as unknown[];
      expect(fk).toHaveLength(0);
    });
  });
});
