import { describe, it, expect } from 'vitest';
import { mean, stdev, isOutlier } from '../zscore.js';

describe('zscore helpers', () => {
  it('empty sample → no outlier (and helpers return 0)', () => {
    expect(mean([])).toBe(0);
    expect(stdev([])).toBe(0);
    expect(isOutlier(99, [])).toBe(false);
  });

  it('n=1 → stdev 0, no outlier (sample too small)', () => {
    expect(stdev([5])).toBe(0);
    expect(isOutlier(99, [5])).toBe(false);
  });

  it('n=2 → still skipped (need ≥3 to evaluate)', () => {
    expect(stdev([1, 3])).toBeCloseTo(Math.SQRT2, 10);
    expect(isOutlier(50, [1, 3])).toBe(false);
  });

  it('normal in-range value is not flagged', () => {
    const season = [1, 2, 2, 3, 1, 0, 4, 2, 3, 1];
    expect(isOutlier(3, season)).toBe(false);
    expect(isOutlier(4, season)).toBe(false);
  });

  it('clear outlier above 3σ (and above the floor)', () => {
    const season = [1, 2, 2, 3, 1, 0, 4, 2, 3, 1];
    expect(isOutlier(15, season)).toBe(true);
  });

  it('floor prevents false positives when stdev is tiny', () => {
    // Player with almost all zeros: mean+3σ would be ~1, but the floor
    // (default 8) keeps `goals=1` from being flagged.
    const season = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(isOutlier(1, season)).toBe(false);
    expect(isOutlier(9, season)).toBe(true);
  });
});
