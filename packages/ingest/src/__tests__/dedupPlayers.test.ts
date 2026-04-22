import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import { buildPlan, applyPlan } from '../scripts/dedupPlayers.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  // Two teams to exercise cross-team isolation (A.5 #3).
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    1, 'Team Alpha', 'team-alpha',
  );
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    2, 'Team Bravo', 'team-bravo',
  );
  // One real game per team to attach stats to.
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(100, '2026-04-01', 1, 2, 10, 8, 'post-100', '2026-04-22T00:00:00Z');
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score, source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(101, '2026-04-02', 2, 1, 6, 9, 'post-101', '2026-04-22T00:00:00Z');
  return db;
}

function insertPlayer(
  db: Database.Database,
  id: number,
  teamId: number,
  name: string,
  nameNormalized: string,
  resolution: 'full' | 'partial' = 'full',
) {
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, nameNormalized, teamId, resolution);
}

function insertStat(
  db: Database.Database,
  id: number,
  gameId: number,
  playerId: number,
  goals = 1,
) {
  db.prepare(
    `INSERT INTO player_stats
       (id, game_id, player_id, goals, assists, ground_balls, caused_turnovers,
        saves, fo_won, fo_taken, parser_version, confidence)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'test', 1.0)`,
  ).run(id, gameId, playerId, goals);
}

const playerCount = (db: Database.Database) =>
  (db.prepare('SELECT COUNT(*) AS c FROM players').get() as { c: number }).c;
const statSum = (db: Database.Database, playerId: number) =>
  (db
    .prepare('SELECT COALESCE(SUM(goals), 0) AS g FROM player_stats WHERE player_id = ?')
    .get(playerId) as { g: number }).g;

describe('dedupPlayers script', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  // ── Case 1: same-team merge (Pattern 1 — initial-with vs without period) ─
  it('merges same-team duplicates and reassigns player_stats FK', () => {
    // "H. Moyer" and "H Moyer" — they pre-date the new normalizer so were
    // stored with two different (legacy) name_normalized values.
    insertPlayer(db, 10, 1, 'H. Moyer', 'h. moyer');
    insertPlayer(db, 11, 1, 'H Moyer', 'h moyer');
    insertStat(db, 200, 100, 10, 3); // dup row's stat
    insertStat(db, 201, 101, 11, 2); // canonical's stat (different game)

    const plan = buildPlan(db);
    expect(plan.merges).toHaveLength(1);
    const m = plan.merges[0]!;
    expect(m.reason).toBe('normalize');
    expect(m.normalizedKey).toBe('h moyer');
    // Canonical = longer original name → "H. Moyer" (id=10).
    expect(m.canonicalId).toBe(10);
    expect(m.duplicateIds).toEqual([11]);

    const result = applyPlan(db, plan);
    expect(result.playersDeleted).toBe(1);
    expect(playerCount(db)).toBe(1);
    // FK reassignment: canonical now owns BOTH stat rows (3 + 2 = 5 goals).
    expect(statSum(db, 10)).toBe(5);
    // No orphan stats remain on the dup id.
    const orphanCount = (
      db
        .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
        .get(11) as { c: number }
    ).c;
    expect(orphanCount).toBe(0);
  });

  // ── Case 2: Pattern-7 ambiguity must be SKIPPED, not merged ─────────────
  it('skips Pattern-7 partial when 2+ full-name candidates exist (Mikey/Michael Depetris)', () => {
    insertPlayer(db, 20, 1, 'Mikey Depetris', 'mikey depetris');
    insertPlayer(db, 21, 1, 'Michael Depetris', 'michael depetris');
    insertPlayer(db, 22, 1, 'Depetris', 'depetris', 'partial');

    const plan = buildPlan(db);
    expect(plan.merges).toHaveLength(0);
    const skipped = plan.skippedAmbiguous.find(
      (s) => s.partialId === 22 && s.reason === 'multiple-candidates',
    );
    expect(skipped).toBeDefined();
    expect(skipped!.candidateIds.sort()).toEqual([20, 21]);

    applyPlan(db, plan);
    // All 3 rows survive — partial was preserved, NOT silently merged.
    expect(playerCount(db)).toBe(3);
  });

  // ── Case 3: FK reassignment with per-game collision drops dup stat ──────
  it('drops duplicate per-game stats and keeps canonical when both rows have a stat in the same game', () => {
    // Same-team dupes both with a stat in the same game → UNIQUE
    // (game_id, player_id) collision when redirecting. Dup stat is dropped.
    insertPlayer(db, 30, 1, 'Brody Orr.', 'brody orr.');
    insertPlayer(db, 31, 1, 'Brody Orr', 'brody orr');
    insertStat(db, 300, 100, 30, 4); // canonical
    insertStat(db, 301, 100, 31, 4); // dup — same game → collision

    const plan = buildPlan(db);
    expect(plan.merges).toHaveLength(1);
    const result = applyPlan(db, plan);
    expect(result.duplicateStatsDeleted).toBe(1);
    expect(playerCount(db)).toBe(1);
    // Canonical's stat is preserved unchanged (4 goals).
    expect(statSum(db, 30)).toBe(4);
    // Total stats table now has exactly 1 row.
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM player_stats').get() as { c: number }).c,
    ).toBe(1);
  });

  // ── Case 4: idempotency + cross-team isolation ──────────────────────────
  it('is idempotent and never merges identical names across teams', () => {
    // Cross-team identical names — must NOT merge (A.5 #3).
    insertPlayer(db, 40, 1, 'Alex Sipperly', 'alex sipperly');
    insertPlayer(db, 41, 2, 'Alex Sipperly', 'alex sipperly');
    // One same-team merge to actually do something on first run.
    insertPlayer(db, 42, 1, 'Joey Daciw.', 'joey daciw.');
    insertPlayer(db, 43, 1, 'Joey Daciw', 'joey daciw');
    insertStat(db, 400, 100, 42, 1);
    insertStat(db, 401, 101, 43, 2);

    const plan1 = buildPlan(db);
    expect(plan1.merges).toHaveLength(1);
    expect(plan1.merges[0]!.normalizedKey).toBe('joey daciw');
    const r1 = applyPlan(db, plan1);
    expect(r1.playersDeleted).toBe(1);
    expect(playerCount(db)).toBe(3); // both Sipperlys + canonical Daciw

    // Second run: nothing left to do.
    const plan2 = buildPlan(db);
    expect(plan2.merges).toHaveLength(0);
    const r2 = applyPlan(db, plan2);
    expect(r2.playersDeleted).toBe(0);
    expect(r2.normalizedRowsRefreshed).toBe(0);
    expect(playerCount(db)).toBe(3);

    // Cross-team Sipperlys both still present (intentional).
    const sipperlys = (
      db
        .prepare("SELECT COUNT(*) AS c FROM players WHERE name_normalized = 'alex sipperly'")
        .get() as { c: number }
    ).c;
    expect(sipperlys).toBe(2);

    // FK integrity holds.
    const fk = db.pragma('foreign_key_check') as unknown[];
    expect(fk).toEqual([]);
  });

  // ── Case 5: Pattern-7 happy path — exactly one full-name candidate ──────
  it('merges single-token partial when exactly one full-name candidate exists on the team', () => {
    insertPlayer(db, 50, 1, 'Jared Kennedy', 'jared kennedy');
    insertPlayer(db, 51, 1, 'Kennedy', 'kennedy', 'partial');
    insertStat(db, 500, 100, 51, 2); // partial's stat redirects to full

    const plan = buildPlan(db);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0]!.reason).toBe('pattern7');
    expect(plan.merges[0]!.canonicalId).toBe(50);
    expect(plan.merges[0]!.duplicateIds).toEqual([51]);

    const result = applyPlan(db, plan);
    expect(result.playersDeleted).toBe(1);
    expect(statSum(db, 50)).toBe(2);
    expect(playerCount(db)).toBe(1);
  });
});
