// Wave H7 Lane 3 (Leia) — team detail page enhancements.
//
// Vitest for @pll/web runs in the node environment (no jsdom installed in
// this workspace), so we follow the convention from playerDetail.test.ts /
// sources.test.ts and exercise pure helpers directly. The DOM wiring in
// teamDetail render() is a thin shell over these helpers; render is also
// covered for "imports cleanly + insists on a real element" so a stubbed
// regression cannot slip through.

import { describe, it, expect } from 'vitest';
import type { Game } from '@pll/shared';

import { h2hChipHtml, resultBadge } from '../teamDetail.js';
import { extractScoreTrend } from '../../charts/teamScoreTrend.js';

function makeGame(partial: Partial<Game> & { id: number; date: string }): Game {
  return {
    id: partial.id,
    date: partial.date,
    homeTeamId: partial.homeTeamId ?? 1,
    awayTeamId: partial.awayTeamId ?? 2,
    homeScore: partial.homeScore ?? 0,
    awayScore: partial.awayScore ?? 0,
    otPeriods: partial.otPeriods ?? 0,
    postponed: partial.postponed ?? false,
    sourcePostId: partial.sourcePostId ?? 'src',
    recapUrl: partial.recapUrl ?? null,
    parsedAt: partial.parsedAt ?? '2026-04-01T00:00:00Z',
  };
}

describe('resultBadge', () => {
  it('returns ✅ W for a win', () => {
    const b = resultBadge(12, 8, false);
    expect(b.label).toBe('✅ W');
    expect(b.className).toBe('result-w');
    expect(b.aria).toBe('Win');
  });

  it('returns ❌ L for a loss', () => {
    const b = resultBadge(5, 9, false);
    expect(b.label).toBe('❌ L');
    expect(b.className).toBe('result-l');
    expect(b.aria).toBe('Loss');
  });

  it('returns ⚪ T for a tie', () => {
    const b = resultBadge(7, 7, false);
    expect(b.label).toBe('⚪ T');
    expect(b.className).toBe('result-t');
  });

  it('returns — pending for a postponed game', () => {
    const b = resultBadge(0, 0, true);
    expect(b.label).toBe('—');
    expect(b.className).toBe('result-pending');
    expect(b.aria).toBe('Pending');
  });

  it('returns — pending when scores are missing', () => {
    expect(resultBadge(null, 4, false).className).toBe('result-pending');
    expect(resultBadge(4, undefined, false).className).toBe('result-pending');
    expect(resultBadge(Number.NaN, 4, false).className).toBe('result-pending');
  });
});

describe('h2hChipHtml', () => {
  it('builds a lead chip without ties', () => {
    expect(h2hChipHtml(12, 34, 7, 3, 0)).toContain('class="h2h-chip h2h-lead"');
    expect(h2hChipHtml(12, 34, 7, 3, 0)).toContain('>7-3 H2H<');
    expect(h2hChipHtml(12, 34, 7, 3, 0)).toContain('#/h2h?team1=12&team2=34');
  });

  it('builds an even chip with ties', () => {
    expect(h2hChipHtml(4, 5, 2, 2, 1)).toContain('class="h2h-chip h2h-even"');
    expect(h2hChipHtml(4, 5, 2, 2, 1)).toContain('>2-2-1 H2H<');
  });

  it('builds a trailing chip when losses exceed wins', () => {
    expect(h2hChipHtml(1, 9, 1, 4, 0)).toContain('class="h2h-chip h2h-trail"');
  });
});

describe('extractScoreTrend', () => {
  const teamId = 1;

  it('skips postponed games and projects GF/GA from the team perspective', () => {
    const games: Game[] = [
      makeGame({ id: 1, date: '2026-03-15', homeTeamId: 1, awayTeamId: 2, homeScore: 12, awayScore: 8 }),
      makeGame({ id: 2, date: '2026-03-22', homeTeamId: 3, awayTeamId: 1, homeScore: 5, awayScore: 11 }),
      makeGame({ id: 3, date: '2026-03-29', postponed: true, homeScore: 0, awayScore: 0 }),
    ];
    const trend = extractScoreTrend(games, teamId);
    expect(trend).toEqual([
      { date: '2026-03-15', gf: 12, ga: 8 },
      { date: '2026-03-22', gf: 11, ga: 5 },
    ]);
  });

  it('returns empty array when no games are completed', () => {
    const games: Game[] = [
      makeGame({ id: 1, date: '2026-03-15', postponed: true }),
    ];
    expect(extractScoreTrend(games, teamId)).toEqual([]);
  });

  it('sorts chronologically (oldest first) regardless of input order', () => {
    const games: Game[] = [
      makeGame({ id: 9, date: '2026-04-10', homeTeamId: 1, awayTeamId: 2, homeScore: 6, awayScore: 7 }),
      makeGame({ id: 1, date: '2026-03-01', homeTeamId: 1, awayTeamId: 2, homeScore: 9, awayScore: 4 }),
      makeGame({ id: 5, date: '2026-03-20', homeTeamId: 2, awayTeamId: 1, homeScore: 2, awayScore: 10 }),
    ];
    const dates = extractScoreTrend(games, teamId).map((p) => p.date);
    expect(dates).toEqual(['2026-03-01', '2026-03-20', '2026-04-10']);
  });
});

describe('teamDetail view module', () => {
  it('imports cleanly and exports render()', async () => {
    const mod = await import('../teamDetail.js');
    expect(typeof mod.render).toBe('function');
    expect(typeof mod.resultBadge).toBe('function');
  });

  it('render() reaches into the DOM (sanity: it really wants a real element)', async () => {
    const mod = await import('../teamDetail.js');
    expect(() => mod.render(null as unknown as HTMLElement, { id: '1' })).toThrow();
  });
});
