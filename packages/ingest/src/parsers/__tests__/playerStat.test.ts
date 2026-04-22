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
});
