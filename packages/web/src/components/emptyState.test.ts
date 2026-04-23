import { describe, it, expect, beforeEach } from 'vitest';
import { emptyStateMessage } from './emptyState.js';
import { setSeason, __resetForTests, ALL_SEASONS } from './seasonPicker.js';

describe('emptyStateMessage', () => {
  beforeEach(() => __resetForTests());

  it('shows season 2026 since picker is locked', () => {
    // setSeason is a no-op; currentSeason() always returns 2026
    expect(emptyStateMessage({ subject: 'teams' })).toBe('No teams for season 2026 yet.');
    setSeason(null, { persist: false });
    expect(emptyStateMessage({ subject: 'teams' })).toBe('No teams for season 2026 yet.');
  });

  it('shows season 2026 regardless of setSeason call', () => {
    setSeason(2024, { persist: false });
    expect(emptyStateMessage({ subject: 'games' })).toBe('No games for season 2026 yet.');
    setSeason(ALL_SEASONS, { persist: false });
    expect(emptyStateMessage({ subject: 'leaders' })).toBe('No leaders for season 2026 yet.');
  });

  it('respects an explicit override (used by tests / preview)', () => {
    expect(emptyStateMessage({ subject: 'players', season: 2023 })).toBe(
      'No players for season 2023 yet.',
    );
    expect(emptyStateMessage({ subject: 'players', season: null })).toBe('No players yet.');
  });
});
