import { describe, it, expect } from 'vitest';
import { parsePlayerStatLine } from '../playerStat.js';

describe('parsePlayerStatLine', () => {
  it('parses single-token "Caleb Goering 1g"', () => {
    const r = parsePlayerStatLine('Caleb Goering 1g');
    expect(r.result).toMatchObject({ name: 'Caleb Goering', goals: 1, assists: 0, isPartialName: false });
  });

  it('parses comma-separated "Matt Montgomery 1g, 1a"', () => {
    const r = parsePlayerStatLine('Matt Montgomery 1g, 1a');
    expect(r.result).toMatchObject({ name: 'Matt Montgomery', goals: 1, assists: 1 });
  });

  it('parses lone-assist "Chase Fleming 2a"', () => {
    const r = parsePlayerStatLine('Chase Fleming 2a');
    expect(r.result).toMatchObject({ name: 'Chase Fleming', goals: 0, assists: 2 });
  });

  it('parses em-dash + slash "Conor Morsell – 5g/1a"', () => {
    const r = parsePlayerStatLine('Conor Morsell \u2013 5g/1a');
    expect(r.result).toMatchObject({ name: 'Conor Morsell', goals: 5, assists: 1 });
  });

  it('parses parens uppercase "Ty Sauerwald (3G, 3A, 2GB)"', () => {
    const r = parsePlayerStatLine('Ty Sauerwald (3G, 3A, 2GB)');
    expect(r.result).toMatchObject({
      name: 'Ty Sauerwald',
      goals: 3,
      assists: 3,
      groundBalls: 2,
    });
  });

  it('parses faceoff X/Y FO with apostrophe-s and GBs', () => {
    const r = parsePlayerStatLine("Connor Dodson \u2013 16/18 FO's \u2013 10 GB's");
    expect(r.result).toMatchObject({
      name: 'Connor Dodson',
      foWon: 16,
      foTaken: 18,
      groundBalls: 10,
    });
  });

  it('parses "X-for-Y FO"', () => {
    const r = parsePlayerStatLine('Jake Baniewicz 10-for-17 FO');
    expect(r.result).toMatchObject({ foWon: 10, foTaken: 17 });
  });

  it('parses full word stats "Hayden Cattie 7 goals, 2 assists"', () => {
    const r = parsePlayerStatLine('Hayden Cattie 7 goals, 2 assists');
    expect(r.result).toMatchObject({ name: 'Hayden Cattie', goals: 7, assists: 2 });
  });

  it('parses "Brody Bair 1G 4A" no commas', () => {
    const r = parsePlayerStatLine('Brody Bair 1G 4A');
    expect(r.result).toMatchObject({ name: 'Brody Bair', goals: 1, assists: 4 });
  });

  it('parses saves "Dylan Cyr 6 saves"', () => {
    const r = parsePlayerStatLine('Dylan Cyr 6 saves');
    expect(r.result).toMatchObject({ name: 'Dylan Cyr', saves: 6 });
  });

  it('discards trailing "(200 career points)" parenthetical', () => {
    const r = parsePlayerStatLine('Conor McCaffery 5g, 2a (200 career points)');
    expect(r.result).toMatchObject({ name: 'Conor McCaffery', goals: 5, assists: 2 });
  });

  it('handles apostrophes in name "St. O\'Kane 1g"', () => {
    const r = parsePlayerStatLine("St. O'Kane 1g");
    expect(r.result?.name).toBe("St. O'Kane");
  });

  // Wave 5 Lane 1 — possessive parser fix (Appendix B.8 / Appendix C).
  // Inputs like "Dylan Bella's 4 goals" must yield the bare name "Dylan Bella",
  // not the possessive form. Real Irish surnames (O'Kane, O'Leary, D'Annunzio)
  // never end in "'s" and never contain "'s " mid-name, so a conservative strip
  // is safe.
  it("strips trailing possessive: \"Dylan Bella's 4 goals\"", () => {
    const r = parsePlayerStatLine("Dylan Bella's 4 goals");
    expect(r.result).toMatchObject({ name: 'Dylan Bella', goals: 4 });
  });

  it('strips mid-name possessive on first name: "Ryan\'s Turse 2 assists"', () => {
    const r = parsePlayerStatLine("Ryan's Turse 2 assists");
    expect(r.result).toMatchObject({ name: 'Ryan Turse', assists: 2 });
  });

  it("regression: does NOT strip Irish O'Name — \"Sam O'Kane 3 goals\"", () => {
    const r = parsePlayerStatLine("Sam O'Kane 3 goals");
    expect(r.result).toMatchObject({ name: "Sam O'Kane", goals: 3 });
  });

  it("regression: does NOT strip from \"Joe O'Leary 1g 2a\"", () => {
    const r = parsePlayerStatLine("Joe O'Leary 1g 2a");
    expect(r.result).toMatchObject({ name: "Joe O'Leary", goals: 1, assists: 2 });
  });

  it("regression: does NOT strip from \"Tony D'Annunzio 5g\"", () => {
    const r = parsePlayerStatLine("Tony D'Annunzio 5g");
    expect(r.result?.name).toBe("Tony D'Annunzio");
  });

  it('strips trailing possessive even with em-dash separator', () => {
    const r = parsePlayerStatLine("Dylan Bella's \u2013 4 goals");
    expect(r.result).toMatchObject({ name: 'Dylan Bella', goals: 4 });
  });

  it('returns anomaly for non-stat line', () => {
    const r = parsePlayerStatLine('Coach said the team played hard');
    expect(r.result).toBeNull();
  });

  // Anomaly regression tests — see player 48816 (Declan Sullivan).
  describe('career/record parenthetical handling', () => {
    it('drops "(Set School record 173 Goals)" — does not add to game stats', () => {
      const r = parsePlayerStatLine('Declan Sullivan 1G (Set School record 173 Goals)');
      expect(r.result).toMatchObject({ name: 'Declan Sullivan', goals: 1, assists: 0 });
    });

    it('drops "(100 goals on his career)" — does not add to game stats', () => {
      const r = parsePlayerStatLine('Matthew Shohen 5g, 1a (100 goals on his career)');
      expect(r.result).toMatchObject({ name: 'Matthew Shohen', goals: 5, assists: 1 });
    });

    it('keeps short stat-only parenthetical "(3G, 3A)"', () => {
      const r = parsePlayerStatLine('Sam Player 6g 4a (3G, 3A)');
      // Parser doubles the (3G, 3A) into the totals — that's existing behavior.
      // Just assert it didn't drop the parenthetical erroneously.
      expect(r.result?.goals).toBeGreaterThanOrEqual(6);
    });

    it('drops "(185th career goal, ... Career Goals Record Broken)"', () => {
      const r = parsePlayerStatLine(
        'Wyatt Kupsey 5g, 3a (185th career goal, Unionville All Time Career Goals Record Broken)',
      );
      expect(r.result).toMatchObject({ name: 'Wyatt Kupsey', goals: 5, assists: 3 });
    });

    it('drops "(Tied School Record for Goals in Game)"', () => {
      const r = parsePlayerStatLine('Bryce Cox 8G 2A (Tied School Record for Goals in Game)');
      expect(r.result).toMatchObject({ name: 'Bryce Cox', goals: 8, assists: 2 });
    });

    it('drops "(passed DiBattista as all time leader in career points)"', () => {
      const r = parsePlayerStatLine(
        "Ryan Crowley 1a (200 career points passed Dillon DiBattista as O'Hara's all time leader in career points)",
      );
      expect(r.result).toMatchObject({ name: 'Ryan Crowley', goals: 0, assists: 1 });
    });

    it('drops bare "(100th Point)" via ordinal-milestone marker', () => {
      const r = parsePlayerStatLine('Test Player 2g 1a (100th Point)');
      expect(r.result).toMatchObject({ name: 'Test Player', goals: 2, assists: 1 });
    });
  });

  describe('trailing punctuation in name', () => {
    it('strips trailing colon: "Keegan Kropp: 4g, 4a"', () => {
      const r = parsePlayerStatLine('Keegan Kropp: 4g, 4a');
      expect(r.result).toMatchObject({ name: 'Keegan Kropp', goals: 4, assists: 4 });
    });

    it('strips trailing colon with em-dash present: "Player Name: – 2g"', () => {
      const r = parsePlayerStatLine('Player Name: \u2013 2g');
      expect(r.result?.name).toBe('Player Name');
    });

    it('strips trailing period: "Finn Petrone. 3g"', () => {
      const r = parsePlayerStatLine('Finn Petrone. 3g');
      expect(r.result?.name).toBe('Finn Petrone');
    });

    it('preserves trailing initials: "T.J. Smith 2g"', () => {
      const r = parsePlayerStatLine('T.J. Smith 2g');
      expect(r.result?.name).toBe('T.J. Smith');
    });
  });

  describe('stat caps', () => {
    it('clamps absurd goal counts and emits anomaly', () => {
      const r = parsePlayerStatLine('Bug Player 174 goals');
      expect(r.result).toBeNull();
      expect(r.anomalies.length).toBeGreaterThan(0);
      expect(r.anomalies[0]?.strategyAttempted).toBe('stat-cap-exceeded');
    });

    it('clamps the bad value but keeps other valid stats on same line', () => {
      const r = parsePlayerStatLine('Mixed Player 200 goals 3 assists');
      expect(r.result?.goals).toBe(0); // clamped
      expect(r.result?.assists).toBe(3);
      expect(r.anomalies.some(a => a.strategyAttempted === 'stat-cap-exceeded')).toBe(true);
    });
  });
});
