// seedTeamBranding.test.ts -- Wave 16 Lane 3 (R2).
//
// Covers the three things a future maintainer will care about:
//   1. Every entry in TEAM_BRANDING has a valid 7-char hex color.
//   2. seedBranding() actually writes the expected columns.
//   3. seedBranding() is idempotent: a second run reports `unchanged` for
//      every previously-applied row and writes 0 changes.

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import {
  TEAM_BRANDING,
  seedBranding,
  validateBranding,
  type BrandingEntry,
} from './seedTeamBranding.js';

function makeDb() {
  const db = openDb(':memory:');
  // Insert a couple of teams so seedBranding has something to update; use
  // a couple of IDs from TEAM_BRANDING so we exercise the real data.
  const insert = db.prepare(
    'INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, ?)',
  );
  insert.run(31, 'Penn Charter', 'penn-charter', 'high-school');
  insert.run(11, 'Haverford School', 'haverford-school', 'high-school');
  insert.run(34, 'Lower Merion', 'lower-merion', 'high-school');
  return db;
}

describe('seedTeamBranding', () => {
  it('all curated entries have valid 7-char hex colors', () => {
    const bad = validateBranding(TEAM_BRANDING);
    expect(bad).toEqual([]);
  });

  it('seeds at least 30 teams (lane brief floor)', () => {
    expect(TEAM_BRANDING.length).toBeGreaterThanOrEqual(30);
  });

  it('writes primary_color, secondary_color, nickname for matching teams', () => {
    const db = makeDb();
    const subset: BrandingEntry[] = TEAM_BRANDING.filter((e) =>
      [11, 31, 34].includes(e.teamId),
    );
    const result = seedBranding(db, subset);
    expect(result.updated).toBe(3);
    expect(result.unchanged).toBe(0);
    expect(result.missingTeam).toEqual([]);
    expect(result.invalidColor).toEqual([]);

    const row = db
      .prepare(
        'SELECT primary_color, secondary_color, nickname FROM teams WHERE id = 31',
      )
      .get() as { primary_color: string; secondary_color: string; nickname: string };
    expect(row.primary_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(row.nickname).toBe('Quakers');
    db.close();
  });

  it('is idempotent — second apply with same data yields 0 updates', () => {
    const db = makeDb();
    const subset = TEAM_BRANDING.filter((e) => [11, 31, 34].includes(e.teamId));
    const first = seedBranding(db, subset);
    expect(first.updated).toBe(3);

    const second = seedBranding(db, subset);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);
    expect(second.missingTeam).toEqual([]);
    db.close();
  });

  it('reports missingTeam for entries whose team_id is not present', () => {
    const db = openDb(':memory:'); // no teams inserted
    const subset = TEAM_BRANDING.slice(0, 3);
    const result = seedBranding(db, subset);
    expect(result.updated).toBe(0);
    expect(result.missingTeam.length).toBe(3);
    db.close();
  });
});
