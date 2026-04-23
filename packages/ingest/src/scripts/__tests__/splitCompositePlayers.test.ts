import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { buildPlan, applyPlan } from '../splitCompositePlayers.js';

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

function seedPlayer(db: DatabaseType, id: number, name: string, teamId: number): void {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, 'full')`,
  ).run(id, name, name.toLowerCase(), teamId);
}

function seedGame(
  db: DatabaseType,
  id: number,
  homeTeamId: number,
  awayTeamId: number,
): void {
  db.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, '2026-04-10', ?, ?, 5, 5, 0, 0, ?, ?, ?, 2026)`,
  ).run(
    id,
    homeTeamId,
    awayTeamId,
    `post-${id}`,
    `https://example.test/recap/${id}`,
    '2026-04-10T00:00:00Z',
  );
}

function seedStat(
  db: DatabaseType,
  gameId: number,
  playerId: number,
  goals = 1,
  assists = 0,
): void {
  db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 'summary', 'test', 1.0, 2026)`,
  ).run(gameId, playerId, goals, assists);
}

describe('splitCompositePlayers', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 1, 'Saint Joseph Prep', 'sjp');
    seedTeam(db, 2, 'Other Team', 'other');
    seedGame(db, 100, 1, 2);
    // Composite player on team 1.
    seedPlayer(db, 10, 'Mason Proctor and Javier Gonzalez-Cruz', 1);
    seedStat(db, 100, 10, 3, 1);
    // A normal player whose name contains "and" substring (should NOT split).
    seedPlayer(db, 11, 'Roland Anderson', 1);
    seedStat(db, 100, 11, 2, 0);
  });

  it('detects composite rows and ignores false positives in the plan', () => {
    const plan = buildPlan(db);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.composite.id).toBe(10);
    expect(plan.actions[0]?.splitNames).toEqual([
      'Mason Proctor',
      'Javier Gonzalez-Cruz',
    ]);
    expect(plan.actions[0]?.stats).toHaveLength(1);
  });

  it('dry-run does NOT mutate the database', () => {
    buildPlan(db); // build only
    const composite = db
      .prepare('SELECT name FROM players WHERE id = 10')
      .get() as { name: string } | undefined;
    expect(composite?.name).toBe('Mason Proctor and Javier Gonzalez-Cruz');
    const stat = db
      .prepare('SELECT player_id FROM player_stats WHERE game_id = 100 AND player_id = 10')
      .get() as { player_id: number } | undefined;
    expect(stat?.player_id).toBe(10);
  });

  it('--apply creates split players, moves stats to first, deletes composite', () => {
    const plan = buildPlan(db);
    const result = applyPlan(db, plan);

    // Composite gone.
    const composite = db
      .prepare('SELECT id FROM players WHERE id = 10')
      .get();
    expect(composite).toBeUndefined();

    // Two split players exist on team 1.
    const split = db
      .prepare<[number], { id: number; name: string }>(
        'SELECT id, name FROM players WHERE team_id = ? ORDER BY name',
      )
      .all(1);
    const names = split.map((s) => s.name).sort();
    expect(names).toContain('Mason Proctor');
    expect(names).toContain('Javier Gonzalez-Cruz');
    expect(names).toContain('Roland Anderson');

    // Stat row moved to FIRST split player ("Mason Proctor").
    const masonRow = split.find((s) => s.name === 'Mason Proctor');
    expect(masonRow).toBeDefined();
    const movedStat = db
      .prepare('SELECT goals, assists FROM player_stats WHERE game_id = 100 AND player_id = ?')
      .get(masonRow!.id) as { goals: number; assists: number } | undefined;
    expect(movedStat).toEqual({ goals: 3, assists: 1 });

    // Roland Anderson untouched.
    const rolandStat = db
      .prepare('SELECT goals FROM player_stats WHERE game_id = 100 AND player_id = 11')
      .get() as { goals: number } | undefined;
    expect(rolandStat?.goals).toBe(2);

    // Result counters.
    expect(result.playersDeleted).toBe(1);
    expect(result.playersCreated).toBe(2);
    expect(result.statRowsMoved).toBe(1);
  });

  it('reuses existing split-player rows instead of creating duplicates', () => {
    // Pre-create one of the split players on the same team.
    seedPlayer(db, 20, 'Mason Proctor', 1);

    const plan = buildPlan(db);
    const result = applyPlan(db, plan);

    // Only ONE new player should be created (Javier), not two.
    expect(result.playersCreated).toBe(1);

    // Stat from composite should land on existing Mason Proctor (id 20).
    const stat = db
      .prepare('SELECT goals FROM player_stats WHERE game_id = 100 AND player_id = 20')
      .get() as { goals: number } | undefined;
    expect(stat?.goals).toBe(3);
  });

  it('handles three-name Oxford composites', () => {
    seedPlayer(db, 30, 'Alpha One, Bravo Two, and Charlie Three', 2);
    const plan = buildPlan(db);
    const action = plan.actions.find((a) => a.composite.id === 30);
    expect(action?.splitNames).toEqual(['Alpha One', 'Bravo Two', 'Charlie Three']);
    const result = applyPlan(db, plan);
    expect(result.playersCreated).toBeGreaterThanOrEqual(3);
  });
});
