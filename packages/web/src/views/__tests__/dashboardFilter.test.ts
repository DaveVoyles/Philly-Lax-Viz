import { describe, it, expect } from 'vitest';
import type { Game } from '@pll/shared';
import type { TeamSeasonRecord } from '../../api.js';
import { recentGamesWithinDays, teamGameCount } from '../dashboard.js';
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

function game(partial: Partial<Game> & { id: number; date: string }): Game {
  return {
    id: partial.id,
    date: partial.date,
    homeTeamId: partial.homeTeamId ?? 1,
    awayTeamId: partial.awayTeamId ?? 2,
    homeScore: partial.homeScore ?? 0,
    awayScore: partial.awayScore ?? 0,
    otPeriods: partial.otPeriods ?? 0,
    postponed: partial.postponed ?? false,
    sourcePostId: partial.sourcePostId ?? 'post',
    recapUrl: partial.recapUrl ?? null,
    parsedAt: partial.parsedAt ?? '2026-05-01T00:00:00Z',
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

describe('recentGamesWithinDays', () => {
  it('keeps only games inside the requested day window', () => {
    const now = Date.parse('2026-05-18T00:00:00Z');
    const games: Game[] = [
      game({ id: 1, date: '2026-05-10' }),
      game({ id: 2, date: '2026-05-11' }),
      game({ id: 3, date: '2026-05-12' }),
    ];

    expect(recentGamesWithinDays(games, 7, now).map((g) => g.id)).toEqual([2, 3]);
  });
});
