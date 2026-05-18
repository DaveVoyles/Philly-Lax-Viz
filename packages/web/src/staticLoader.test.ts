import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '@pll/shared';

const games: Game[] = [
  {
    id: 1,
    date: '2026-05-10',
    homeTeamId: 1,
    awayTeamId: 2,
    homeScore: 10,
    awayScore: 8,
    otPeriods: 0,
    postponed: false,
    sourcePostId: 'post-1',
    recapUrl: null,
    parsedAt: '2026-05-10T12:00:00Z',
  },
  {
    id: 2,
    date: '2026-05-15',
    homeTeamId: 2,
    awayTeamId: 3,
    homeScore: 11,
    awayScore: 7,
    otPeriods: 0,
    postponed: false,
    sourcePostId: 'post-2',
    recapUrl: null,
    parsedAt: '2026-05-15T12:00:00Z',
  },
  {
    id: 3,
    date: '2026-05-18',
    homeTeamId: 3,
    awayTeamId: 1,
    homeScore: 9,
    awayScore: 10,
    otPeriods: 0,
    postponed: false,
    sourcePostId: 'post-3',
    recapUrl: null,
    parsedAt: '2026-05-18T12:00:00Z',
  },
];

describe('staticFetch /api/games', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_STATIC_MODE', 'true');
    vi.stubEnv('BASE_URL', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(games), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('filters games by date range in static mode', async () => {
    const { staticFetch } = await import('./staticLoader.js');
    const result = await staticFetch<Game[]>('/api/games?from=2026-05-11&to=2026-05-18');
    expect(result.map((game) => game.id)).toEqual([3, 2]);
  });
});
