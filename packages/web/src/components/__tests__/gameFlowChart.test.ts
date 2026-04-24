// RFC 06 — Pure-math unit tests for the game flow chart helpers.
// Render-side tests would need a DOM; this suite covers the cumulative
// math + narrative generation, which is where regressions would silently
// mislead readers. Mirrors the sparkline.test.ts pattern.

import { describe, it, expect } from 'vitest';
import type { GamePeriod } from '@pll/shared';
import {
  buildCumulativeSeries,
  buildNarrative,
  computeMaxPeriod,
} from '../gameFlowChart.js';

const HOME = 1;
const AWAY = 2;

function p(teamId: number, periodNumber: number, goals: number, id = 0): GamePeriod {
  return { id, gameId: 999, teamId, periodNumber, goals };
}

describe('computeMaxPeriod', () => {
  it('returns 4 for empty input (regulation default)', () => {
    expect(computeMaxPeriod([])).toBe(4);
  });

  it('returns 4 when only Q1..Q4 present', () => {
    expect(
      computeMaxPeriod([p(HOME, 1, 2), p(HOME, 2, 3), p(HOME, 3, 1), p(HOME, 4, 4)]),
    ).toBe(4);
  });

  it('returns the OT period when present', () => {
    expect(computeMaxPeriod([p(HOME, 1, 2), p(HOME, 5, 1)])).toBe(5);
    expect(computeMaxPeriod([p(HOME, 6, 1)])).toBe(6);
  });
});

describe('buildCumulativeSeries', () => {
  it('emits maxPeriod + 1 points starting at (0,0)', () => {
    const series = buildCumulativeSeries([], HOME, 4);
    expect(series).toHaveLength(5);
    expect(series[0]).toEqual({ x: 0, goals: 0 });
    for (const pt of series) expect(pt.goals).toBe(0);
  });

  it('produces the canonical [3,2,3,3] -> [0,3,5,8,11] cumulative example', () => {
    const periods: GamePeriod[] = [
      p(HOME, 1, 3),
      p(HOME, 2, 2),
      p(HOME, 3, 3),
      p(HOME, 4, 3),
    ];
    const series = buildCumulativeSeries(periods, HOME, 4);
    expect(series.map((s) => s.goals)).toEqual([0, 3, 5, 8, 11]);
    expect(series.map((s) => s.x)).toEqual([0, 1, 2, 3, 4]);
  });

  it('imputes missing periods as 0 (cumulative line is monotonic & flat across them)', () => {
    const periods: GamePeriod[] = [p(HOME, 1, 2), p(HOME, 4, 5)];
    const series = buildCumulativeSeries(periods, HOME, 4);
    expect(series.map((s) => s.goals)).toEqual([0, 2, 2, 2, 7]);
  });

  it('extends across OT periods', () => {
    const periods: GamePeriod[] = [
      p(HOME, 1, 2),
      p(HOME, 2, 2),
      p(HOME, 3, 2),
      p(HOME, 4, 2),
      p(HOME, 5, 1),
    ];
    const series = buildCumulativeSeries(periods, HOME, 5);
    expect(series).toHaveLength(6);
    expect(series[5]).toEqual({ x: 5, goals: 9 });
  });

  it('only includes the requested team and is monotonically non-decreasing', () => {
    const periods: GamePeriod[] = [
      p(HOME, 1, 4),
      p(AWAY, 1, 7),
      p(HOME, 2, 1),
      p(AWAY, 2, 0),
    ];
    const home = buildCumulativeSeries(periods, HOME, 4);
    const away = buildCumulativeSeries(periods, AWAY, 4);
    expect(home.map((s) => s.goals)).toEqual([0, 4, 5, 5, 5]);
    expect(away.map((s) => s.goals)).toEqual([0, 7, 7, 7, 7]);
    for (let i = 1; i < home.length; i += 1) {
      expect(home[i]!.goals).toBeGreaterThanOrEqual(home[i - 1]!.goals);
      expect(away[i]!.goals).toBeGreaterThanOrEqual(away[i - 1]!.goals);
    }
  });
});

describe('buildNarrative', () => {
  const baseSeries = (totals: number[]) =>
    [{ x: 0, goals: 0 }, ...totals.map((g, i) => ({ x: i + 1, goals: g }))];

  it('reports a clear winner and margin for a blowout', () => {
    const text = buildNarrative({
      homeName: 'Marple Newtown',
      awayName: 'Harriton',
      homeSeries: baseSeries([5, 10, 14, 18]),
      awaySeries: baseSeries([1, 2, 3, 4]),
      maxPeriod: 4,
    });
    expect(text).toContain('Marple Newtown won by 14');
    expect(text).toContain('Largest lead was 14 for Marple Newtown');
  });

  it('marks ties at the final whistle', () => {
    const text = buildNarrative({
      homeName: 'A',
      awayName: 'B',
      homeSeries: baseSeries([2, 4, 6, 8]),
      awaySeries: baseSeries([2, 4, 6, 8]),
      maxPeriod: 4,
    });
    expect(text.toLowerCase()).toContain('tied');
  });

  it("calls out a closing run when one side scores 3+ unanswered in the last period", () => {
    const text = buildNarrative({
      homeName: 'Garnet Valley',
      awayName: 'Avon Grove',
      homeSeries: baseSeries([2, 4, 6, 11]),
      awaySeries: baseSeries([3, 6, 10, 10]),
      maxPeriod: 4,
    });
    expect(text).toContain('Garnet Valley closed on a 5-0 run');
  });

  it('handles OT-extended games gracefully', () => {
    const text = buildNarrative({
      homeName: 'Home',
      awayName: 'Away',
      homeSeries: baseSeries([2, 3, 4, 6, 7]),
      awaySeries: baseSeries([2, 3, 4, 6, 6]),
      maxPeriod: 5,
    });
    expect(text).toContain('Home won by 1');
    expect(text).toContain('OT');
  });

  it('falls back to a neutral summary when no scoring data exists', () => {
    const text = buildNarrative({
      homeName: 'Home',
      awayName: 'Away',
      homeSeries: baseSeries([0, 0, 0, 0]),
      awaySeries: baseSeries([0, 0, 0, 0]),
      maxPeriod: 4,
    });
    expect(text).toContain('tied');
    expect(text.toLowerCase()).toContain('even at every period');
  });
});
