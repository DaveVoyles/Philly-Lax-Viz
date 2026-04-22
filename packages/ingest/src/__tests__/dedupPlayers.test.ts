import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import {
  buildPlan,
  applyPlan,
  levenshtein,
  normalizeForFuzzy,
  findDuplicateCandidates,
  mergePlayers,
  pickKeepFromCandidate,
} from '../scripts/dedupPlayers.js';

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

// ════════════════════════════════════════════════════════════════════════════
// Wave 12 — fuzzy / Levenshtein dedup (findDuplicateCandidates + mergePlayers)
// ════════════════════════════════════════════════════════════════════════════

describe('levenshtein', () => {
  it('returns 0 for equal strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', '')).toBe(0);
  });
  it('counts substitutions, insertions, deletions', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('flaw', 'lawn')).toBe(2);
    expect(levenshtein('colin', 'collin')).toBe(1);
    expect(levenshtein('yusef', 'yusuf')).toBe(1);
    expect(levenshtein('pierce merill', 'peirce merrill')).toBe(3);
  });
});

describe('normalizeForFuzzy', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeForFuzzy("O'Connor,  Jack ")).toBe("o'connor jack");
  });
  it('strips jersey numbers and parentheticals', () => {
    expect(normalizeForFuzzy('Jack Smith #12 (Sr)')).toBe('jack smith');
  });
  it('drops position annotations and suffixes', () => {
    expect(normalizeForFuzzy('Jack Smith Goalie')).toBe('jack smith');
    expect(normalizeForFuzzy('Jack Smith Jr')).toBe('jack smith');
  });
  it('strips diacritics', () => {
    expect(normalizeForFuzzy('José García')).toBe('jose garcia');
  });
});

describe('findDuplicateCandidates (Wave 12 fuzzy)', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('flags spelling-variant pairs within the same team', () => {
    // Real-world examples from the task brief.
    insertPlayer(db, 10, 1, 'Pierce Merill', 'pierce merill');
    insertPlayer(db, 11, 1, 'Peirce Merrill', 'peirce merrill');
    insertPlayer(db, 12, 1, 'Yusef Abbas', 'yusef abbas');
    insertPlayer(db, 13, 1, 'Yusuf Abbas', 'yusuf abbas');
    insertPlayer(db, 14, 1, 'Colin Ward', 'colin ward');
    insertPlayer(db, 15, 1, 'Collin Ward', 'collin ward');
    insertStat(db, 200, 100, 10, 1);
    insertStat(db, 201, 101, 11, 1);
    insertStat(db, 202, 100, 12, 1);
    insertStat(db, 203, 100, 14, 1);
    insertStat(db, 204, 101, 15, 1);

    const cands = findDuplicateCandidates(db);
    // All three pairs should be detected (Yusef/Yusuf=1, Colin/Collin=1 are
    // high; Pierce/Peirce Merill/Merrill is dist=3 so caught by medium-conf
    // first+last-initial heuristic).
    const pairs = cands.map((c) => [c.leftId, c.rightId].sort().join('-'));
    expect(pairs).toContain('12-13'); // Yusef/Yusuf
    expect(pairs).toContain('14-15'); // Colin/Collin
    expect(pairs).toContain('10-11'); // Pierce/Peirce
    const colinWard = cands.find((c) => c.leftId === 14 && c.rightId === 15)!;
    expect(colinWard.confidence).toBe('high');
    expect(colinWard.editDistance).toBe(1);
  });

  it('does NOT flag short names like Tim/Tom (length floor)', () => {
    insertPlayer(db, 20, 1, 'Tim Smith', 'tim smith');
    insertPlayer(db, 21, 1, 'Tom Smith', 'tom smith');
    // Two distinct first names — also exclude high-conf because the
    // first-name length is < 4 so the medium heuristic skips too.
    const cands = findDuplicateCandidates(db);
    const pair = cands.find((c) => (c.leftId === 20 && c.rightId === 21) || (c.leftId === 21 && c.rightId === 20));
    expect(pair).toBeUndefined();
  });

  it('does NOT flag duplicates across different teams', () => {
    insertPlayer(db, 30, 1, 'Colin Ward', 'colin ward');
    insertPlayer(db, 31, 2, 'Collin Ward', 'collin ward');
    const cands = findDuplicateCandidates(db);
    expect(cands).toHaveLength(0);
  });

  it('does NOT flag exact-normalize matches (left to legacy buildPlan)', () => {
    insertPlayer(db, 40, 1, 'Jack Smith', 'jack smith');
    // Different DB-level normalized key (extra space), but normalizeForFuzzy
    // collapses it to the same string — so the fuzzy pass must skip it and
    // leave the merge to the legacy buildPlan/applyPlan path.
    insertPlayer(db, 42, 1, 'Jack  Smith', 'jack  smith');
    const cands = findDuplicateCandidates(db);
    const pair = cands.find((c) => c.leftId === 40 && c.rightId === 42);
    expect(pair).toBeUndefined();
  });

  it('respects custom threshold', () => {
    // james→jaymes (dist 1) + connor→conner (dist 1) = total dist 2.
    insertPlayer(db, 50, 1, 'James Connor', 'james connor');
    insertPlayer(db, 51, 1, 'Jaymes Conner', 'jaymes conner');
    // At threshold=1, total dist=2 exceeds the cutoff → falls to medium
    // (firstDist=1, last initials both 'c', first names ≥4 chars).
    const t1 = findDuplicateCandidates(db, { threshold: 1 });
    const pair1 = t1.find((c) => c.leftId === 50 && c.rightId === 51);
    expect(pair1?.confidence).toBe('medium');
    // At threshold=2, the same pair clears the high-confidence cutoff.
    const t2 = findDuplicateCandidates(db, { threshold: 2 });
    const pair2 = t2.find((c) => c.leftId === 50 && c.rightId === 51);
    expect(pair2?.confidence).toBe('high');
  });
});

describe('mergePlayers (Wave 12)', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('reassigns stats, records alias, deletes drop in one transaction', () => {
    insertPlayer(db, 60, 1, 'Colin Ward', 'colin ward');
    insertPlayer(db, 61, 1, 'Collin Ward', 'collin ward');
    insertStat(db, 600, 100, 60, 5);
    insertStat(db, 601, 101, 61, 3);

    const result = mergePlayers(db, 60, 61);
    expect(result.statRowsReassigned).toBe(1);
    expect(result.duplicateStatsDropped).toBe(0);
    expect(playerCount(db)).toBe(1);
    expect(statSum(db, 60)).toBe(8);

    // Alias recorded.
    const alias = db
      .prepare('SELECT alias, source, confidence FROM player_aliases WHERE player_id = ?')
      .get(60) as { alias: string; source: string; confidence: number };
    expect(alias.alias).toBe('Collin Ward');
    expect(alias.source).toBe('auto-dedup-w12');
    expect(alias.confidence).toBe(1.0);
  });

  it('drops per-game collision stats (UNIQUE game_id, player_id)', () => {
    insertPlayer(db, 70, 1, 'Yusef Abbas', 'yusef abbas');
    insertPlayer(db, 71, 1, 'Yusuf Abbas', 'yusuf abbas');
    insertStat(db, 700, 100, 70, 4);
    insertStat(db, 701, 100, 71, 4); // same game → collision

    const result = mergePlayers(db, 70, 71);
    expect(result.duplicateStatsDropped).toBe(1);
    expect(playerCount(db)).toBe(1);
    expect(statSum(db, 70)).toBe(4);
  });

  it('is idempotent — running merge on the same pair twice does not double-create aliases', () => {
    insertPlayer(db, 80, 1, 'Pierce Merill', 'pierce merill');
    insertPlayer(db, 81, 1, 'Peirce Merrill', 'peirce merrill');
    insertStat(db, 800, 100, 81, 2);

    mergePlayers(db, 80, 81);
    // Second call: drop row no longer exists, should be a clean no-op.
    const r2 = mergePlayers(db, 80, 81);
    expect(r2.statRowsReassigned).toBe(0);
    expect(r2.duplicateStatsDropped).toBe(0);

    const aliasCount = (
      db
        .prepare('SELECT COUNT(*) AS c FROM player_aliases WHERE player_id = ?')
        .get(80) as { c: number }
    ).c;
    expect(aliasCount).toBe(1);
  });

  it('repoints aliases from drop to keep when dropped player itself has aliases', () => {
    insertPlayer(db, 90, 1, 'Jack Smith', 'jack smith');
    insertPlayer(db, 91, 1, 'Jak Smith', 'jak smith');
    // Pretend a previous merge attached 'J Smith' alias to id=91.
    db.prepare(
      `INSERT INTO player_aliases (alias, player_id, source, confidence)
       VALUES (?, ?, ?, ?)`,
    ).run('J Smith', 91, 'manual', 1.0);

    mergePlayers(db, 90, 91);
    const aliases = db
      .prepare('SELECT alias FROM player_aliases WHERE player_id = ? ORDER BY alias')
      .all(90) as Array<{ alias: string }>;
    expect(aliases.map((a) => a.alias).sort()).toEqual(['J Smith', 'Jak Smith']);
  });

  it('throws when keepId === dropId', () => {
    insertPlayer(db, 99, 1, 'Solo Player', 'solo player');
    expect(() => mergePlayers(db, 99, 99)).toThrow();
  });
});

describe('pickKeepFromCandidate', () => {
  it('keeps the side with more stats', () => {
    const c = {
      teamId: 1, teamName: 't', leftId: 5, leftName: 'a', leftStatCount: 10,
      rightId: 6, rightName: 'b', rightStatCount: 3,
      editDistance: 1, confidence: 'high' as const,
    };
    expect(pickKeepFromCandidate(c)).toEqual({ keepId: 5, dropId: 6 });
  });
  it('breaks ties with the lower id', () => {
    const c = {
      teamId: 1, teamName: 't', leftId: 9, leftName: 'a', leftStatCount: 4,
      rightId: 4, rightName: 'b', rightStatCount: 4,
      editDistance: 1, confidence: 'high' as const,
    };
    expect(pickKeepFromCandidate(c)).toEqual({ keepId: 4, dropId: 9 });
  });
});
