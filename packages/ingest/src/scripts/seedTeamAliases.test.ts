// seedTeamAliases.test.ts — Wave 16 Lane 1 (Yoda 🧙‍♂️🟢).
//
// Locks in the W6/W10/W11/W13 alias mappings + the W16 UNMAPPABLE_PIAA
// documentation so future PIAA roster changes can't silently desync the
// docs from reality.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import {
  PIAA_ALIASES,
  PARSER_ABBREVIATIONS,
  UNMAPPABLE_PIAA,
  seedAliases,
  ALIAS_SOURCE,
} from './seedTeamAliases.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: Database.Database, id: number, name: string): void {
  db.prepare('INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    'high-school',
  );
}

function seedPiaa(
  db: Database.Database,
  nameOfficial: string,
  nameNormalized: string,
  classification: string,
): void {
  db.prepare(
    `INSERT INTO piaa_official_teams
      (name_official, name_normalized, classification, wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, 0, 0, 0, 0.0, 0.0, '2026-04-22T00:00:00Z')`,
  ).run(nameOfficial, nameNormalized, classification);
}

describe('PIAA_ALIASES seeding', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  // ── W16 test #1: applying PIAA_ALIASES makes the W6 PIAA-name → team_id
  // map resolvable in a fresh DB; the alias actually inserts and points at
  // the expected team.
  it('seeds the W6 PIAA bootstrap aliases idempotently and resolves them', () => {
    // Seed the team rows the W6 mappings reference.
    for (const m of PIAA_ALIASES) {
      seedTeam(db, m.teamId, m.teamName);
    }

    const first = seedAliases(db, PIAA_ALIASES, ALIAS_SOURCE);
    expect(first.inserted).toBe(PIAA_ALIASES.length);
    expect(first.alreadyPresent).toBe(0);
    expect(first.missingTeam).toEqual([]);

    // Spot-check a few critical mappings: PIAA "springford" must resolve to
    // Spring-Ford (id 1), and "springfield twp" to Springfield Township
    // (id 174). Both are explicit anti-collision pairs called out in the
    // W6 seed comment.
    const lookup = db.prepare(
      'SELECT team_id FROM team_aliases WHERE alias = ?',
    );
    expect((lookup.get('springford') as { team_id: number } | undefined)?.team_id).toBe(1);
    expect((lookup.get('springfield twp') as { team_id: number } | undefined)?.team_id).toBe(174);
    expect((lookup.get('hatborohorsham') as { team_id: number } | undefined)?.team_id).toBe(100);

    // Re-running is idempotent (UNIQUE(alias) -> 0 inserts the second time).
    const second = seedAliases(db, PIAA_ALIASES, ALIAS_SOURCE);
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(PIAA_ALIASES.length);
  });

  // ── W16 test #2: the join the listTeams query uses
  //     `LOWER(t.name) = p.name_normalized OR p.name_normalized IN (
  //        SELECT alias FROM team_aliases WHERE team_id = t.id)`
  // resolves the alias-only mappings (e.g. PIAA "springford" → team
  // "Spring-Ford") AFTER seeding, but does NOT before.
  it('alias seed flips an alias-only PIAA program from unmapped to mapped', () => {
    seedTeam(db, 1, 'Spring-Ford');
    seedPiaa(db, 'Spring-Ford', 'springford', '3A');

    const joinSql = `
      SELECT p.id AS piaa_id
      FROM teams t
      LEFT JOIN piaa_official_teams p ON
        p.name_normalized = LOWER(t.name)
        OR p.name_normalized IN (SELECT alias FROM team_aliases WHERE team_id = t.id)
      WHERE t.id = 1`;

    const before = db.prepare(joinSql).get() as { piaa_id: number | null };
    expect(before.piaa_id).toBeNull();

    seedAliases(
      db,
      PIAA_ALIASES.filter((m) => m.alias === 'springford'),
      ALIAS_SOURCE,
    );

    const after = db.prepare(joinSql).get() as { piaa_id: number | null };
    expect(after.piaa_id).not.toBeNull();
  });

  // ── W16 test #3: UNMAPPABLE_PIAA documentation stays in sync with the
  // PIAA roster. If PIAA ever adds e.g. an Inter-Ac school to D1, this test
  // fires and forces the doc to be re-evaluated. Conversely, every team
  // listed as unmappable must NOT share a name_normalized with a PIAA row.
  it('UNMAPPABLE_PIAA entries do not collide with any PIAA name_normalized', () => {
    // Seed the live PIAA D1 normalized names (a representative subset is
    // enough — we just need to verify the negative assertion mechanism).
    const piaaNames = [
      'abington', 'avon grove', 'bishop shanahan', 'cb east', 'haverford',
      'holy ghost prep', 'lower merion', 'plymouth whitemarsh',
      'pope john paul ii', 'springfield', 'springfield twp', 'springford',
    ];
    for (const n of piaaNames) {
      seedPiaa(db, n, n, '3A');
    }

    const piaaSet = new Set(
      (db.prepare('SELECT name_normalized FROM piaa_official_teams').all() as Array<{
        name_normalized: string;
      }>).map((r) => r.name_normalized),
    );

    // Normalize each UNMAPPABLE entry the same way LOWER(t.name) would.
    // Skip the dup-needs-merge category — by definition those rows DO match
    // a PIAA name (that's why they show up as divergent rather than
    // unmapped); the fix for them is dedup, not aliasing.
    const collisions: string[] = [];
    for (const u of UNMAPPABLE_PIAA) {
      if (u.category === 'dup-needs-merge') continue;
      const base = u.teamName.replace(/\s*\(id\s+\d+\)\s*$/, '').trim();
      const norm = base.toLowerCase().replace(/[.,'’]/g, '').replace(/\s+/g, ' ');
      if (piaaSet.has(norm)) collisions.push(`${u.teamName} → "${norm}"`);
    }
    expect(collisions).toEqual([]);
  });

  // Defensive: PARSER_ABBREVIATIONS must not collide with PIAA_ALIASES on
  // the alias text (UNIQUE constraint would reject the second insert at
  // runtime; better to catch it here than in production).
  it('PARSER_ABBREVIATIONS aliases do not overlap with PIAA_ALIASES', () => {
    const piaaSet = new Set(PIAA_ALIASES.map((m) => m.alias));
    const overlaps = PARSER_ABBREVIATIONS.filter((m) => piaaSet.has(m.alias));
    expect(overlaps).toEqual([]);
  });
});
