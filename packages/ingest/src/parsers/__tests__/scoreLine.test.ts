import { describe, it, expect } from 'vitest';
import { parseScoreLine } from '../scoreLine.js';

describe('parseScoreLine', () => {
  it('parses canonical Spring-Ford line', () => {
    const r = parseScoreLine('Spring-Ford 10, Boyertown 5');
    expect(r.result).toEqual({
      teamA: 'Spring-Ford',
      scoreA: 10,
      teamB: 'Boyertown',
      scoreB: 5,
      otPeriods: 0,
      postponed: false,
    });
    expect(r.anomalies).toEqual([]);
  });

  it('parses Parkland 3OT', () => {
    const r = parseScoreLine('Parkland 8, Nazareth 7 (3OT)');
    expect(r.result).toMatchObject({
      teamA: 'Parkland',
      scoreA: 8,
      teamB: 'Nazareth',
      scoreB: 7,
      otPeriods: 3,
    });
  });

  it('parses bare ", OT"', () => {
    const r = parseScoreLine('Perkiomen Valley 9, Owen J. Roberts 8, OT');
    expect(r.result).toMatchObject({ otPeriods: 1, scoreA: 9, scoreB: 8 });
  });

  it('parses (OT) without count as 1 OT period', () => {
    const r = parseScoreLine('Germantown Friends 13, Lawrencevlle School 12, OT');
    expect(r.result?.otPeriods).toBe(1);
  });

  it('parses postponed', () => {
    const r = parseScoreLine('Conwell-Egan at Bonner & Prendie, ppd');
    // "at" lines aren't valid scores — should not parse as score
    expect(r.result).toBeNull();
  });

  it('handles Unicode quotes in team name', () => {
    const r = parseScoreLine("St. Joseph\u2019s Prep 7, Bonner & Prendie 6");
    expect(r.result?.teamA).toBe("St. Joseph's Prep");
  });

  it('rejects non-score lines', () => {
    const r = parseScoreLine('Caleb Goering 1g');
    expect(r.result).toBeNull();
    expect(r.anomalies).toHaveLength(1);
  });

  it('handles trailing period', () => {
    const r = parseScoreLine('Wilson 16, Gov. Mifflin 4.');
    expect(r.result).toMatchObject({ teamA: 'Wilson', scoreA: 16, scoreB: 4 });
  });

  // ─── Wave 14 Lane 1 (Yoda 🧙‍♂️🟢) ───────────────────────────────────────
  it('rejects 1-2 char single-token "team" names that are sub-headers, not teams', () => {
    // "PR 5, Easton 7" should NOT parse — "PR" is a Pennridge sub-header.
    const r = parseScoreLine('PR 5, Easton 7');
    expect(r.result).toBeNull();
  });

  it('strips trailing state-suffix "(NJ)" from the team name (comma form)', () => {
    const r = parseScoreLine('Notre Dame (NJ) 21, Pennsbury 10');
    expect(r.result?.teamA).toBe('Notre Dame');
    expect(r.result?.teamB).toBe('Pennsbury');
  });

  it('strips trailing state-suffix "(OH)" so initials match works downstream', () => {
    const r = parseScoreLine('Worthington Kilbourne (OH) 12, Springfield 8');
    expect(r.result?.teamA).toBe('Worthington Kilbourne');
  });
});

describe('parseScoreLine — comma-less form', () => {
  it('parses "Twin Valley 17 Daniel Boone 1"', () => {
    const r = parseScoreLine('Twin Valley 17 Daniel Boone 1');
    expect(r.result).toEqual({
      teamA: 'Twin Valley',
      scoreA: 17,
      teamB: 'Daniel Boone',
      scoreB: 1,
      otPeriods: 0,
      postponed: false,
    });
    expect(r.anomalies).toEqual([]);
  });

  it('parses single-word "MHS 5 PHX 3"', () => {
    const r = parseScoreLine('MHS 5 PHX 3');
    expect(r.result).toEqual({
      teamA: 'MHS',
      scoreA: 5,
      teamB: 'PHX',
      scoreB: 3,
      otPeriods: 0,
      postponed: false,
    });
  });

  it('does NOT match a player-stat-shaped line', () => {
    // "Player Name 5 goals 2" — "goals" lower-case, must NOT score-match.
    const r = parseScoreLine('Player Name 5 goals 2');
    expect(r.result).toBeNull();
  });

  it('does NOT match a quarter line', () => {
    const r = parseScoreLine('Easton: 6, 3, 3, 2 - 14');
    expect(r.result).toBeNull();
  });

  // Wave 12 Lane 1 (Darth 😈⚡): probe widening
  it('parses comma-less line with state suffix on team A', () => {
    const r = parseScoreLine('Notre Dame (NJ) 21 Pennsbury 10');
    expect(r.result).toMatchObject({
      teamA: 'Notre Dame',
      scoreA: 21,
      teamB: 'Pennsbury',
      scoreB: 10,
    });
  });

  it('parses comma-less line with state suffix on team B', () => {
    const r = parseScoreLine('Pennsbury 12 Notre Dame (NJ) 9');
    expect(r.result).toMatchObject({
      teamA: 'Pennsbury',
      teamB: 'Notre Dame',
      scoreA: 12,
      scoreB: 9,
    });
  });

  it('parses bare trailing " 2OT" suffix without parens', () => {
    const r = parseScoreLine('Avon Grove 9, West Chester East 8 2OT');
    expect(r.result).toMatchObject({
      teamA: 'Avon Grove',
      teamB: 'West Chester East',
      scoreA: 9,
      scoreB: 8,
      otPeriods: 2,
    });
  });

  it('parses bare trailing " OT" suffix without count', () => {
    const r = parseScoreLine('Avon Grove 9, West Chester East 8 OT');
    expect(r.result?.otPeriods).toBe(1);
  });
});

// ─── Wave 15 Lane 1 (Chewy 🐻💪) ─────────────────────────────────────────
describe('parseScoreLine — trailing event-annotation parens', () => {
  it('ignores trailing event-annotation paren on comma form', () => {
    const r = parseScoreLine("Avon Grove 9, Wissahickon 8 (Cole's Goals Benefit)");
    expect(r.result).toMatchObject({
      teamA: 'Avon Grove',
      teamB: 'Wissahickon',
      scoreA: 9,
      scoreB: 8,
      otPeriods: 0,
    });
  });

  it('keeps OT period and ignores event-annotation paren on comma form', () => {
    const r = parseScoreLine('Penn 10, Trinity 7, OT (Senior Day)');
    expect(r.result).toMatchObject({
      teamA: 'Penn',
      teamB: 'Trinity',
      scoreA: 10,
      scoreB: 7,
      otPeriods: 1,
    });
  });

  it('ignores trailing event-annotation paren on no-comma form', () => {
    const r = parseScoreLine('Avon Grove 9 Wissahickon 8 (Memorial Game)');
    expect(r.result).toMatchObject({
      teamA: 'Avon Grove',
      teamB: 'Wissahickon',
      scoreA: 9,
      scoreB: 8,
      otPeriods: 0,
    });
  });

  it('parses no-comma form with bare OT and event-annotation paren', () => {
    const r = parseScoreLine('Penn 10 Trinity 7 OT (Senior Day)');
    expect(r.result).toMatchObject({
      teamA: 'Penn',
      teamB: 'Trinity',
      scoreA: 10,
      scoreB: 7,
      otPeriods: 1,
    });
  });

  it('parses no-comma form with 2OT and event-annotation paren', () => {
    const r = parseScoreLine('Penn 10 Trinity 9 2OT (Alumni Day)');
    expect(r.result).toMatchObject({
      scoreA: 10,
      scoreB: 9,
      otPeriods: 2,
    });
  });

  it('does not absorb event-annotation paren into team name', () => {
    const r = parseScoreLine('Avon Grove 9, Wissahickon 8 (Charity)');
    expect(r.result?.teamB).toBe('Wissahickon');
    expect(r.result?.teamB).not.toMatch(/Charity/);
  });
});
