import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseSeasonValue,
  withSeasonInHash,
  readSeasonFromHash,
  pickInitialSeason,
  setKnownSeasons,
  setSeason,
  currentSeason,
  defaultSeason,
  __resetForTests,
  ALL_SEASONS,
} from './seasonPicker.js';

describe('seasonPicker pure helpers', () => {
  beforeEach(() => __resetForTests());

  it('parseSeasonValue accepts years and "all", rejects junk', () => {
    expect(parseSeasonValue('2025')).toBe(2025);
    expect(parseSeasonValue('all')).toBe(ALL_SEASONS);
    expect(parseSeasonValue('')).toBeNull();
    expect(parseSeasonValue(null)).toBeNull();
    expect(parseSeasonValue('1999')).toBeNull();
    expect(parseSeasonValue('20xx')).toBeNull();
  });

  it('readSeasonFromHash extracts season from a hash query', () => {
    expect(readSeasonFromHash('#/teams?season=2025')).toBe('2025');
    expect(readSeasonFromHash('#/leaders?tab=players&season=all&metric=points')).toBe('all');
    expect(readSeasonFromHash('#/dashboard')).toBeUndefined();
  });

  it('withSeasonInHash sets, replaces, and removes season while preserving other params', () => {
    expect(withSeasonInHash('#/teams', 2025)).toBe('#/teams?season=2025');
    expect(withSeasonInHash('#/leaders?tab=players', 2024)).toBe(
      '#/leaders?tab=players&season=2024',
    );
    expect(withSeasonInHash('#/teams?season=2026', 2024)).toBe('#/teams?season=2024');
    expect(withSeasonInHash('#/teams?season=2026&foo=bar', null)).toBe('#/teams?foo=bar');
    expect(withSeasonInHash('#/teams?season=2026', null)).toBe('#/teams');
    expect(withSeasonInHash('', 2025)).toBe('#/?season=2025');
  });

  it('pickInitialSeason prefers URL > storage > server default', () => {
    expect(pickInitialSeason('2024', '2025', 2026)).toBe(2024);
    expect(pickInitialSeason(undefined, '2025', 2026)).toBe(2025);
    expect(pickInitialSeason(undefined, null, 2026)).toBe(2026);
    expect(pickInitialSeason(undefined, null, null)).toBeNull();
    expect(pickInitialSeason('all', '2025', 2026)).toBe(ALL_SEASONS);
    expect(pickInitialSeason('garbage', '2025', 2026)).toBe(2025);
  });

  it('tracks known seasons and selected season state', () => {
    expect(defaultSeason()).toBe(2026);
    setKnownSeasons([2026, 2025, 2024]);
    expect(defaultSeason()).toBe(2026);
    expect(currentSeason()).toBe(2026);
    setSeason(2025, { persist: false });
    expect(currentSeason()).toBe(2025);
    setSeason(ALL_SEASONS, { persist: false });
    expect(currentSeason()).toBe(ALL_SEASONS);
    setSeason(null, { persist: false });
    expect(currentSeason()).toBeNull();
  });
});
