import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMigrations, runMigrations } from '../../db.js';
import {
  classify,
  determineSide,
  reconcile,
  type MaxprepsFetcher,
  type QueueEntry,
} from '../reconcileWithSources.js';

function freshDb(): DatabaseType {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, loadMigrations());
  return db;
}

function seedTeam(db: DatabaseType, id: number, name: string, slug: string): void {
  db.prepare(
    `INSERT INTO teams (id, name, slug, division) VALUES (?, ?, ?, 'high-school')`,
  ).run(id, name, slug);
}

function seedGame(
  db: DatabaseType,
  args: {
    id: number;
    homeId: number;
    awayId: number;
    homeScore: number;
    awayScore: number;
    date?: string;
  },
): void {
  db.prepare(
    `INSERT INTO games
       (id, date, home_team_id, away_team_id, home_score, away_score,
        ot_periods, postponed, source_post_id, recap_url, parsed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, '2026-04-10T00:00:00Z', 2026)`,
  ).run(
    args.id,
    args.date ?? '2026-04-16',
    args.homeId,
    args.awayId,
    args.homeScore,
    args.awayScore,
    `post-${args.id}`,
    `https://example.test/recap/${args.id}`,
  );
}

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    gameId: 446,
    date: '2026-03-21',
    teamId: 45,
    teamName: 'WC Rustin',
    opponentName: 'Haverford High',
    currentScore: 18,
    playerGoalsSum: 36,
    suspectDelta: 18,
    sourcePostUrl: null,
    ...overrides,
  };
}

function fetcherReturning(score: { homeScore: number; awayScore: number }): MaxprepsFetcher {
  return vi.fn(async () => ({ ...score, sourceUrl: 'https://maxpreps.test/g/1' }));
}

function fetcherNull(): MaxprepsFetcher {
  return vi.fn(async () => null);
}

// ─── Pure helpers ────────────────────────────────────────────────────────

describe('determineSide', () => {
  it('returns home / away / null', () => {
    const game = { home_team_id: 1, away_team_id: 2 };
    expect(determineSide(game, 1)).toBe('home');
    expect(determineSide(game, 2)).toBe('away');
    expect(determineSide(game, 3)).toBeNull();
  });
});

describe('classify', () => {
  const entry = makeEntry({ currentScore: 18, playerGoalsSum: 36 });

  it('apply when mp ∈ [pSum, pSum+5]', () => {
    expect(classify(entry, 36).decision).toBe('apply');
    expect(classify(entry, 40).decision).toBe('apply');
    expect(classify(entry, 41).decision).toBe('apply');
  });

  it('reject when mp < pSum', () => {
    expect(classify(entry, 35).decision).toBe('reject:mp_below_player_sum');
  });

  it('reject when mp > pSum + 5', () => {
    expect(classify(entry, 42).decision).toBe('reject:mp_above_ceiling');
  });

  it('reject when fetch failed', () => {
    expect(classify(entry, null).decision).toBe('reject:fetch_failed');
  });

  it('reject when queue invariant violated', () => {
    const bad = makeEntry({ currentScore: 36, playerGoalsSum: 36 });
    expect(classify(bad, 36).decision).toBe('reject:queue_invariant_violated');
  });
});

// ─── Orchestrator ────────────────────────────────────────────────────────

describe('reconcile()', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = freshDb();
    seedTeam(db, 45, 'WC Rustin', 'wc-rustin');
    seedTeam(db, 99, 'Haverford High', 'haverford');
    // game 446: rustin (away in this fixture) currently 18; mp says 36
    seedGame(db, {
      id: 446,
      homeId: 99,
      awayId: 45,
      homeScore: 17,
      awayScore: 18,
    });
  });

  it('dry-run emits no DB changes (no game mutation, no audit row)', async () => {
    const fetch = fetcherReturning({ homeScore: 17, awayScore: 36 });
    const r = await reconcile(db, [makeEntry()], fetch, { apply: false });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.decision).toBe('apply');
    expect(r.applied).toBe(0);
    expect(r.loggedOnly).toBe(0);

    const game = db.prepare('SELECT away_score FROM games WHERE id=446').get() as {
      away_score: number;
    };
    expect(game.away_score).toBe(18); // unchanged

    const auditCount = (
      db.prepare('SELECT COUNT(*) AS c FROM score_sources').get() as { c: number }
    ).c;
    expect(auditCount).toBe(0);
  });

  it('apply: writes new score + audit row with prior_score snapshot', async () => {
    const fetch = fetcherReturning({ homeScore: 17, awayScore: 36 });
    const r = await reconcile(db, [makeEntry()], fetch, {
      apply: true,
      nowISO: '2026-04-24T12:00:00Z',
    });
    expect(r.applied).toBe(1);
    expect(r.loggedOnly).toBe(0);

    const game = db.prepare('SELECT home_score, away_score FROM games WHERE id=446').get() as {
      home_score: number;
      away_score: number;
    };
    expect(game.away_score).toBe(36);
    expect(game.home_score).toBe(17); // unchanged

    const audit = db
      .prepare(
        `SELECT game_id, team_side, source, score, applied, prior_score,
                source_url, fetched_at
           FROM score_sources WHERE game_id = 446`,
      )
      .get() as {
      game_id: number;
      team_side: string;
      source: string;
      score: number;
      applied: number;
      prior_score: number;
      source_url: string;
      fetched_at: string;
    };
    expect(audit).toMatchObject({
      game_id: 446,
      team_side: 'away',
      source: 'maxpreps',
      score: 36,
      applied: 1,
      prior_score: 18,
      source_url: 'https://maxpreps.test/g/1',
      fetched_at: '2026-04-24T12:00:00Z',
    });
  });

  it('reject: mp below player sum logs applied=0, leaves game alone', async () => {
    const fetch = fetcherReturning({ homeScore: 17, awayScore: 30 }); // 30 < 36
    const r = await reconcile(db, [makeEntry()], fetch, { apply: true });
    expect(r.applied).toBe(0);
    expect(r.loggedOnly).toBe(1);
    expect(r.rows[0]!.decision).toBe('reject:mp_below_player_sum');

    const game = db.prepare('SELECT away_score FROM games WHERE id=446').get() as {
      away_score: number;
    };
    expect(game.away_score).toBe(18); // unchanged
    const audit = db
      .prepare('SELECT applied, score, notes FROM score_sources WHERE game_id=446')
      .get() as { applied: number; score: number; notes: string };
    expect(audit.applied).toBe(0);
    expect(audit.score).toBe(30);
    expect(audit.notes).toMatch(/mpScore\(30\) < playerGoalsSum\(36\)/);
  });

  it('reject: mp above sanity ceiling (pSum+5) logs applied=0', async () => {
    const fetch = fetcherReturning({ homeScore: 17, awayScore: 50 }); // 50 > 36+5
    const r = await reconcile(db, [makeEntry()], fetch, { apply: true });
    expect(r.applied).toBe(0);
    expect(r.loggedOnly).toBe(1);
    expect(r.rows[0]!.decision).toBe('reject:mp_above_ceiling');
    const game = db.prepare('SELECT away_score FROM games WHERE id=446').get() as {
      away_score: number;
    };
    expect(game.away_score).toBe(18);
  });

  it('reject: fetch failure logs applied=0 with score=0 + notes', async () => {
    const r = await reconcile(db, [makeEntry()], fetcherNull(), { apply: true });
    expect(r.applied).toBe(0);
    expect(r.loggedOnly).toBe(1);
    expect(r.rows[0]!.decision).toBe('reject:fetch_failed');
    const audit = db
      .prepare('SELECT applied, score, notes FROM score_sources WHERE game_id=446')
      .get() as { applied: number; score: number; notes: string };
    expect(audit.applied).toBe(0);
    expect(audit.score).toBe(0);
    expect(audit.notes).toBe('fetch failed');
  });

  it('reject: unknown team side (team not on game) logs nothing — score_sources untouched', async () => {
    const r = await reconcile(
      db,
      [makeEntry({ teamId: 12345 })],
      fetcherReturning({ homeScore: 17, awayScore: 36 }),
      { apply: true },
    );
    expect(r.rows[0]!.decision).toBe('reject:unknown_team_side');
    // We never determined a side, so we cannot insert a CHECK-constrained row.
    const c = (
      db.prepare('SELECT COUNT(*) AS c FROM score_sources').get() as { c: number }
    ).c;
    expect(c).toBe(0);
  });

  it('reject: queue invariant violated when currentScore >= pSum', async () => {
    const fetch = fetcherReturning({ homeScore: 17, awayScore: 36 });
    // Override DB game to have away_score=40 to simulate stale queue.
    db.prepare('UPDATE games SET away_score=40 WHERE id=446').run();
    const entry = makeEntry({ currentScore: 40 });
    const r = await reconcile(db, [entry], fetch, { apply: true });
    expect(r.rows[0]!.decision).toBe('reject:queue_invariant_violated');
    expect(r.applied).toBe(0);
  });

  it('honours --limit by slicing the queue', async () => {
    seedTeam(db, 50, 'Other', 'other');
    seedGame(db, { id: 500, homeId: 50, awayId: 99, homeScore: 5, awayScore: 5 });
    const entries: QueueEntry[] = [
      makeEntry(),
      makeEntry({ gameId: 500, teamId: 50, currentScore: 5, playerGoalsSum: 10 }),
    ];
    const fetch = fetcherReturning({ homeScore: 17, awayScore: 36 });
    const r = await reconcile(db, entries, fetch, { apply: false, limit: 1 });
    expect(r.rows).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes (home,away) names in correct positional order to fetcher', async () => {
    // Suspect team is rustin (away). Fetcher should receive haverford as home, rustin as away.
    const fetch = vi.fn(async () => ({
      homeScore: 17,
      awayScore: 36,
      sourceUrl: 'u',
    }));
    await reconcile(db, [makeEntry()], fetch, { apply: false });
    expect(fetch).toHaveBeenCalledWith({
      homeName: 'Haverford High',
      awayName: 'WC Rustin',
      dateISO: '2026-03-21',
    });
  });

  it('treats fetcher throws as fetch failures', async () => {
    const fetch: MaxprepsFetcher = vi.fn(async () => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await reconcile(db, [makeEntry()], fetch, { apply: true });
    warn.mockRestore();
    expect(r.rows[0]!.decision).toBe('reject:fetch_failed');
    expect(r.loggedOnly).toBe(1);
  });
});

// ─── pgrep guard wiring ──────────────────────────────────────────────────

describe('CLI pgrep guard wiring', () => {
  it('script source imports checkServerProcs and gates it on opts.apply', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { resolve, dirname } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, '..', 'reconcileWithSources.ts'),
      'utf8',
    );
    // Imported from the canonical lib helper:
    expect(src).toMatch(
      /from '\.\/lib\/checkServerProcs\.js'|from "\.\/lib\/checkServerProcs\.js"/,
    );
    // Called inside main() with the --force toggle, gated by --apply:
    expect(src).toMatch(
      /if\s*\(\s*opts\.apply\s*\)\s*\{[\s\S]*?checkServerProcs\(\{\s*force:\s*opts\.force\s*\}\)/,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'spawning a fake "src/index.ts" process makes checkServerProcs() exit(1)',
    async () => {
      // Independent verification that the same guard wired into the script
      // actually fires when matching processes exist. (Behavioural coverage
      // for checkServerProcs itself lives in lib/__tests__/.)
      const { spawn } = await import('node:child_process');
      const { checkServerProcs } = await import('../lib/checkServerProcs.js');
      const child = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 60000)', '--', 'src/index.ts'],
        { stdio: 'ignore', detached: false },
      );
      try {
        await new Promise((r) => setTimeout(r, 250));
        const exitSpy = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {
            throw new Error('__exit__');
          }) as never);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => checkServerProcs()).toThrow('__exit__');
        expect(exitSpy).toHaveBeenCalledWith(1);
        const msg = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(msg).toMatch(/Refusing to run --apply/);
      } finally {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
        vi.restoreAllMocks();
      }
    },
    15_000,
  );
});
