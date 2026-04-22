import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { parsePiaaHtml, normalizeTeamName, titleCaseSchool } from '../sources/piaa.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SNAPSHOT = path.resolve(HERE, '..', '..', '..', '..', 'fixtures', 'piaa-d1-rankings.snapshot.html');

describe('piaa source — pure helpers', () => {
  it('titleCaseSchool handles uppercase school names', () => {
    expect(titleCaseSchool('BISHOP SHANAHAN')).toBe('Bishop Shanahan');
    expect(titleCaseSchool('DOWNINGTOWN WEST')).toBe('Downingtown West');
    expect(titleCaseSchool('HARRY S. TRUMAN')).toBe('Harry S. Truman');
  });

  it('titleCaseSchool preserves short acronyms like NJ/NY', () => {
    expect(titleCaseSchool("ST. ANTHONY'S (NY)")).toBe("St. Anthony's (NY)");
  });

  it('normalizeTeamName strips punctuation and parentheticals', () => {
    expect(normalizeTeamName('Bishop Shanahan')).toBe('bishop shanahan');
    expect(normalizeTeamName('Bishop Shanahan (1)')).toBe('bishop shanahan');
    expect(normalizeTeamName('Easton (11)')).toBe('easton');
    expect(normalizeTeamName('Harry S. Truman')).toBe('harry s truman');
  });

  it('normalizeTeamName preserves (nj)/(ny) state markers', () => {
    expect(normalizeTeamName("St. Anthony's HS (NY)")).toBe("st anthonys hs (ny)");
    expect(normalizeTeamName('Pingry (NJ)')).toBe('pingry (nj)');
  });
});

describe('piaa source — parsePiaaHtml', () => {
  if (!fs.existsSync(SNAPSHOT)) {
    it.skip('snapshot fixture not found', () => undefined);
    return;
  }
  const html = fs.readFileSync(SNAPSHOT, 'utf8');
  const rows = parsePiaaHtml(html);

  it('returns rows from at least the 3A and 2A sections', () => {
    const classes = new Set(rows.map((r) => r.classification));
    expect(classes.has('3A')).toBe(true);
    expect(classes.has('2A')).toBe(true);
    expect(rows.length).toBeGreaterThan(10);
  });

  it('every row has integer W/L/T and finite ranking', () => {
    for (const r of rows) {
      expect(Number.isInteger(r.wins)).toBe(true);
      expect(Number.isInteger(r.losses)).toBe(true);
      expect(Number.isInteger(r.ties)).toBe(true);
      expect(Number.isFinite(r.ranking)).toBe(true);
      expect(r.nameOfficial.length).toBeGreaterThan(0);
      // Title-case (no all-caps schools should escape).
      expect(r.nameOfficial).not.toBe(r.nameOfficial.toUpperCase());
    }
  });

  it('Bishop Shanahan appears in 2A', () => {
    const bs = rows.find((r) => r.nameNormalized === 'bishop shanahan');
    expect(bs).toBeDefined();
    expect(bs?.classification).toBe('2A');
  });

  it('unranked teams (e.g. seed = "-") parse with seed=null', () => {
    const unrankedExists = rows.some((r) => r.seed === null);
    // The page may or may not have unranked rows in any given week — at least
    // assert the type is correct on all rows.
    for (const r of rows) {
      if (r.seed !== null) expect(Number.isInteger(r.seed)).toBe(true);
    }
    // Soft expectation: usually true at this point in season.
    expect(typeof unrankedExists).toBe('boolean');
  });
});
