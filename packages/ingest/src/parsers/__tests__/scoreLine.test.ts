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
});
