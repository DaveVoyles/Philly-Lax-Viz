// Wave H8 L1 (Han) — pure-helper test for the compare view's id parser.
// Mirrors the schedule.test.ts smoke pattern: no DOM, just the helper.

import { describe, it, expect } from 'vitest';
import { parseIdsFromHash } from './comparePlayers.js';

describe('parseIdsFromHash', () => {
  it('returns [] when there is no query string', () => {
    expect(parseIdsFromHash('#/compare/players')).toEqual([]);
    expect(parseIdsFromHash('')).toEqual([]);
  });

  it('parses a comma-separated ids list', () => {
    expect(parseIdsFromHash('#/compare/players?ids=12,34,56')).toEqual([12, 34, 56]);
  });

  it('strips non-integer parts silently', () => {
    expect(parseIdsFromHash('#/compare/players?ids=12,abc,34')).toEqual([12, 34]);
  });

  it('handles trailing/leading whitespace and empty parts', () => {
    expect(parseIdsFromHash('#/compare/players?ids= 12 , ,34 ')).toEqual([12, 34]);
  });

  it('works without the leading hash', () => {
    expect(parseIdsFromHash('/compare/players?ids=7,8')).toEqual([7, 8]);
  });
});

describe('compare players view module', () => {
  it('imports without throwing and exports render', async () => {
    const mod = await import('./comparePlayers.js');
    expect(typeof mod.render).toBe('function');
  });
});
