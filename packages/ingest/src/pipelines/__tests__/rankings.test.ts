import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { ingestRankingsPost } from '../rankings.js';
import { parseRankingList } from '../../parsers/rankingList.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

describe('ingestRankingsPost', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('upserts rankings rows; idempotent; week_start = Monday of post date', () => {
    const html = `
      <p>1. Spring-Ford</p>
      <p>2. Boyertown</p>
      <p>3. Methacton</p>
      <p>4. Easton</p>
      <p>5. Garnet Valley</p>
    `;
    const parsed = parseRankingList(html, { rankingSource: 'philly', postUrl: 'u' });
    expect(parsed.results.length).toBe(5);

    const input = {
      postId: 'rk1',
      postUrl: 'u',
      postDate: '2026-04-21', // Tuesday → week_start should be 2026-04-20
      rankingSource: 'philly' as const,
      parsed,
    };
    const r1 = ingestRankingsPost(db, input);
    expect(r1.rankingsUpserted).toBe(5);
    expect(r1.weekStart).toBe('2026-04-20');

    const teams = db.prepare('SELECT COUNT(*) c FROM teams').get() as { c: number };
    expect(teams.c).toBe(5);
    const rows = db.prepare(
      `SELECT rank, ranking_source, week_start FROM rankings ORDER BY rank`,
    ).all() as Array<{ rank: number; ranking_source: string; week_start: string }>;
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.ranking_source).toBe('philly');
    expect(rows[0]!.week_start).toBe('2026-04-20');

    // Re-run.
    const r2 = ingestRankingsPost(db, input);
    expect(r2.rankingsUpserted).toBe(5);
    const after = db.prepare('SELECT COUNT(*) c FROM rankings').get() as { c: number };
    expect(after.c).toBe(5);
  });

  it('keeps philly + pa-state rankings separate for the same week+team', () => {
    const html = `<p>1. Spring-Ford</p>`;
    const parsedA = parseRankingList(html, { rankingSource: 'philly', postUrl: 'u' });
    const parsedB = parseRankingList(html, { rankingSource: 'pa-state', postUrl: 'u' });
    ingestRankingsPost(db, { postId: 'a', postUrl: 'a', postDate: '2026-04-21', rankingSource: 'philly', parsed: parsedA });
    ingestRankingsPost(db, { postId: 'b', postUrl: 'b', postDate: '2026-04-21', rankingSource: 'pa-state', parsed: parsedB });
    const c = (db.prepare('SELECT COUNT(*) c FROM rankings').get() as { c: number }).c;
    expect(c).toBe(2);
  });
});
