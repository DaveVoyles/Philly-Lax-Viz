import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { buildPlan, applyPlan } from '../dedupCrossTeam.js';

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
): void {
  db.prepare(
    `INSERT INTO player_stats
       (game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, source, parser_version, confidence, season)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 'summary', 'test', 1.0, 2026)`,
  ).run(gameId, playerId, goals);
}

describe('dedupCrossTeam', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 1, 'Team A', 'a');
    seedTeam(db, 2, 'Team B', 'b');
    seedTeam(db, 3, 'Team C', 'c');
    seedGame(db, 100, 1, 2);
    seedGame(db, 101, 1, 3);
    seedGame(db, 102, 2, 3);
  });

  it('clean dedup: repoints stats and deletes loser player', () => {
    seedPlayer(db, 10, 'Mason Proctor', 1);
    seedPlayer(db, 11, 'Mason Proctor', 2);
    seedStat(db, 100, 10, 3);
    seedStat(db, 101, 10, 2);
    seedStat(db, 102, 11, 1); // distinct game → no collision

    const plan = buildPlan(db);
    expect(plan.actions).toHaveLength(1);
    const a = plan.actions[0]!;
    expect(a.keepId).toBe(10); // 10 has 2 games, 11 has 1
    expect(a.others.map((o) => o.id)).toEqual([11]);

    const r = applyPlan(db, plan);
    expect(r.rowsRepointed).toBe(1);
    expect(r.rowsSkippedCollision).toBe(0);
    expect(r.playersDeleted).toBe(1);
    expect(r.collisions).toHaveLength(0);

    const remaining = db
      .prepare<[string], { id: number }>('SELECT id FROM players WHERE name = ?')
      .all('Mason Proctor');
    expect(remaining.map((x) => x.id)).toEqual([10]);
    const stats = db
      .prepare<[number], { game_id: number }>(
        'SELECT game_id FROM player_stats WHERE player_id = ? ORDER BY game_id',
      )
      .all(10)
      .map((s) => s.game_id);
    expect(stats).toEqual([100, 101, 102]);
  });

  it('collision detected: shared game_id → row left in place, no auto-merge', () => {
    seedPlayer(db, 20, 'Javier Gonzalez-Cruz', 1);
    seedPlayer(db, 21, 'Javier Gonzalez-Cruz', 2);
    seedStat(db, 100, 20, 5); // both players have stats for game 100
    seedStat(db, 100, 21, 4);
    seedStat(db, 101, 20, 1); // keep-only game

    const plan = buildPlan(db);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.keepId).toBe(20);

    const r = applyPlan(db, plan);
    expect(r.rowsRepointed).toBe(0);
    expect(r.rowsSkippedCollision).toBe(1);
    expect(r.playersDeleted).toBe(0); // other still has the colliding row
    expect(r.collisions).toEqual([
      { keepId: 20, otherId: 21, gameId: 100 },
    ]);

    // Player 21 still exists, still owns its game 100 stat.
    const stillThere = db
      .prepare<[number], { id: number }>('SELECT id FROM players WHERE id = ?')
      .get(21);
    expect(stillThere?.id).toBe(21);
    const keepStats = db
      .prepare<[number], { c: number }>(
        'SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?',
      )
      .get(20)?.c;
    expect(keepStats).toBe(2);
  });

  it('no cross-team dups: no-op', () => {
    seedPlayer(db, 30, 'Unique Name', 1);
    seedPlayer(db, 31, 'Other Person', 2);

    const plan = buildPlan(db);
    expect(plan.actions).toHaveLength(0);
    const r = applyPlan(db, plan);
    expect(r.rowsRepointed).toBe(0);
    expect(r.playersDeleted).toBe(0);
    expect(r.preCount).toBe(r.postCount);
  });

  it('ignores same-team duplicates (handled by dedupPlayers.ts)', () => {
    // Same-team dupes can exist when name_normalized differs but our
    // cross-team grouping uses LOWER(TRIM(name)).
    db.prepare(
      `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
       VALUES (?, ?, ?, ?, 'full')`,
    ).run(60, 'Same Team Dupe', 'same team dupe', 1);
    db.prepare(
      `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
       VALUES (?, ?, ?, ?, 'full')`,
    ).run(61, 'Same Team Dupe', 'sametmdupe', 1);
    const plan = buildPlan(db);
    expect(plan.actions).toHaveLength(0);
  });

  it('keeps lower id when games_played tied', () => {
    seedPlayer(db, 50, 'Tie Breaker', 1);
    seedPlayer(db, 40, 'Tie Breaker', 2);
    seedStat(db, 100, 50, 1);
    seedStat(db, 101, 40, 1);

    const plan = buildPlan(db);
    expect(plan.actions[0]!.keepId).toBe(40); // lower id wins tie
  });
});
