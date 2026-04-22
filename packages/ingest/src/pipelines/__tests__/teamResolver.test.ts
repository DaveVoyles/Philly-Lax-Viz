import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { normalizeTeamName, normalizeTeamToken, slugifyTeamName, resolveTeam, findTeamByName } from '../teamResolver.js';

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

describe('normalizeTeamToken', () => {
  it('returns input unchanged when no suffix is present', () => {
    expect(normalizeTeamToken('Spring-Ford')).toBe('Spring-Ford');
    expect(normalizeTeamToken('CB South')).toBe('CB South');
  });
  it('strips "Scorers" suffix', () => {
    expect(normalizeTeamToken('DV Scorers')).toBe('DV');
    expect(normalizeTeamToken('Episcopal Scorer')).toBe('Episcopal');
  });
  it('strips "Scoring" suffix', () => {
    expect(normalizeTeamToken('CBW Scoring')).toBe('CBW');
    expect(normalizeTeamToken('PJP Scoring')).toBe('PJP');
  });
  it('strips "Stats" / "Stat" suffix', () => {
    expect(normalizeTeamToken('Haverford Stats')).toBe('Haverford');
    expect(normalizeTeamToken('Haverford Stat')).toBe('Haverford');
  });
  it('strips "Goals" / "Assists" / "Saves" / "Leaders" / "Notes" suffix', () => {
    expect(normalizeTeamToken('Methacton Goals')).toBe('Methacton');
    expect(normalizeTeamToken('Boyertown Assists')).toBe('Boyertown');
    expect(normalizeTeamToken('La Salle Saves')).toBe('La Salle');
    expect(normalizeTeamToken('Strath Haven Leaders')).toBe('Strath Haven');
    expect(normalizeTeamToken('Garnet Valley Notes')).toBe('Garnet Valley');
  });
  it('strips suffix + trailing colon together', () => {
    expect(normalizeTeamToken('Episcopal Scorers:')).toBe('Episcopal');
    expect(normalizeTeamToken('North Pocono Scorers:')).toBe('North Pocono');
    expect(normalizeTeamToken('Haverford Stats:')).toBe('Haverford');
  });
  it('strips trailing whitespace and colon without suffix', () => {
    expect(normalizeTeamToken('CB South ')).toBe('CB South');
    expect(normalizeTeamToken('CB South:')).toBe('CB South');
    expect(normalizeTeamToken('CB South.')).toBe('CB South');
  });
  it('handles multi-word suffix patterns and idempotency', () => {
    expect(normalizeTeamToken('Spring-Ford Scoring Stats')).toBe('Spring-Ford');
    expect(normalizeTeamToken(normalizeTeamToken('DV Scorers:'))).toBe('DV');
  });
  it('returns empty string for empty / whitespace input', () => {
    expect(normalizeTeamToken('')).toBe('');
    expect(normalizeTeamToken('   ')).toBe('');
  });
  it('does not strip suffix words that are not preceded by whitespace', () => {
    // "Scorpions" should not be misread as "Scor"+"piions" — suffix rule
    // requires \s+ before the suffix word.
    expect(normalizeTeamToken('Scorpions')).toBe('Scorpions');
    expect(normalizeTeamToken('Stats Academy')).toBe('Stats Academy');
  });
  it('handles non-breaking space input', () => {
    expect(normalizeTeamToken('CB\u00A0South\u00A0Scorers:')).toBe('CB South');
  });
});

describe('findTeamByName with suffix tokens', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('resolves "<Team> Scorers:" to the underlying team via alias', () => {
    const team = resolveTeam(db, 'Downingtown East');
    db.prepare('INSERT INTO team_aliases (alias, team_id, source) VALUES (?, ?, ?)').run('de', team.id, 'manual');
    expect(findTeamByName(db, 'DE Scorers')?.id).toBe(team.id);
    expect(findTeamByName(db, 'DE Scorers:')?.id).toBe(team.id);
    expect(findTeamByName(db, 'DE Scoring')?.id).toBe(team.id);
    expect(findTeamByName(db, 'DE Stats:')?.id).toBe(team.id);
  });

  it('resolves "<Team> Scorers:" via exact normalized name match', () => {
    const team = resolveTeam(db, 'Episcopal Academy');
    expect(findTeamByName(db, 'Episcopal Academy Scorers:')?.id).toBe(team.id);
    expect(findTeamByName(db, 'Episcopal Academy Stats')?.id).toBe(team.id);
  });

  it('returns null when token (post-strip) does not match any team', () => {
    resolveTeam(db, 'Spring-Ford');
    expect(findTeamByName(db, 'Unknown Scorers:')).toBeNull();
  });
});

describe('resolveTeam with suffix tokens', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('does not create a duplicate team when the same token arrives with a suffix', () => {
    const a = resolveTeam(db, 'Spring-Ford');
    const b = resolveTeam(db, 'Spring-Ford Scorers:');
    expect(a.id).toBe(b.id);
    const count = db.prepare('SELECT COUNT(*) as c FROM teams').get() as { c: number };
    expect(count.c).toBe(1);
  });
});
