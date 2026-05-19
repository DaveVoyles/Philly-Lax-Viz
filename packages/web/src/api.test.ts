import { describe, it, expect, beforeEach } from 'vitest';
import { attachSeason } from './api.js';
import { setSeason, __resetForTests, ALL_SEASONS } from './components/seasonPicker.js';

describe('api.attachSeason - season query threading', () => {
  beforeEach(() => __resetForTests());

  it('defaults to season=2026 when nothing is selected', () => {
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=2026');
    expect(attachSeason('/api/games?limit=10')).toBe('/api/games?limit=10&season=2026');
  });

  it('uses the selected season from seasonPicker state', () => {
    setSeason(2025, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=2025');
    setSeason(ALL_SEASONS, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=all');
  });

  it('skips /seasons and /health endpoints', () => {
    expect(attachSeason('/api/seasons')).toBe('/api/seasons');
    expect(attachSeason('/api/health')).toBe('/api/health');
  });

  it('does not duplicate an explicit season param', () => {
    expect(attachSeason('/api/teams?season=2024')).toBe('/api/teams?season=2024');
  });
});
