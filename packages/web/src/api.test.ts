import { describe, it, expect, beforeEach } from 'vitest';
import { attachSeason } from './api.js';
import { setSeason, __resetForTests, ALL_SEASONS } from './components/seasonPicker.js';

describe('api.attachSeason — season query threading', () => {
  beforeEach(() => __resetForTests());

  it('always appends season=2026 (picker is locked)', () => {
    // setSeason is a no-op; currentSeason() always returns 2026
    setSeason(null, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=2026');
    expect(attachSeason('/api/games?limit=10')).toBe('/api/games?limit=10&season=2026');
  });

  it('appends season=2026 regardless of setSeason call', () => {
    setSeason(2025, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=2026');
    setSeason(ALL_SEASONS, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=2026');
  });

  it('skips /seasons and /health endpoints', () => {
    expect(attachSeason('/api/seasons')).toBe('/api/seasons');
    expect(attachSeason('/api/health')).toBe('/api/health');
  });

  it('does not duplicate an explicit season param', () => {
    expect(attachSeason('/api/teams?season=2024')).toBe('/api/teams?season=2024');
  });
});
