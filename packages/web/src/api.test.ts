import { describe, it, expect, beforeEach } from 'vitest';
import { attachSeason } from './api.js';
import { setSeason, __resetForTests, ALL_SEASONS } from './components/seasonPicker.js';

describe('api.attachSeason — season query threading', () => {
  beforeEach(() => __resetForTests());

  it('returns the URL untouched when no season is selected', () => {
    setSeason(null, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams');
    expect(attachSeason('/api/games?limit=10')).toBe('/api/games?limit=10');
  });

  it('appends ?season= to season-aware endpoints', () => {
    setSeason(2025, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=2025');
    expect(attachSeason('/api/games?limit=10')).toBe('/api/games?limit=10&season=2025');
    expect(attachSeason('/api/leaders/players?metric=points')).toBe(
      '/api/leaders/players?metric=points&season=2025',
    );
  });

  it('encodes "all" verbatim', () => {
    setSeason(ALL_SEASONS, { persist: false });
    expect(attachSeason('/api/teams')).toBe('/api/teams?season=all');
  });

  it('skips /seasons and /health endpoints', () => {
    setSeason(2024, { persist: false });
    expect(attachSeason('/api/seasons')).toBe('/api/seasons');
    expect(attachSeason('/api/health')).toBe('/api/health');
  });

  it('does not duplicate an explicit season param', () => {
    setSeason(2025, { persist: false });
    expect(attachSeason('/api/teams?season=2024')).toBe('/api/teams?season=2024');
  });
});
