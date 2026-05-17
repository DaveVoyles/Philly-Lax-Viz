import { describe, expect, it } from 'vitest';

import { isOutlier } from './applyCorrections.js';

describe('isOutlier', () => {
  it('flags hard-cap goal corrections', () => {
    expect(isOutlier('goals', 16, 3)).toBe(true);
  });

  it('allows in-bounds goal corrections', () => {
    expect(isOutlier('goals', 10, 2)).toBe(false);
  });

  it('flags goal corrections above the max multiplier', () => {
    expect(isOutlier('goals', 12, 2)).toBe(true);
  });

  it('skips multiplier checks when the current value is zero', () => {
    expect(isOutlier('home_score', 5, 0)).toBe(false);
  });

  it('flags saves above the hard cap', () => {
    expect(isOutlier('saves', 41, 10)).toBe(true);
  });

  it('treats unknown fields as non-outliers', () => {
    expect(isOutlier('unknown_field', 5, 3)).toBe(false);
  });
});
