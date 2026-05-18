import { describe, expect, it } from 'vitest';

import { openDb } from '../db.js';
import { applyCorrections, isOutlier } from './applyCorrections.js';

describe('isOutlier', () => {
  it('flags hard-cap goal corrections', () => {
    expect(isOutlier('goals', 16, 3)).toBe(true);
  });

  it('allows in-bounds goal corrections', () => {
    expect(isOutlier('goals', 10, 2)).toBe(false);
  });

  it('flags goal corrections above the max multiplier', () => {
    expect(isOutlier('goals', 12, 2)).toBe(true);
  });

  it('skips multiplier checks when the current value is zero', () => {
    expect(isOutlier('home_score', 5, 0)).toBe(false);
  });

  it('flags saves above the hard cap', () => {
    expect(isOutlier('saves', 41, 10)).toBe(true);
  });

  it('flags blank player names as outliers', () => {
    expect(isOutlier('name', '   ', 'Sam Smith')).toBe(true);
  });

  it('flags oversized player names as outliers', () => {
    expect(isOutlier('name', 'x'.repeat(101), 'Sam Smith')).toBe(true);
  });

  it('flags invalid jersey numbers as outliers', () => {
    expect(isOutlier('jersey_number', '100', '12')).toBe(true);
    expect(isOutlier('jersey_number', 'abc', '12')).toBe(true);
  });

  it('allows in-range jersey numbers', () => {
    expect(isOutlier('jersey_number', '42', '12')).toBe(false);
  });

  it('treats unknown fields as non-outliers', () => {
    expect(isOutlier('unknown_field', 5, 3)).toBe(false);
  });
});

describe('applyCorrections', () => {
  it('applies player name and jersey number corrections', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
    db.prepare(
      "INSERT INTO players (id, name, name_normalized, team_id, name_resolution, jersey_number) VALUES (100, 'Sam Smith', 'sam smith', 1, 'full', 12)",
    ).run();
    db.prepare(
      `INSERT INTO community_corrections (submitter_first, submitter_last, submitter_email, entity_type, entity_id, field_name, old_value, new_value)
       VALUES
       ('Test', 'User', 'name@example.com', 'player', 100, 'name', 'Sam Smith', 'Samuel Smith'),
       ('Test', 'User', 'jersey@example.com', 'player', 100, 'jersey_number', '12', '22')`,
    ).run();

    const summary = applyCorrections(db);
    const player = db.prepare('SELECT name, jersey_number FROM players WHERE id = 100').get() as {
      name: string;
      jersey_number: number | null;
    };
    const statuses = db
      .prepare('SELECT field_name, status FROM community_corrections ORDER BY id ASC')
      .all() as Array<{ field_name: string; status: string }>;

    expect(summary).toMatchObject({ approved: 2, outliers: 0, rejected: 0, dryRun: 0 });
    expect(player).toEqual({ name: 'Samuel Smith', jersey_number: 22 });
    expect(statuses).toEqual([
      { field_name: 'name', status: 'approved' },
      { field_name: 'jersey_number', status: 'approved' },
    ]);
    db.close();
  });

  it('flags invalid player corrections as outliers', () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO teams (id, name, slug, division) VALUES (1, 'Haverford', 'haverford', 'high-school')").run();
    db.prepare(
      "INSERT INTO players (id, name, name_normalized, team_id, name_resolution, jersey_number) VALUES (100, 'Sam Smith', 'sam smith', 1, 'full', 12)",
    ).run();
    db.prepare(
      `INSERT INTO community_corrections (submitter_first, submitter_last, submitter_email, entity_type, entity_id, field_name, old_value, new_value)
       VALUES
       ('Test', 'User', 'blank@example.com', 'player', 100, 'name', 'Sam Smith', '   '),
       ('Test', 'User', 'jersey@example.com', 'player', 100, 'jersey_number', '12', '100')`,
    ).run();

    const summary = applyCorrections(db);
    const player = db.prepare('SELECT name, jersey_number FROM players WHERE id = 100').get() as {
      name: string;
      jersey_number: number | null;
    };
    const statuses = db
      .prepare('SELECT field_name, status FROM community_corrections ORDER BY id ASC')
      .all() as Array<{ field_name: string; status: string }>;

    expect(summary).toMatchObject({ approved: 0, outliers: 2, rejected: 0, dryRun: 0 });
    expect(player).toEqual({ name: 'Sam Smith', jersey_number: 12 });
    expect(statuses).toEqual([
      { field_name: 'name', status: 'outlier' },
      { field_name: 'jersey_number', status: 'outlier' },
    ]);
    db.close();
  });
});
