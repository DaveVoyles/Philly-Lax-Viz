import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import {
  seedAliases,
  PARSER_ABBREVIATIONS,
  PARSER_ABBREV_SOURCE,
  SKIPPED_AMBIGUOUS,
  type AliasMapping,
} from '../scripts/seedTeamAliases.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    37,
    'Springfield-Delco',
    'springfield-delco',
  );
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    1,
    'Spring-Ford',
    'spring-ford',
  );
  return db;
}

const FIXTURE: AliasMapping[] = [
  { alias: 'springfield', teamId: 37, teamName: 'Springfield-Delco' },
  { alias: 'springford', teamId: 1, teamName: 'Spring-Ford' },
];

describe('seedTeamAliases', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('inserts the requested aliases on first run', () => {
    const result = seedAliases(db, FIXTURE);
    expect(result.inserted).toBe(2);
    expect(result.alreadyPresent).toBe(0);
    expect(result.missingTeam).toEqual([]);

    const rows = db.prepare('SELECT alias, team_id, source FROM team_aliases ORDER BY alias').all();
    expect(rows).toEqual([
      { alias: 'springfield', team_id: 37, source: 'piaa-bootstrap' },
      { alias: 'springford', team_id: 1, source: 'piaa-bootstrap' },
    ]);
  });

  it('is idempotent on re-run (no new rows, no errors)', () => {
    seedAliases(db, FIXTURE);
    const result = seedAliases(db, FIXTURE);
    expect(result.inserted).toBe(0);
    expect(result.alreadyPresent).toBe(2);
    const total = (db.prepare('SELECT COUNT(*) AS n FROM team_aliases').get() as { n: number }).n;
    expect(total).toBe(2);
  });

  it('reports (and skips) mappings whose team_id is missing', () => {
    const result = seedAliases(db, [
      { alias: 'ghost', teamId: 9999, teamName: 'Nowhere' },
      { alias: 'springfield', teamId: 37, teamName: 'Springfield-Delco' },
    ]);
    expect(result.inserted).toBe(1);
    expect(result.missingTeam).toHaveLength(1);
    expect(result.missingTeam[0]?.alias).toBe('ghost');
  });
});

describe('PARSER_ABBREVIATIONS (W10)', () => {
  it('declares at least 20 high-confidence parser-abbrev mappings', () => {
    expect(PARSER_ABBREVIATIONS.length).toBeGreaterThanOrEqual(20);
  });

  it('uses normalized (lowercase, trimmed) alias keys', () => {
    for (const m of PARSER_ABBREVIATIONS) {
      expect(m.alias).toBe(m.alias.toLowerCase());
      expect(m.alias).toBe(m.alias.trim());
      expect(m.alias.length).toBeGreaterThan(0);
      expect(m.teamId).toBeGreaterThan(0);
    }
  });

  it('has no duplicate alias keys within the parser-abbrev set', () => {
    const seen = new Set<string>();
    for (const m of PARSER_ABBREVIATIONS) {
      expect(seen.has(m.alias)).toBe(false);
      seen.add(m.alias);
    }
  });

  it('seeds parser abbreviations into team_aliases under the W10 source tag', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, loadMigrations());
    // Insert minimal teams rows for two parser-abbrev targets.
    db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(3, 'Methacton', 'methacton');
    db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(14, 'Owen J. Roberts', 'owen-j-roberts');
    const subset: AliasMapping[] = [
      { alias: 'mhs', teamId: 3, teamName: 'Methacton' },
      { alias: 'ojr', teamId: 14, teamName: 'Owen J. Roberts' },
    ];
    const result = seedAliases(db, subset, PARSER_ABBREV_SOURCE);
    expect(result.inserted).toBe(2);
    const rows = db
      .prepare("SELECT alias, team_id, source FROM team_aliases ORDER BY alias")
      .all();
    expect(rows).toEqual([
      { alias: 'mhs', team_id: 3, source: PARSER_ABBREV_SOURCE },
      { alias: 'ojr', team_id: 14, source: PARSER_ABBREV_SOURCE },
    ]);
    db.close();
  });
});

describe('SKIPPED_AMBIGUOUS (W10)', () => {
  it('documents each skipped token with a non-empty rationale', () => {
    expect(SKIPPED_AMBIGUOUS.length).toBeGreaterThan(0);
    for (const s of SKIPPED_AMBIGUOUS) {
      expect(s.token.length).toBeGreaterThan(0);
      expect(s.rationale.length).toBeGreaterThan(10);
    }
  });
});
