import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../db.js';
import { getPiaaForTeam } from '../queries/piaa.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function insertTeam(db: Database.Database, id: number, name: string) {
  db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)').run(
    id,
    name,
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  );
}

function insertPiaa(
  db: Database.Database,
  nameOfficial: string,
  nameNormalized: string,
  classification: string,
  wins: number,
  losses: number,
  opts: { seed?: number | null; ties?: number; ranking?: number } = {},
) {
  db.prepare(
    `INSERT INTO piaa_official_teams
       (name_official, name_normalized, classification, seed,
        wins, losses, ties, total_points, ranking, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nameOfficial,
    nameNormalized,
    classification,
    opts.seed ?? null,
    wins,
    losses,
    opts.ties ?? 0,
    0,
    opts.ranking ?? 0,
    '2026-04-22T17:24:04Z',
  );
}

describe('getPiaaForTeam', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns null when no PIAA row matches', () => {
    insertTeam(db, 80, 'Harriton');
    expect(getPiaaForTeam(db, 80)).toBeNull();
  });

  it('matches via direct LOWER(name) = name_normalized', () => {
    insertTeam(db, 80, 'Harriton');
    insertPiaa(db, 'Harriton', 'harriton', '2A', 4, 8, { seed: 13 });
    const rec = getPiaaForTeam(db, 80);
    expect(rec).not.toBeNull();
    expect(rec?.wins).toBe(4);
    expect(rec?.losses).toBe(8);
    expect(rec?.seed).toBe(13);
    expect(rec?.classification).toBe('2A');
  });

  it('matches via team_aliases.alias when name does not auto-join', () => {
    insertTeam(db, 37, 'Springfield-Delco');
    insertPiaa(db, 'Springfield (delco)', 'springfield', '3A', 10, 2);
    // No match without alias.
    expect(getPiaaForTeam(db, 37)).toBeNull();
    // Insert alias -> now resolves.
    db.prepare(
      `INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, 'piaa-bootstrap')`,
    ).run('springfield', 37);
    const rec = getPiaaForTeam(db, 37);
    expect(rec?.wins).toBe(10);
    expect(rec?.losses).toBe(2);
  });

  it('returns null for a missing team id', () => {
    expect(getPiaaForTeam(db, 999_999)).toBeNull();
  });

  it('does not cross-pollute teams (alias for one does not feed another)', () => {
    insertTeam(db, 1, 'Spring-Ford');
    insertTeam(db, 2, 'Other Team');
    insertPiaa(db, 'Spring-Ford', 'springford', '3A', 9, 4);
    db.prepare(
      `INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, 'piaa-bootstrap')`,
    ).run('springford', 1);
    expect(getPiaaForTeam(db, 1)?.wins).toBe(9);
    expect(getPiaaForTeam(db, 2)).toBeNull();
  });
});
