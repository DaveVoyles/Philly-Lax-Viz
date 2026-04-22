// Wave 13 Lane 2 — pipeline-level season tagging tests.

import { describe, it, expect } from 'vitest';
import { openDb } from '../../db.js';
import { ingestScoreboardPost } from '../scoreboard.js';
import { ingestSummariesPost } from '../summaries.js';

function makeScoreboardParsed(): Parameters<typeof ingestScoreboardPost>[1]['parsed'] {
  return {
    games: [
      {
        teamA: 'Alpha',
        teamB: 'Bravo',
        scoreA: 7,
        scoreB: 4,
        otPeriods: 0,
        postponed: false,
        dateLabel: 'April 21',
        sectionLabel: 'Boys High School',
      },
    ],
    anomalies: [],
  };
}

describe('scoreboard pipeline season tagging (W13)', () => {
  it('records games.season from input.season', () => {
    const db = openDb(':memory:');
    ingestScoreboardPost(db, {
      postId: 'p2024',
      postUrl: 'https://phillylacrosse.com/2024/april-21-scoreboard/',
      postDate: '2024-04-21',
      season: 2024,
      parsed: makeScoreboardParsed(),
    });
    const rows = db.prepare('SELECT date, season FROM games').all() as Array<{
      date: string; season: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.season).toBe(2024);
    db.close();
  });

  it('defaults to season=2026 when input.season is omitted (back-compat)', () => {
    const db = openDb(':memory:');
    ingestScoreboardPost(db, {
      postId: 'p',
      postUrl: 'https://phillylacrosse.com/2026/x/',
      postDate: '2026-04-21',
      parsed: makeScoreboardParsed(),
    });
    const row = db.prepare('SELECT season FROM games').get() as { season: number };
    expect(row.season).toBe(2026);
    db.close();
  });
});

describe('summaries pipeline season tagging (W13)', () => {
  it('tags player_stats.season alongside games.season', () => {
    const db = openDb(':memory:');
    const parsed = {
      games: [
        {
          scoreLine: { teamA: 'Alpha', teamB: 'Bravo', scoreA: 9, scoreB: 6, otPeriods: 0 },
          periods: [],
          playerStats: [
            {
              name: 'Aaron Apple',
              isPartialName: false,
              goals: 3,
              assists: 1,
              groundBalls: 0,
              causedTurnovers: 0,
              saves: 0,
              foWon: 0,
              foTaken: 0,
              confidence: 1,
            },
          ],
          playerStatTeamHints: [null],
          rawLines: [],
        },
      ],
      anomalies: [],
    } as unknown as Parameters<typeof ingestSummariesPost>[1]['parsed'];

    ingestSummariesPost(db, {
      postId: 's2025',
      postUrl: 'https://phillylacrosse.com/2025/may-1-summaries/',
      postDate: '2025-05-01',
      season: 2025,
      parsed,
    });
    const game = db.prepare('SELECT season FROM games').get() as { season: number };
    const ps = db.prepare('SELECT season FROM player_stats').get() as { season: number };
    expect(game.season).toBe(2025);
    expect(ps.season).toBe(2025);
    db.close();
  });
});
