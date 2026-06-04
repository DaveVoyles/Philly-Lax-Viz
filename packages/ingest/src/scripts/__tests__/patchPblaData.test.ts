import { describe, it, expect } from 'vitest';
import { buildGamePattern, escapeRegex } from '../patchPblaData.js';

const baseGame = {
  gameNum: 5,
  date: '2026-05-27',
  time: '7:00p',
  homeTeam: 'Thunder',
  awayTeam: 'Edge',
  homeScore: 14,
  awayScore: 2,
};

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegex('Pups LC')).toBe('Pups LC');
    expect(escapeRegex('St. Joseph')).toBe('St\\. Joseph');
    expect(escapeRegex('More Dudes (B)')).toBe('More Dudes \\(B\\)');
  });

  it('passes plain alphanumeric strings unchanged', () => {
    expect(escapeRegex('Thunder')).toBe('Thunder');
    expect(escapeRegex('Beer Wolves')).toBe('Beer Wolves');
  });
});

describe('buildGamePattern', () => {
  // Canonical single-line format used in pblaData.ts
  const sampleLine =
    "{ gameNum: 5, date: '2026-05-27', time: '7:00p', homeTeam: 'Thunder', awayTeam: 'Edge', homeScore: 0, awayScore: 0, location: 'Rizzo Rink', isPlayoff: false, note: '' }";

  it('matches a 0-0 game entry and captures both score positions', () => {
    const pattern = buildGamePattern(baseGame);
    expect(pattern.test(sampleLine)).toBe(true);
  });

  it('replaces 0-0 scores with actual scores', () => {
    const pattern = buildGamePattern(baseGame);
    const patched = sampleLine.replace(pattern, `$1${baseGame.homeScore}$2${baseGame.awayScore}`);
    expect(patched).toContain('homeScore: 14');
    expect(patched).toContain('awayScore: 2');
  });

  it('does NOT match a game that already has non-zero scores', () => {
    const alreadyScored = sampleLine
      .replace('homeScore: 0', 'homeScore: 14')
      .replace('awayScore: 0', 'awayScore: 2');
    const pattern = buildGamePattern(baseGame);
    expect(pattern.test(alreadyScored)).toBe(false);
  });

  it('tolerates the time field between date and homeTeam', () => {
    // Regression test for the bug fixed in this session:
    // original regex did not account for `time: '7:00p'` between date and homeTeam
    const lineWithTime =
      "{ gameNum: 5, date: '2026-05-27', time: '7:00p', homeTeam: 'Thunder', awayTeam: 'Edge', homeScore: 0, awayScore: 0 }";
    const lineWithoutTime =
      "{ gameNum: 5, date: '2026-05-27', homeTeam: 'Thunder', awayTeam: 'Edge', homeScore: 0, awayScore: 0 }";

    // Create fresh patterns — the /g flag advances lastIndex, so reuse would break
    expect(buildGamePattern(baseGame).test(lineWithTime)).toBe(true);
    expect(buildGamePattern(baseGame).test(lineWithoutTime)).toBe(true);
  });

  it('escapes special characters in team names', () => {
    const game = { ...baseGame, homeTeam: 'St. Joseph', awayTeam: 'Pups LC' };
    const line =
      "{ date: '2026-05-27', time: '7:00p', homeTeam: 'St. Joseph', awayTeam: 'Pups LC', homeScore: 0, awayScore: 0 }";
    const pattern = buildGamePattern(game);
    expect(pattern.test(line)).toBe(true);
  });

  it('does NOT match a different date for the same teams', () => {
    const wrongDate =
      "{ gameNum: 5, date: '2026-06-01', time: '7:00p', homeTeam: 'Thunder', awayTeam: 'Edge', homeScore: 0, awayScore: 0 }";
    const pattern = buildGamePattern(baseGame);
    expect(pattern.test(wrongDate)).toBe(false);
  });

  it('does NOT match swapped home/away teams', () => {
    const swapped =
      "{ gameNum: 5, date: '2026-05-27', time: '7:00p', homeTeam: 'Edge', awayTeam: 'Thunder', homeScore: 0, awayScore: 0 }";
    const pattern = buildGamePattern(baseGame);
    expect(pattern.test(swapped)).toBe(false);
  });
});
