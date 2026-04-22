import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { normalizeTeamName, slugifyTeamName, resolveTeam } from '../teamResolver.js';

describe('normalizeTeamName', () => {
  it('lowercases, strips HS/High School suffix, collapses whitespace', () => {
    expect(normalizeTeamName('Spring-Ford')).toBe('spring-ford');
    expect(normalizeTeamName('Methacton HS')).toBe('methacton');
    expect(normalizeTeamName('Easton High School')).toBe('easton');
    expect(normalizeTeamName('Garnet  Valley   ')).toBe('garnet valley');
    expect(normalizeTeamName("St. Joseph's Prep")).toBe("st. joseph's prep");
  });
  it('normalizes curly quotes and en-dashes', () => {
    expect(normalizeTeamName('St. Joe\u2019s')).toBe("st. joe's");
    expect(normalizeTeamName('A \u2013 B')).toBe('a - b');
  });
  it('strips trailing punctuation', () => {
    expect(normalizeTeamName('Easton:')).toBe('easton');
    expect(normalizeTeamName('Boyertown.')).toBe('boyertown');
  });
});

describe('slugifyTeamName', () => {
  it('replaces non-alpha runs with hyphens', () => {
    expect(slugifyTeamName("st. joseph's prep")).toBe('st-josephs-prep');
    expect(slugifyTeamName('garnet valley')).toBe('garnet-valley');
    expect(slugifyTeamName('bonner & prendie')).toBe('bonner-and-prendie');
  });
});

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

describe('resolveTeam', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('inserts a new team on first call and returns existing on second', () => {
    const a = resolveTeam(db, 'Spring-Ford');
    const b = resolveTeam(db, 'Spring-Ford');
    expect(a.id).toBe(b.id);
    expect(a.slug).toBe('spring-ford');
    const count = db.prepare('SELECT COUNT(*) as c FROM teams').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('matches via normalization when display variants differ', () => {
    const a = resolveTeam(db, 'Methacton HS');
    const b = resolveTeam(db, 'methacton');
    expect(a.id).toBe(b.id);
  });

  it('uses team_aliases table for explicit alias mapping', () => {
    const t = resolveTeam(db, 'Perkiomen Valley');
    db.prepare('INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, ?)').run('pv', t.id, 'manual');
    const r = resolveTeam(db, 'PV');
    expect(r.id).toBe(t.id);
  });

  it('avoids slug collisions with a numeric suffix', () => {
    const a = resolveTeam(db, 'East');
    // Force second team to want the same slug
    db.prepare('UPDATE teams SET name = ? WHERE id = ?').run('East 2', a.id);
    const b = resolveTeam(db, 'east');
    expect(b.id).not.toBe(a.id);
    expect(b.slug.startsWith('east')).toBe(true);
  });

  it('throws on empty name', () => {
    expect(() => resolveTeam(db, '   ')).toThrow();
  });
});
