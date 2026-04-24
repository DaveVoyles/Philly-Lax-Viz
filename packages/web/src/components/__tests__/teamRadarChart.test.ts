// RFC 05 — Pure-math unit tests for the team radar chart helpers.
// Render-side tests would need a DOM; this suite covers the percentile
// math, axis derivation, geometry, and narrative — the surfaces where a
// regression would silently mislead readers. Mirrors the gameFlowChart
// test pattern (node env, no jsdom).

import { describe, it, expect } from 'vitest';
import {
  axisCoords,
  buildRadarSummary,
  computeRadarAxes,
  gamesPlayedOf,
  percentileRank,
  polygonPath,
  safeDiv,
  winPctOf,
  type RadarOpponentRef,
  type TeamLike,
} from '../teamRadarChart.js';

function team(
  id: number,
  name: string,
  wins: number,
  losses: number,
  goalsFor: number,
  goalsAgainst: number,
): TeamLike {
  return { id, name, wins, losses, goalsFor, goalsAgainst };
}

describe('safeDiv', () => {
  it('divides normally', () => {
    expect(safeDiv(10, 4)).toBe(2.5);
  });
  it('returns 0 for divide-by-zero', () => {
    expect(safeDiv(10, 0)).toBe(0);
  });
  it('returns 0 for non-finite inputs', () => {
    expect(safeDiv(Number.NaN, 5)).toBe(0);
    expect(safeDiv(5, Number.NaN)).toBe(0);
    expect(safeDiv(Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe('gamesPlayedOf / winPctOf', () => {
  it('sums wins + losses (no ties field on TeamSeasonRecord)', () => {
    expect(gamesPlayedOf(team(1, 'A', 8, 4, 100, 60))).toBe(12);
  });
  it('clamps negatives to 0', () => {
    expect(gamesPlayedOf(team(1, 'A', -1, -1, 0, 0))).toBe(0);
  });
  it('returns 0 winPct for unplayed teams (no NaN)', () => {
    expect(winPctOf(team(1, 'A', 0, 0, 0, 0))).toBe(0);
  });
  it('reports a perfect record as 1.0', () => {
    expect(winPctOf(team(1, 'A', 10, 0, 100, 50))).toBe(1);
  });
});

describe('percentileRank', () => {
  const pop = [1, 2, 3, 4, 5];
  it('returns 0.5 for empty/single-value population (no division by zero)', () => {
    expect(percentileRank(5, [])).toBe(0.5);
    expect(percentileRank(5, [42])).toBe(0.5);
  });
  it('puts the league min near 0 and the league max near 1', () => {
    expect(percentileRank(1, pop)).toBeLessThanOrEqual(0.2);
    expect(percentileRank(5, pop)).toBeGreaterThanOrEqual(0.8);
  });
  it('puts the league median near 0.5', () => {
    expect(percentileRank(3, pop)).toBeCloseTo(0.5, 5);
  });
  it('clamps out-of-population values', () => {
    expect(percentileRank(0, pop)).toBe(0);
    expect(percentileRank(99, pop)).toBe(1);
  });
  it('handles ties symmetrically', () => {
    const ties = [1, 1, 1, 1];
    expect(percentileRank(1, ties)).toBeCloseTo(0.5, 5);
  });
});

describe('computeRadarAxes', () => {
  // Build a tiny league: a top team, a median team, a bottom team.
  const top = team(1, 'Top', 10, 0, 150, 60);
  const mid = team(2, 'Mid', 5, 5, 90, 90);
  const bot = team(3, 'Bot', 0, 10, 40, 140);
  const pop: TeamLike[] = [top, mid, bot];
  const opponents: RadarOpponentRef[] = [
    { opponentId: 2, postponed: false },
    { opponentId: 3, postponed: false },
    { opponentId: 999, postponed: false }, // unknown id — ignored
    { opponentId: 2, postponed: true }, // postponed — ignored
  ];

  it('emits exactly six axes in the locked order', () => {
    const axes = computeRadarAxes(top, pop, opponents);
    expect(axes.map((a) => a.key)).toEqual([
      'winPct',
      'goalsFor',
      'defense',
      'margin',
      'goalsForTotal',
      'sos',
    ]);
  });

  it('places the top team near the league max on offense + defense', () => {
    const axes = computeRadarAxes(top, pop, opponents);
    const winPct = axes.find((a) => a.key === 'winPct')!;
    const defense = axes.find((a) => a.key === 'defense')!;
    const margin = axes.find((a) => a.key === 'margin')!;
    expect(winPct.percentile).toBeGreaterThanOrEqual(0.8);
    expect(defense.percentile).toBeGreaterThanOrEqual(0.8);
    expect(margin.percentile).toBeGreaterThanOrEqual(0.8);
  });

  it('places the bottom team near the league min', () => {
    const axes = computeRadarAxes(bot, pop, opponents);
    const winPct = axes.find((a) => a.key === 'winPct')!;
    const defense = axes.find((a) => a.key === 'defense')!;
    expect(winPct.percentile).toBeLessThanOrEqual(0.2);
    expect(defense.percentile).toBeLessThanOrEqual(0.2);
  });

  it('all percentiles fall in [0, 1]', () => {
    const axes = computeRadarAxes(mid, pop, opponents);
    for (const a of axes) {
      expect(a.percentile).toBeGreaterThanOrEqual(0);
      expect(a.percentile).toBeLessThanOrEqual(1);
    }
  });

  it('formats display strings sensibly', () => {
    const axes = computeRadarAxes(top, pop, opponents);
    expect(axes.find((a) => a.key === 'winPct')!.display).toBe('100%');
    expect(axes.find((a) => a.key === 'goalsFor')!.display).toBe('15.0');
    expect(axes.find((a) => a.key === 'margin')!.display.startsWith('+')).toBe(true);
    expect(axes.find((a) => a.key === 'goalsForTotal')!.display).toBe('150');
  });

  it('survives an empty opponent list (SoS falls back, no NaN)', () => {
    const axes = computeRadarAxes(top, pop, []);
    const sos = axes.find((a) => a.key === 'sos')!;
    expect(Number.isFinite(sos.percentile)).toBe(true);
    expect(sos.percentile).toBeGreaterThanOrEqual(0);
    expect(sos.percentile).toBeLessThanOrEqual(1);
  });
});

describe('axisCoords / polygonPath geometry', () => {
  it('places axis 0 directly above the center (12 oclock)', () => {
    const c = axisCoords(0, 6, 100, 100, 50);
    expect(c.x).toBeCloseTo(100, 5);
    expect(c.y).toBeCloseTo(50, 5);
  });

  it('walks clockwise (axis 1 is to the right of axis 0)', () => {
    const a0 = axisCoords(0, 4, 100, 100, 50);
    const a1 = axisCoords(1, 4, 100, 100, 50);
    expect(a1.x).toBeGreaterThan(a0.x);
  });

  it('returns "" for an empty axis array', () => {
    expect(polygonPath([], 0, 0, 50)).toBe('');
  });

  it('emits a closed path (ends with Z) and starts with M', () => {
    const axes = computeRadarAxes(
      team(1, 'A', 5, 5, 50, 50),
      [team(1, 'A', 5, 5, 50, 50), team(2, 'B', 6, 4, 60, 40)],
      [],
    );
    const d = polygonPath(axes, 100, 100, 80);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    // One vertex per axis + the closing Z token.
    const tokens = d.split(/\s+/);
    expect(tokens.length).toBe(axes.length + 1);
  });

  it('clamps percentiles to [0,1] when computing vertex radius (no NaN d)', () => {
    const axes = [
      { key: 'k', label: 'L', rawValue: 0, display: '0', percentile: -1 },
      { key: 'k2', label: 'L2', rawValue: 0, display: '0', percentile: 2 },
      { key: 'k3', label: 'L3', rawValue: 0, display: '0', percentile: 0.5 },
    ];
    const d = polygonPath(axes, 50, 50, 40);
    expect(d).not.toMatch(/NaN/);
  });
});

describe('buildRadarSummary', () => {
  const axes = computeRadarAxes(
    team(1, 'Council Rock South', 9, 1, 130, 70),
    [
      team(1, 'Council Rock South', 9, 1, 130, 70),
      team(2, 'Mid', 5, 5, 90, 90),
      team(3, 'Bot', 0, 10, 40, 140),
    ],
    [
      { opponentId: 2, postponed: false },
      { opponentId: 3, postponed: false },
    ],
  );

  it('mentions the team name and identifies a strongest + weakest axis', () => {
    const text = buildRadarSummary('Council Rock South', axes, 10, 3);
    expect(text).toContain('Council Rock South');
    expect(text.toLowerCase()).toContain('strongest');
    expect(text.toLowerCase()).toContain('weakest');
    expect(text).toMatch(/\d+th percentile/);
  });

  it('appends a low-sample caveat when below the threshold', () => {
    const text = buildRadarSummary('Brand New Team', axes, 1, 3);
    expect(text.toLowerCase()).toContain('low sample size');
    expect(text).toContain('1 game');
  });

  it('omits the caveat when the team has enough games', () => {
    const text = buildRadarSummary('Council Rock South', axes, 10, 3);
    expect(text.toLowerCase()).not.toContain('low sample size');
  });

  it('falls back gracefully on an empty axis list', () => {
    expect(buildRadarSummary('X', [], 0, 3)).toContain('no league-comparable stats');
  });
});
