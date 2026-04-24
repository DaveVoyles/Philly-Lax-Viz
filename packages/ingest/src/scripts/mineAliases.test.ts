// mineAliases.test.ts — RFC 01 phase A unit tests (Yoda 👽✨).

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import {
  extractToken,
  normalizeToken,
  looksLikePlayerName,
  scoreCandidate,
  mineCandidates,
  candidatesToTsv,
  summarize,
} from './mineAliases.js';
import { parseTsv, seedFromCandidates, buildNotes } from './seedAliasesFromMine.js';

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: DatabaseType, id: number, name: string): void {
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    'high-school',
  );
}

function seedGame(
  db: DatabaseType,
  id: number,
  homeId: number,
  awayId: number,
  postId: string,
): void {
  // Derive a unique date per game id so the UNIQUE(date, home, away)
  // constraint doesn't collide when fixtures reuse the same teams.
  const day = String((id % 28) + 1).padStart(2, '0');
  db.prepare(
    `INSERT INTO games (id, date, home_team_id, away_team_id, home_score, away_score,
                        source_post_id, parsed_at)
     VALUES (?, ?, ?, ?, 10, 7, ?, '2026-04-01T00:00:00Z')`,
  ).run(id, `2026-04-${day}`, homeId, awayId, postId);
}

function seedAnomaly(
  db: DatabaseType,
  postId: string,
  rawLine: string,
  reason: string,
  parentGameId: number,
  strategy = 'player-stat-line',
): void {
  db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id, strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-04-01T00:00:00Z')`,
  ).run(postId, `https://example.com/${postId}`, rawLine, parentGameId, strategy, reason);
}

describe('extractToken', () => {
  it('extracts sub-header tokens', () => {
    expect(
      extractToken(
        'player stat dropped — uncertain team: Jimmy Toland 5g 0a [unresolved sub-header: "Bucs"]',
      ),
    ).toBe('Bucs');
  });

  it('extracts team-hint tokens', () => {
    expect(
      extractToken('quarter line teamHint="MT" did not match Perkiomen Valley | Methacton'),
    ).toBe('MT');
  });

  it('returns null for unrelated lines', () => {
    expect(extractToken('player stat dropped — uncertain team: foo')).toBeNull();
  });
});

describe('normalizeToken', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeToken('  Big   Red ')).toBe('big red');
  });
});

describe('looksLikePlayerName', () => {
  it('rejects strings with digits', () => {
    expect(looksLikePlayerName('logan2 bruette')).toBe(true);
  });
  it('rejects 4+ word tokens', () => {
    expect(looksLikePlayerName('Logan Bruette GWG Walkoff')).toBe(true);
  });
  it('accepts short multi-word tokens', () => {
    expect(looksLikePlayerName('Big Red')).toBe(false);
    expect(looksLikePlayerName('Bucs')).toBe(false);
  });
});

describe('scoreCandidate', () => {
  it('hits 0.95 floor at ≥3 distinct posts with purity 1.0', () => {
    expect(scoreCandidate(3, 1.0)).toBe(0.95);
    expect(scoreCandidate(50, 1.0)).toBe(0.95);
  });
  it('hits 0.80 floor at 2 distinct posts with purity 1.0', () => {
    expect(scoreCandidate(2, 1.0)).toBe(0.80);
  });
  it('drops below floor for impure or single-post evidence', () => {
    expect(scoreCandidate(1, 1.0)).toBe(0.5);
    expect(scoreCandidate(5, 0.5)).toBe(0.5);
  });
});

describe('mineCandidates (integration on in-memory DB)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
    // Father Judge plays multiple games; "Bucs" is their nickname so the
    // sub-header token should always co-occur with team_id = 1.
    seedTeam(db, 1, 'Father Judge');
    seedTeam(db, 2, 'La Salle');
    seedTeam(db, 3, 'Roman Catholic');
    seedTeam(db, 4, 'St Joes Prep');

    // 3 distinct posts where Father Judge is one of the sides + "Bucs" anomaly
    seedGame(db, 100, 1, 2, 'post-A');
    seedGame(db, 101, 3, 1, 'post-B');
    seedGame(db, 102, 1, 4, 'post-C');

    // Bucs token appears in 5 stat lines across 3 posts
    seedAnomaly(
      db,
      'post-A',
      'player stat dropped — uncertain team: Jimmy Toland 5g 0a [unresolved sub-header: "Bucs"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      100,
    );
    seedAnomaly(
      db,
      'post-A',
      'player stat dropped — uncertain team: Ryan Warren 2g 0a [unresolved sub-header: "Bucs"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      100,
    );
    seedAnomaly(
      db,
      'post-B',
      'player stat dropped — uncertain team: Bobby Neiss 1g 1a [unresolved sub-header: "Bucs"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      101,
    );
    seedAnomaly(
      db,
      'post-C',
      'player stat dropped — uncertain team: Tyler Maier 0g 3a [unresolved sub-header: "Bucs"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      102,
    );

    // A noisy single-post token that should be rejected
    seedAnomaly(
      db,
      'post-A',
      'player stat dropped — uncertain team: J. Smith 0g 0a [unresolved sub-header: "Mystery"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      100,
    );

    // A player-name shaped token that should be rejected even with frequency
    seedGame(db, 200, 2, 3, 'post-D');
    seedGame(db, 201, 4, 2, 'post-E');
    seedAnomaly(
      db,
      'post-D',
      'quarter line teamHint="Logan Bruette GWG Walkoff" did not match La Salle | Roman Catholic',
      'team hint did not resolve to either side of the score line',
      200,
      'quarter-line',
    );
    seedAnomaly(
      db,
      'post-E',
      'quarter line teamHint="Logan Bruette GWG Walkoff" did not match St Joes Prep | La Salle',
      'team hint did not resolve to either side of the score line',
      201,
      'quarter-line',
    );
  });

  it('promotes "bucs" → Father Judge with confidence 0.95 and rejects co-occurring teams', () => {
    const candidates = mineCandidates(db);
    const bucs = candidates.filter((c) => c.alias === 'bucs');
    // 3 candidate teams (Father Judge from 3 games, La Salle/Roman Catholic/St Joes Prep
    // from 1 each). Father Judge has purity 1.0 with 3 distinct posts → 0.95.
    const fatherJudge = bucs.find((c) => c.teamId === 1);
    expect(fatherJudge).toBeDefined();
    expect(fatherJudge!.confidence).toBe(0.95);
    expect(fatherJudge!.rejected).toBe('');
    expect(fatherJudge!.postIds.size).toBe(3);

    // Other teams are below floor (purity < 1.0, only 1 post each).
    const others = bucs.filter((c) => c.teamId !== 1);
    for (const o of others) {
      expect(o.rejected).toBe('below confidence floor');
    }
  });

  it('rejects the player-name shaped token even when it has 2 posts', () => {
    const candidates = mineCandidates(db);
    const playery = candidates.filter((c) => c.alias.startsWith('logan bruette'));
    expect(playery.length).toBeGreaterThan(0);
    for (const p of playery) {
      expect(p.rejected).toBe('looks like player name');
    }
  });

  it('rejects single-occurrence noise as below confidence floor or ambiguous', () => {
    const candidates = mineCandidates(db);
    const mystery = candidates.filter((c) => c.alias === 'mystery');
    expect(mystery.length).toBeGreaterThan(0);
    for (const m of mystery) {
      // Single-post tokens always trip either the confidence floor (when
      // one side wins on purity) or the ambiguity guard (when both sides
      // tie at purity 1.0). Either way: not auto-seeded.
      expect(['below confidence floor', 'ambiguous between candidate teams']).toContain(m.rejected);
    }
  });

  it('summary counts match', () => {
    const candidates = mineCandidates(db);
    const summary = summarize(candidates);
    expect(summary.acceptedAt95).toBe(1); // bucs → Father Judge
    expect(summary.accepted).toBeGreaterThanOrEqual(1);
  });
});

describe('TSV round-trip + seedFromCandidates', () => {
  it('parseTsv reverses candidatesToTsv and seedFromCandidates writes accepted rows', () => {
    const db = freshDb();
    seedTeam(db, 1, 'Father Judge');
    seedTeam(db, 2, 'La Salle');
    seedTeam(db, 3, 'Roman Catholic');
    seedTeam(db, 4, 'St Joes Prep');
    // Father Judge plays 3 distinct opponents — that's what breaks the
    // home/away ambiguity tie and lets `bucs` resolve uniquely.
    seedGame(db, 100, 1, 2, 'post-A');
    seedGame(db, 101, 1, 3, 'post-B');
    seedGame(db, 102, 1, 4, 'post-C');
    for (const post of ['post-A', 'post-B', 'post-C']) {
      seedAnomaly(
        db,
        post,
        `player stat dropped — uncertain team: Foo 0g 0a [unresolved sub-header: "Bucs"]`,
        'sub-header did not match either game team; likely a score line the parser missed',
        post === 'post-A' ? 100 : post === 'post-B' ? 101 : 102,
      );
    }

    const candidates = mineCandidates(db);
    const tsv = candidatesToTsv(candidates);
    const parsed = parseTsv(tsv);
    expect(parsed.length).toBe(candidates.length);
    expect(parsed[0]?.alias).toBe(candidates[0]?.alias);
    expect(parsed[0]?.confidence).toBeCloseTo(candidates[0]!.confidence, 2);

    // Dry-run reports an insert but does not mutate.
    const dry = seedFromCandidates(db, parsed, { minConfidence: 0.8, apply: false });
    expect(dry.inserted).toBeGreaterThanOrEqual(1);
    const before = (db.prepare('SELECT COUNT(*) AS n FROM team_aliases').get() as { n: number }).n;
    expect(before).toBe(0);

    // Apply actually writes.
    const applied = seedFromCandidates(db, parsed, { minConfidence: 0.8, apply: true });
    expect(applied.inserted).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare('SELECT alias, team_id, source, confidence, notes FROM team_aliases WHERE alias = ?')
      .get('bucs') as
      | { alias: string; team_id: number; source: string; confidence: number; notes: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.team_id).toBe(1);
    expect(row!.source).toBe('anomaly-mined');
    expect(row!.confidence).toBe(0.95);
    expect(row!.notes).toContain('occurrences=');
    expect(row!.notes).toContain('sample=');

    // Re-applying is idempotent (UNIQUE constraint).
    const second = seedFromCandidates(db, parsed, { minConfidence: 0.8, apply: true });
    expect(second.inserted).toBe(0);
  });

  it('manual aliases win — INSERT OR IGNORE leaves existing rows alone', () => {
    const db = freshDb();
    seedTeam(db, 1, 'Father Judge');
    seedTeam(db, 5, 'Some Other Team');
    seedGame(db, 100, 1, 5, 'post-A');
    seedGame(db, 101, 1, 5, 'post-B');
    seedAnomaly(
      db,
      'post-A',
      'player stat dropped — uncertain team: x 0g 0a [unresolved sub-header: "bucs"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      100,
    );
    seedAnomaly(
      db,
      'post-B',
      'player stat dropped — uncertain team: y 0g 0a [unresolved sub-header: "bucs"]',
      'sub-header did not match either game team; likely a score line the parser missed',
      101,
    );

    // Manually claim "bucs" for the wrong team first.
    db.prepare(
      `INSERT INTO team_aliases (alias, team_id, source, confidence) VALUES (?, ?, 'manual', 1.0)`,
    ).run('bucs', 5);

    const candidates = mineCandidates(db);
    // It should now be flagged as already aliased (rejection takes precedence).
    const bucs = candidates.find((c) => c.alias === 'bucs' && c.teamId === 1);
    expect(bucs?.rejected).toBe('already aliased');

    const result = seedFromCandidates(db, parseTsv(candidatesToTsv(candidates)), {
      minConfidence: 0.8,
      apply: true,
    });
    expect(result.inserted).toBe(0);

    const row = db
      .prepare('SELECT team_id, source FROM team_aliases WHERE alias = ?')
      .get('bucs') as { team_id: number; source: string };
    expect(row.team_id).toBe(5);
    expect(row.source).toBe('manual');
  });
});

describe('buildNotes', () => {
  it('includes occurrences, sample post, and raw line', () => {
    const notes = buildNotes({
      alias: 'bucs',
      teamId: 1,
      teamName: 'Father Judge',
      occurrences: 5,
      distinctPosts: 3,
      purity: 1.0,
      confidence: 0.95,
      rejected: '',
      samplePostId: 'post-A',
      sampleRawLine: 'player stat dropped — uncertain team: x [unresolved sub-header: "Bucs"]',
    });
    expect(notes).toContain('occurrences=5');
    expect(notes).toContain('distinct_posts=3');
    expect(notes).toContain('sample_post=post-A');
    expect(notes).toContain('source=anomaly-mined');
  });
});
