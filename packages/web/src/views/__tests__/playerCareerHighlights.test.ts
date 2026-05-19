import { describe, expect, it } from 'vitest';

import type { PlayerPerGameStat } from '../../api.js';
import { computeCareerHighlights } from '../playerDetail.js';

function makeStat(overrides: Partial<PlayerPerGameStat>): PlayerPerGameStat {
  return {
    id: 1,
    playerId: 99,
    gameId: 500,
    goals: 0,
    assists: 0,
    groundBalls: 0,
    causedTurnovers: 0,
    saves: 0,
    foWon: 0,
    foTaken: 0,
    confidence: 1,
    source: 'summary',
    parserVersion: 'test',
    date: '2026-04-01',
    opponentName: 'Ridley',
    opponentLogoUrl: null,
    opponentId: 12,
    ...overrides,
  };
}

describe('computeCareerHighlights', () => {
  it('computes single-game bests, totals, and hat tricks from per-game stats', () => {
    const highlights = computeCareerHighlights([
      makeStat({ goals: 2, assists: 1, date: '2026-04-01', opponentName: 'Ridley' }),
      makeStat({ id: 2, gameId: 501, goals: 5, assists: 2, date: '2026-04-12', opponentName: 'Lower Merion' }),
      makeStat({ id: 3, gameId: 502, goals: 1, assists: 4, date: '2026-04-18', opponentName: 'Radnor' }),
    ]);

    expect(highlights).not.toBeNull();
    expect(highlights?.bestGoals).toEqual({ value: 5, opponent: 'Lower Merion', date: '2026-04-12' });
    expect(highlights?.bestAssists).toEqual({ value: 4, opponent: 'Radnor', date: '2026-04-18' });
    expect(highlights?.bestPoints).toEqual({ value: 7, opponent: 'Lower Merion', date: '2026-04-12' });
    expect(highlights?.totals).toEqual({
      goals: 8,
      assists: 7,
      points: 15,
      hatTricks: 1,
      games: 3,
    });
  });

  it('returns null when the player has no scoring production', () => {
    expect(computeCareerHighlights([])).toBeNull();
    expect(computeCareerHighlights([makeStat({}), makeStat({ id: 2, gameId: 2, date: '2026-04-02' })])).toBeNull();
  });
});
