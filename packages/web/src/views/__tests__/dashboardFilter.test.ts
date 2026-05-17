import { describe, it, expect } from 'vitest';
import type { TeamSeasonRecord } from '../../api.js';
import { teamGameCount } from '../dashboard.js';
import { buildStreakChip } from '../../util/streakChip.js';

function team(partial: Partial<TeamSeasonRecord>): TeamSeasonRecord {
  return {
    id: 1,
    name: 'Team',
    slug: 'team',
    division: 'high-school',
    logoUrl: null,
    primaryColor: null,
    secondaryColor: null,
    nickname: null,
    wins: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    ...partial,
  } as TeamSeasonRecord;
}

function fakeDoc(): Pick<Document, 'createElement'> {
  return {
    createElement: () => ({ className: '', textContent: '', title: '' } as HTMLSpanElement),
  };
}

describe('buildStreakChip', () => {
  it('renders notable win streaks only', () => {
    expect(buildStreakChip(3, fakeDoc())?.textContent).toBe('W3');
    expect(buildStreakChip(1, fakeDoc())).toBeNull();
  });

  it('renders notable loss streaks only', () => {
    expect(buildStreakChip(-2, fakeDoc())?.textContent).toBe('L2');
    expect(buildStreakChip(-1, fakeDoc())).toBeNull();
    expect(buildStreakChip(0, fakeDoc())).toBeNull();
    expect(buildStreakChip(null, fakeDoc())).toBeNull();
  });
});

describe('teamGameCount', () => {
  it('prefers coverage.ourGames when present', () => {
    const t = team({
      wins: 2,
      losses: 1,
      coverage: { ourGames: 7, piaaGames: 10, gap: 3 },
    });
    expect(teamGameCount(t)).toBe(7);
  });

  it('falls back to W+L when coverage is missing', () => {
    const t = team({ wins: 5, losses: 4 });
    expect(teamGameCount(t)).toBe(9);
  });

  it('returns 0 for an empty record', () => {
    expect(teamGameCount(team({}))).toBe(0);
  });

  it('low-game out-of-area teams are below the default threshold of 3', () => {
    const ooa = team({ name: 'Out of Area', coverage: { ourGames: 1, piaaGames: null, gap: null } });
    const local = team({ name: 'Local', coverage: { ourGames: 12, piaaGames: 14, gap: 2 } });
    expect(teamGameCount(ooa)).toBeLessThan(3);
    expect(teamGameCount(local)).toBeGreaterThanOrEqual(3);
  });
});
