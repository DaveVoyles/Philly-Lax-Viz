import { describe, it, expect } from 'vitest';
import type { TeamSeasonRecord } from '../../api.js';
import { sortTeams, type TeamSort } from './dashboardTeams.js';

function team(partial: Partial<TeamSeasonRecord> & { name: string }): TeamSeasonRecord {
  return {
    id: 1,
    slug: partial.name.toLowerCase(),
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

describe('sortTeams', () => {
  const teams = [
    team({ id: 1, name: 'Alpha', wins: 3, losses: 5 }),
    team({ id: 2, name: 'Bravo', wins: 10, losses: 1 }),
    team({ id: 3, name: 'Charlie', wins: 1, losses: 9 }),
  ];

  it('wins-desc: most wins first (regression test — was previously inverted)', () => {
    const sort: TeamSort = { key: 'wins', dir: 'desc' };
    expect(sortTeams(teams, sort).map((t) => t.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('wins-asc: fewest wins first', () => {
    const sort: TeamSort = { key: 'wins', dir: 'asc' };
    expect(sortTeams(teams, sort).map((t) => t.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('wins tie-break: higher win% ranks first when dir is desc', () => {
    const tied = [
      team({ id: 1, name: 'LowGames', wins: 2, losses: 0 }), // 100%
      team({ id: 2, name: 'HighGames', wins: 2, losses: 8 }), // 20%
    ];
    const sort: TeamSort = { key: 'wins', dir: 'desc' };
    expect(sortTeams(tied, sort).map((t) => t.name)).toEqual(['LowGames', 'HighGames']);
  });

  it('name-asc / name-desc sort alphabetically', () => {
    expect(sortTeams(teams, { key: 'name', dir: 'asc' }).map((t) => t.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(sortTeams(teams, { key: 'name', dir: 'desc' }).map((t) => t.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
  });

  it('gap-asc: smallest coverage gap first, unmapped teams last', () => {
    const withGaps = [
      team({ id: 1, name: 'BigGap', coverage: { ourGames: 5, piaaGames: 10, gap: 5 } }),
      team({ id: 2, name: 'NoGap', coverage: { ourGames: 10, piaaGames: 10, gap: 0 } }),
      team({ id: 3, name: 'Unmapped', coverage: { ourGames: 3, piaaGames: null, gap: null } }),
    ];
    const sort: TeamSort = { key: 'gap', dir: 'asc' };
    expect(sortTeams(withGaps, sort).map((t) => t.name)).toEqual(['NoGap', 'BigGap', 'Unmapped']);
  });
});
