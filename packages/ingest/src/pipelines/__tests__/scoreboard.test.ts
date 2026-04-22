import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, loadMigrations } from '../../db.js';
import { extractPostDate, dateLabelToIso, isoToMondayOfWeek } from '../postMeta.js';
import { ingestScoreboardPost } from '../scoreboard.js';
import { parseScoreboardPost } from '../../parsers/scoreboardPost.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

describe('extractPostDate', () => {
  it('reads <time class="entry-time">', () => {
    expect(extractPostDate('<time class="entry-time">April 21, 2026</time>')).toBe('2026-04-21');
  });
  it('falls back to Posted M/D/YY', () => {
    expect(extractPostDate('Posted 4/7/26')).toBe('2026-04-07');
  });
  it('returns undefined when nothing found', () => {
    expect(extractPostDate('<p>nothing here</p>')).toBeUndefined();
  });
});

describe('dateLabelToIso', () => {
  it('converts "April 21" using fallback year', () => {
    expect(dateLabelToIso('April 21', '2026-04-22')).toBe('2026-04-21');
  });
  it('respects explicit year in label', () => {
    expect(dateLabelToIso('April 21, 2025', '2026-04-22')).toBe('2025-04-21');
  });
  it('Today → fallback, Yesterday → fallback - 1 day', () => {
    expect(dateLabelToIso('Today', '2026-04-22')).toBe('2026-04-22');
    expect(dateLabelToIso('Yesterday', '2026-04-22')).toBe('2026-04-21');
  });
});

describe('isoToMondayOfWeek', () => {
  it('snaps Tuesday to the prior Monday', () => {
    // 2026-04-21 is a Tuesday → Monday is 2026-04-20
    expect(isoToMondayOfWeek('2026-04-21')).toBe('2026-04-20');
  });
  it('snaps Sunday to the prior Monday', () => {
    // 2026-04-19 is a Sunday → Monday is 2026-04-13
    expect(isoToMondayOfWeek('2026-04-19')).toBe('2026-04-13');
  });
});

describe('ingestScoreboardPost', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it('upserts games and is idempotent when run twice', () => {
    const html = `
      <p>April 21</p>
      <p>Boys</p>
      <p>Spring-Ford 10, Boyertown 5</p>
      <p>Methacton 7, Pope John Paul II 6 (OT)</p>
    `;
    const parsed = parseScoreboardPost(html);
    expect(parsed.games.length).toBe(2);

    const input = {
      postId: 'sb-test',
      postUrl: 'https://example/sb-test',
      postDate: '2026-04-21',
      parsed,
    };
    const r1 = ingestScoreboardPost(db, input);
    expect(r1.gamesUpserted).toBe(2);
    const teams = db.prepare('SELECT COUNT(*) as c FROM teams').get() as { c: number };
    expect(teams.c).toBe(4);
    const games = db.prepare('SELECT COUNT(*) as c FROM games').get() as { c: number };
    expect(games.c).toBe(2);
    const ot = db.prepare(`SELECT ot_periods FROM games WHERE home_score = 7`).get() as { ot_periods: number };
    expect(ot.ot_periods).toBe(1);

    const r2 = ingestScoreboardPost(db, input);
    expect(r2.gamesUpserted).toBe(2);
    const games2 = db.prepare('SELECT COUNT(*) as c FROM games').get() as { c: number };
    expect(games2.c).toBe(2); // still 2, no duplicates
  });

  it('skips postponed lines', () => {
    const html = `<p>April 21</p><p>Boys</p><p>Spring-Ford 0, Boyertown 0, ppd</p>`;
    const parsed = parseScoreboardPost(html);
    const r = ingestScoreboardPost(db, {
      postId: 'p',
      postUrl: 'u',
      postDate: '2026-04-21',
      parsed,
    });
    expect(r.gamesUpserted).toBe(0);
  });
});
