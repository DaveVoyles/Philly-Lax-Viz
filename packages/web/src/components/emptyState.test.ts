import { describe, it, expect, beforeEach } from 'vitest';
import { emptyStateMessage } from './emptyState.js';
import { setSeason, __resetForTests, ALL_SEASONS } from './seasonPicker.js';

describe('emptyStateMessage', () => {
  beforeEach(() => __resetForTests());

  it('falls back to a generic message when no season is selected', () => {
    expect(emptyStateMessage({ subject: 'teams' })).toBe('No teams yet.');
  });

  it('mentions the year when a numeric season is active', () => {
    setSeason(2024, { persist: false });
    expect(emptyStateMessage({ subject: 'games' })).toBe('No games for season 2024 yet.');
  });

  it('handles "all seasons" explicitly', () => {
    setSeason(ALL_SEASONS, { persist: false });
    expect(emptyStateMessage({ subject: 'leaders' })).toBe(
      'No leaders found across any season yet.',
    );
  });

  it('respects an explicit override (used by tests / preview)', () => {
    expect(emptyStateMessage({ subject: 'players', season: 2023 })).toBe(
      'No players for season 2023 yet.',
    );
    expect(emptyStateMessage({ subject: 'players', season: null })).toBe('No players yet.');
  });
});
