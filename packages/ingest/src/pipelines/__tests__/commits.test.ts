// Wave 15 Lane 3 (Han 🧑‍🚀🍔) — pipeline tests for commits ingest.
//
// Covers:
//   * insert + idempotency on (player_name_raw, college)
//   * player_id resolution via normalizePlayerName when HS team matches
//   * high_school_team_id resolution via findTeamByName

import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../../db.js';
import { ingestCommitsPost } from '../commits.js';

let db: Database;
beforeEach(() => {
  db = openDb(':memory:');
  // Seed: one HS team + one player on that team.
  db.prepare(`INSERT INTO teams (id, name, slug, division) VALUES (1, 'Twin Valley', 'twin-valley', 'high-school')`).run();
  db.prepare(`INSERT INTO teams (id, name, slug, division) VALUES (2, 'Downingtown West', 'downingtown-west', 'high-school')`).run();
  db.prepare(
    `INSERT INTO players (id, name, name_normalized, team_id, name_resolution)
     VALUES (1, 'Colin Gallagher', 'colin gallagher', 1, 'full')`,
  ).run();
});

describe('ingestCommitsPost', () => {
  it('inserts rows and resolves both HS team and player when present', () => {
    const r = ingestCommitsPost(db, {
      postId: 'p1',
      postUrl: 'https://x/p1',
      postDate: '2025-09-03',
      commits: [
        {
          playerNameRaw: 'Colin Gallagher',
          highSchool: 'Twin Valley',
          college: 'Marquette',
          division: 'D1',
          position: 'MID',
          announcedDate: '2025-09-03',
        },
        {
          playerNameRaw: 'Timmy Gathercole',
          highSchool: 'Downingtown West',
          college: 'Chestnut Hill',
          division: 'D2',
          position: 'MID',
          announcedDate: '2025-09-03',
        },
      ],
      anomalies: [],
    });
    expect(r.commitsUpserted).toBe(2);
    expect(r.commitsResolvedHs).toBe(2);
    expect(r.commitsResolvedPlayer).toBe(1); // only Colin has a players row

    const colin = db
      .prepare('SELECT * FROM commits WHERE player_name_raw = ?')
      .get('Colin Gallagher') as { player_id: number; high_school_team_id: number; college: string; division: string };
    expect(colin.player_id).toBe(1);
    expect(colin.high_school_team_id).toBe(1);
    expect(colin.college).toBe('Marquette');
    expect(colin.division).toBe('D1');

    const timmy = db
      .prepare('SELECT * FROM commits WHERE player_name_raw = ?')
      .get('Timmy Gathercole') as { player_id: number | null; high_school_team_id: number };
    expect(timmy.player_id).toBeNull();
    expect(timmy.high_school_team_id).toBe(2);
  });

  it('is idempotent: re-running upserts and never duplicates rows', () => {
    const input = {
      postId: 'p1',
      postUrl: 'https://x/p1',
      postDate: '2025-09-03',
      commits: [
        {
          playerNameRaw: 'Colin Gallagher',
          highSchool: 'Twin Valley',
          college: 'Marquette',
          division: 'D1',
          position: 'MID',
          announcedDate: '2025-09-03',
        },
      ],
      anomalies: [],
    };
    ingestCommitsPost(db, input);
    ingestCommitsPost(db, input);
    const count = db.prepare('SELECT COUNT(*) AS n FROM commits').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('writes anomalies via the shared insertAnomaly helper', () => {
    const r = ingestCommitsPost(db, {
      postId: 'p2',
      postUrl: 'https://x/p2',
      postDate: '2025-09-03',
      commits: [],
      anomalies: [
        { rawLine: 'garbage line', strategyAttempted: 'commits-list', reason: 'no commas' },
      ],
    });
    expect(r.anomaliesAdded).toBe(1);
    const a = db.prepare('SELECT COUNT(*) AS n FROM ingest_anomalies').get() as { n: number };
    expect(a.n).toBe(1);
  });
});
