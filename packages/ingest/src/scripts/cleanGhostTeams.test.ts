// cleanGhostTeams.test.ts — Wave 14 Lane 1 (Yoda 🧙‍♂️🟢).
// Covers ghost-team detection + repoint + delete logic.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import { resolveTeam } from '../pipelines/teamResolver.js';
import { buildPlan, applyPlan, looksLikeGhostName } from './cleanGhostTeams.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

describe('cleanGhostTeams.looksLikeGhostName', () => {
  it('flags 1-3 char ALL-CAPS sub-header tokens', () => {
    expect(looksLikeGhostName('PR')).toBe(true);
    expect(looksLikeGhostName('OH')).toBe(true);
    expect(looksLikeGhostName('DV')).toBe(true);
    expect(looksLikeGhostName('CBW')).toBe(true);
  });
  it('flags any name length <= 3', () => {
    expect(looksLikeGhostName('abc')).toBe(true);
    expect(looksLikeGhostName('Pr')).toBe(true);
  });
  it('does NOT flag legit short names >= 4 chars', () => {
    expect(looksLikeGhostName('Olney')).toBe(false);
    expect(looksLikeGhostName('Penn')).toBe(false);
  });
  it('does NOT flag mixed-case 4+ char names', () => {
    expect(looksLikeGhostName('Easton')).toBe(false);
    expect(looksLikeGhostName('Pennridge')).toBe(false);
  });
});

describe('cleanGhostTeams.buildPlan + applyPlan', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('marks orphan ghost (no games, no players, no stats) as deletable', () => {
    const ghost = resolveTeam(db, 'PR');
    const plan = buildPlan(db);
    expect(plan.candidates.find((c) => c.id === ghost.id)).toBeDefined();
    expect(plan.deletable.find((c) => c.id === ghost.id)).toBeDefined();
    const result = applyPlan(db, plan);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const remaining = db.prepare('SELECT id FROM teams WHERE id = ?').get(ghost.id);
    expect(remaining).toBeUndefined();
  });

  it('preserves a ghost that has games attached (cannot safely delete)', () => {
    const ghost = resolveTeam(db, 'PR');
    const real = resolveTeam(db, 'Easton');
    db.prepare(
      `INSERT INTO games (date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at, season)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('2026-04-22', ghost.id, real.id, 5, 7, 'post-1', '2026-04-22T00:00:00Z', 2026);
    const plan = buildPlan(db);
    expect(plan.skipped.find((c) => c.id === ghost.id)).toBeDefined();
    expect(plan.deletable.find((c) => c.id === ghost.id)).toBeUndefined();
  });

  it('repoints orphan players from ghost to a partial-matching sibling team in the same game', () => {
    // "WK" is initials of "Worthington Kilbourne" — partialMatchesTeam handles this case.
    const ghost = resolveTeam(db, 'WK');
    const home = resolveTeam(db, 'Easton');
    const away = resolveTeam(db, 'Worthington Kilbourne');
    const gameId = (db
      .prepare(
        `INSERT INTO games (date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at, season)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get('2026-04-22', home.id, away.id, 7, 5, 'post-1', '2026-04-22T00:00:00Z', 2026) as { id: number }).id;
    const playerId = (db
      .prepare(
        `INSERT INTO players (name, name_normalized, team_id, name_resolution)
         VALUES (?, ?, ?, ?) RETURNING id`,
      )
      .get('Test Player', 'test player', ghost.id, 'full') as { id: number }).id;
    db.prepare(
      `INSERT INTO player_stats (game_id, player_id, goals, assists, source, parser_version)
       VALUES (?, ?, ?, ?, 'summary', '0.2.6')`,
    ).run(gameId, playerId, 2, 1);

    const plan = buildPlan(db);
    expect(plan.repoints).toHaveLength(1);
    expect(plan.repoints[0]!.fromTeamId).toBe(ghost.id);
    expect(plan.repoints[0]!.toTeamId).toBe(away.id); // "WK" partial-matches "Worthington Kilbourne" via initials
    expect(plan.deletable.find((c) => c.id === ghost.id)).toBeDefined();

    const result = applyPlan(db, plan);
    expect(result.repointed).toBe(1);
    const movedPlayer = db.prepare('SELECT team_id FROM players WHERE id = ?').get(playerId) as { team_id: number };
    expect(movedPlayer.team_id).toBe(away.id);
    const ghostStill = db.prepare('SELECT id FROM teams WHERE id = ?').get(ghost.id);
    expect(ghostStill).toBeUndefined();
  });

  it('does NOT touch a legitimately short team name with games (Olney 5 chars, not a candidate)', () => {
    const olney = resolveTeam(db, 'Olney');
    const plan = buildPlan(db);
    expect(plan.candidates.find((c) => c.id === olney.id)).toBeUndefined();
  });
});
