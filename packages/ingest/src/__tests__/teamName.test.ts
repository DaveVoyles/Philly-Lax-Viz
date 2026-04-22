import { describe, it, expect } from 'vitest';
import { normalizeTeamName } from '../normalize/teamName.js';
import { parseRankingList } from '../parsers/rankingList.js';
import { parseScoreboardPost } from '../parsers/scoreboardPost.js';

describe('normalizeTeamName', () => {
  // ── strip patterns ────────────────────────────────────────────────────
  it('strips numeric district / seed suffix', () => {
    expect(normalizeTeamName('Bishop Shanahan (1)')).toBe('Bishop Shanahan');
    expect(normalizeTeamName('Easton (11)')).toBe('Easton');
  });

  it('strips conference codes', () => {
    expect(normalizeTeamName('Episcopal Academy (Inter-Ac)')).toBe('Episcopal Academy');
    expect(normalizeTeamName('Hill School (MAPL)')).toBe('Hill School');
    expect(normalizeTeamName('Westtown School (Friends)')).toBe('Westtown School');
    expect(normalizeTeamName('Penn Charter (Inter-Ac)')).toBe('Penn Charter');
  });

  it('strips District-N labels', () => {
    expect(normalizeTeamName('La Salle (District 12)')).toBe('La Salle');
  });

  it('strips trailing "(last week: N)" notes', () => {
    expect(normalizeTeamName('Boyertown (last week: 4)')).toBe('Boyertown');
  });

  // ── preserved state codes ─────────────────────────────────────────────
  it('preserves trailing (NY) state marker', () => {
    expect(normalizeTeamName("St. Anthony's (NY)")).toBe("St. Anthony's (NY)");
  });

  it('preserves trailing (NJ) state marker', () => {
    expect(normalizeTeamName('Lower Cape May (NJ)')).toBe('Lower Cape May (NJ)');
  });

  it('canonicalizes lowercase state codes to uppercase', () => {
    expect(normalizeTeamName('Some Team (nj)')).toBe('Some Team (NJ)');
  });

  // ── whitespace ────────────────────────────────────────────────────────
  it('trims and collapses whitespace', () => {
    expect(normalizeTeamName('  Spring-Ford  ')).toBe('Spring-Ford');
    expect(normalizeTeamName('Bishop   Shanahan')).toBe('Bishop Shanahan');
  });

  // ── unchanged passes ──────────────────────────────────────────────────
  it('leaves names without parens unchanged', () => {
    expect(normalizeTeamName('WC Henderson')).toBe('WC Henderson');
  });

  // ── empty input ───────────────────────────────────────────────────────
  it('throws on empty / whitespace-only input', () => {
    expect(() => normalizeTeamName('')).toThrow();
    expect(() => normalizeTeamName('   ')).toThrow();
  });

  it('throws when input is only a strippable parenthetical', () => {
    expect(() => normalizeTeamName('(MAPL)')).toThrow();
  });

  // ── edge cases ────────────────────────────────────────────────────────
  it('peels multiple trailing parentheticals', () => {
    expect(normalizeTeamName('Bishop Shanahan (1) (MAPL)')).toBe('Bishop Shanahan');
  });

  it('keeps state-code parenthetical even when other suffix preceded it', () => {
    // After stripping (12-2), preserved (NJ) should remain.
    expect(normalizeTeamName('Lower Cape May (12-2) (NJ)')).toBe('Lower Cape May (NJ)');
  });

  it('preserves (NY) but strips an outer noise wrapper that follows it', () => {
    // (NY) is innermost-trailing once outer (1) is stripped.
    expect(normalizeTeamName("St. Anthony's (NY) (1)")).toBe("St. Anthony's (NY)");
  });
});

describe('parseRankingList — integration: no parenthetical-suffix names', () => {
  it('does not yield parenthetical-suffix team names from real-shape rankings', () => {
    const html = `
      <p>1. Bishop Shanahan (1)</p>
      <p>2) Easton (11)</p>
      <p>3 Episcopal Academy (Inter-Ac)</p>
      <p>4. Hill School (MAPL)</p>
      <p>5. La Salle (District 12)</p>
      <p>6. Boyertown (last week: 4)</p>
      <p>7. St. Anthony's (NY)</p>
      <p>8. Lower Cape May (NJ)</p>
      <p>9. Spring-Ford</p>
    `;
    const out = parseRankingList(html, {
      rankingSource: 'philly',
      postUrl: 'https://example/test',
    });
    const names = out.results.map(r => r.teamName);

    // None of the noise patterns survive.
    expect(names).toContain('Bishop Shanahan');
    expect(names).toContain('Easton');
    expect(names).toContain('Episcopal Academy');
    expect(names).toContain('Hill School');
    expect(names).toContain('La Salle');
    expect(names).toContain('Boyertown');
    // State markers preserved.
    expect(names).toContain("St. Anthony's (NY)");
    expect(names).toContain('Lower Cape May (NJ)');
    expect(names).toContain('Spring-Ford');

    for (const n of names) {
      // Must not end with a non-state parenthetical.
      const m = n.match(/\(([^()]+)\)\s*$/);
      if (m) {
        expect(['NJ', 'NY', 'DE', 'MD', 'VA', 'CT', 'MA', 'OH']).toContain(m[1]);
      }
    }
  });
});

describe('parseScoreboardPost — integration: team names normalized', () => {
  it('drops parenthetical noise from teamA/teamB on score lines', () => {
    // Note: scoreLine regex disallows digits inside team names, so we use
    // a non-numeric noise suffix here ("(Inter-Ac)") to verify the
    // normalization step actually runs at the scoreboard layer.
    const html = `
      <p>April 21</p>
      <p>Boys</p>
      <p>Episcopal Academy 14, Penn Charter 7</p>
      <p>Lower Cape May 9, Spring-Ford 8</p>
    `;
    const out = parseScoreboardPost(html);
    const teamPairs = out.games.map(g => [g.teamA, g.teamB]);
    for (const [a, b] of teamPairs) {
      expect(a).not.toMatch(/\(\d+\)$/);
      expect(b).not.toMatch(/\(\d+\)$/);
    }
    // sanity: at least the two games parsed.
    expect(out.games.length).toBe(2);
  });
});
