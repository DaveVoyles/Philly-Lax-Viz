/**
 * reconcileWithSources.ts — Wave H9 Lane 1 (Han).
 *
 * Orchestrator for the 29-game team-score reconcile queue produced by
 * `reconcileTeamScores.ts`. For each suspect (recorded score < per-player
 * goals sum) we consult MaxPreps (operational top-of-stack for per-game
 * scores; PIAA carries no per-game data) and either auto-apply or log the
 * disagreement to the `score_sources` audit table.
 *
 * Auto-apply rule (binding, see H9 plan):
 *   apply ⇔ mpScore >= playerGoalsSum
 *         AND mpScore <= playerGoalsSum + 5         (sanity ceiling)
 *         AND currentScore < playerGoalsSum         (queue invariant; asserted)
 *
 * Anything else → INSERT score_sources row with applied=0 and a `notes`
 * reason. Fetch failures are logged with score=0 / notes='fetch failed'.
 *
 * Default mode is dry-run. `--apply` mutates and is gated by
 * `checkServerProcs()` (H6 lesson). `--force` bypasses the pgrep guard.
 *
 * Usage:
 *   pnpm --filter @pll/ingest reconcile:scores                 # dry-run
 *   pnpm --filter @pll/ingest reconcile:scores -- --apply
 *   pnpm --filter @pll/ingest reconcile:scores -- --limit 5
 *   pnpm --filter @pll/ingest reconcile:scores -- --queue path/to/queue.json
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { checkServerProcs } from './lib/checkServerProcs.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:reconcileWithSources' });
// ─── Types ──────────────────────────────────────────────────────────────

/** Shape of one entry in the reconcile queue JSON (matches reconcileTeamScores.ts). */
export interface QueueEntry {
  gameId: number;
  date: string;
  teamId: number;
  teamName: string;
  opponentName: string;
  currentScore: number;
  playerGoalsSum: number;
  suspectDelta: number;
  sourcePostUrl: string | null;
}

/** Result of a MaxPreps fetch. Lane 2 owns the real implementation. */
export interface MaxprepsScore {
  homeScore: number;
  awayScore: number;
  sourceUrl: string;
}

export interface FetchMaxprepsArgs {
  homeName: string;
  awayName: string;
  dateISO: string;
}

/** Injectable for tests; production wires Lane 2's `fetchMaxprepsGameScore`. */
export type MaxprepsFetcher = (
  args: FetchMaxprepsArgs,
) => Promise<MaxprepsScore | null>;

export type Decision =
  | 'apply'
  | 'reject:fetch_failed'
  | 'reject:mp_below_player_sum'
  | 'reject:mp_above_ceiling'
  | 'reject:queue_invariant_violated'
  | 'reject:unknown_team_side';

export interface PlanRow {
  entry: QueueEntry;
  teamSide: 'home' | 'away' | null;
  mpScore: number | null;          // suspect-side MaxPreps score, null if fetch failed
  mpHomeScore: number | null;
  mpAwayScore: number | null;
  sourceUrl: string | null;
  decision: Decision;
  reason: string;
  priorScore: number;              // games.{home,away}_score snapshot
}

export interface RunOptions {
  apply: boolean;
  force: boolean;
  limit: number | null;
  queuePath: string;
}

export interface RunResult {
  rows: PlanRow[];
  applied: number;
  loggedOnly: number;
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────

interface GameRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
}

/** Determine whether the suspect team is on the home or away side. */
export function determineSide(
  game: Pick<GameRow, 'home_team_id' | 'away_team_id'>,
  teamId: number,
): 'home' | 'away' | null {
  if (game.home_team_id === teamId) return 'home';
  if (game.away_team_id === teamId) return 'away';
  return null;
}

/** Apply the auto-apply rule. Returns the decision + human-readable reason. */
export function classify(
  entry: QueueEntry,
  mpScore: number | null,
): { decision: Decision; reason: string } {
  if (mpScore === null) {
    return { decision: 'reject:fetch_failed', reason: 'fetch failed' };
  }
  if (entry.currentScore >= entry.playerGoalsSum) {
    return {
      decision: 'reject:queue_invariant_violated',
      reason: `currentScore(${entry.currentScore}) >= playerGoalsSum(${entry.playerGoalsSum}); not a queue suspect`,
    };
  }
  if (mpScore < entry.playerGoalsSum) {
    return {
      decision: 'reject:mp_below_player_sum',
      reason: `mpScore(${mpScore}) < playerGoalsSum(${entry.playerGoalsSum})`,
    };
  }
  if (mpScore > entry.playerGoalsSum + 5) {
    return {
      decision: 'reject:mp_above_ceiling',
      reason: `mpScore(${mpScore}) > playerGoalsSum(${entry.playerGoalsSum}) + 5`,
    };
  }
  return {
    decision: 'apply',
    reason: `mpScore(${mpScore}) within [${entry.playerGoalsSum}, ${entry.playerGoalsSum + 5}]`,
  };
}

// ─── Core orchestrator ──────────────────────────────────────────────────

const FETCH_FAILED_SCORE = 0;

function loadGame(db: DatabaseType, gameId: number): GameRow | null {
  const row = db
    .prepare(
      `SELECT id, home_team_id, away_team_id, home_score, away_score
         FROM games WHERE id = ?`,
    )
    .get(gameId) as GameRow | undefined;
  return row ?? null;
}

function insertSourceRow(
  db: DatabaseType,
  args: {
    gameId: number;
    teamSide: 'home' | 'away';
    source: string;
    score: number;
    fetchedAt: string;
    applied: 0 | 1;
    priorScore: number | null;
    sourceUrl: string | null;
    notes: string;
  },
): void {
  db.prepare(
    `INSERT INTO score_sources
       (game_id, team_side, source, score, fetched_at, applied,
        prior_score, source_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.gameId,
    args.teamSide,
    args.source,
    args.score,
    args.fetchedAt,
    args.applied,
    args.priorScore,
    args.sourceUrl,
    args.notes,
  );
}

function updateGameScore(
  db: DatabaseType,
  gameId: number,
  side: 'home' | 'away',
  newScore: number,
): void {
  const col = side === 'home' ? 'home_score' : 'away_score';
  db.prepare(`UPDATE games SET ${col} = ? WHERE id = ?`).run(newScore, gameId);
}

/**
 * Run the orchestrator end-to-end. Pure-ish: takes an injected fetcher and DB,
 * does no process.exit / argv parsing / file I/O of its own.
 *
 * In dry-run mode (apply=false), no DB writes occur — even score_sources
 * inserts are skipped (we only emit a plan).
 *
 * Exported for tests.
 */
export async function reconcile(
  db: DatabaseType,
  queue: QueueEntry[],
  fetcher: MaxprepsFetcher,
  options: { apply: boolean; limit?: number | null; nowISO?: string } = { apply: false },
): Promise<RunResult> {
  const limit = options.limit ?? null;
  const slice = limit !== null ? queue.slice(0, limit) : queue;
  const nowISO = options.nowISO ?? new Date().toISOString();

  const rows: PlanRow[] = [];
  let applied = 0;
  let loggedOnly = 0;

  for (const entry of slice) {
    const game = loadGame(db, entry.gameId);
    if (!game) {
      rows.push({
        entry,
        teamSide: null,
        mpScore: null,
        mpHomeScore: null,
        mpAwayScore: null,
        sourceUrl: null,
        decision: 'reject:unknown_team_side',
        reason: `game ${entry.gameId} not found`,
        priorScore: entry.currentScore,
      });
      continue;
    }
    const teamSide = determineSide(game, entry.teamId);
    if (!teamSide) {
      rows.push({
        entry,
        teamSide: null,
        mpScore: null,
        mpHomeScore: null,
        mpAwayScore: null,
        sourceUrl: null,
        decision: 'reject:unknown_team_side',
        reason: `team ${entry.teamId} is neither home(${game.home_team_id}) nor away(${game.away_team_id}) on game ${entry.gameId}`,
        priorScore: entry.currentScore,
      });
      continue;
    }

    const priorScore =
      teamSide === 'home' ? game.home_score : game.away_score;

    let mp: MaxprepsScore | null = null;
    try {
      mp = await fetcher({
        homeName:
          teamSide === 'home' ? entry.teamName : entry.opponentName,
        awayName:
          teamSide === 'away' ? entry.teamName : entry.opponentName,
        dateISO: entry.date,
      });
    } catch (err) {
      // Treat thrown errors as fetch failures (Lane 2's contract is to return
      // null on parse/network problems, but be defensive).
      mp = null;
      log.warn(
        `[reconcile] fetcher threw for game ${entry.gameId}: ${(err as Error).message}`,
      );
    }

    const mpScore = mp
      ? teamSide === 'home'
        ? mp.homeScore
        : mp.awayScore
      : null;
    const { decision, reason } = classify(entry, mpScore);

    const planRow: PlanRow = {
      entry,
      teamSide,
      mpScore,
      mpHomeScore: mp?.homeScore ?? null,
      mpAwayScore: mp?.awayScore ?? null,
      sourceUrl: mp?.sourceUrl ?? null,
      decision,
      reason,
      priorScore,
    };
    rows.push(planRow);

    if (!options.apply) continue;

    if (decision === 'apply' && mpScore !== null) {
      const tx = db.transaction(() => {
        updateGameScore(db, entry.gameId, teamSide, mpScore);
        insertSourceRow(db, {
          gameId: entry.gameId,
          teamSide,
          source: 'maxpreps',
          score: mpScore,
          fetchedAt: nowISO,
          applied: 1,
          priorScore,
          sourceUrl: mp?.sourceUrl ?? null,
          notes: reason,
        });
      });
      tx();
      applied += 1;
    } else {
      insertSourceRow(db, {
        gameId: entry.gameId,
        teamSide,
        source: 'maxpreps',
        score: mpScore ?? FETCH_FAILED_SCORE,
        fetchedAt: nowISO,
        applied: 0,
        priorScore,
        sourceUrl: mp?.sourceUrl ?? null,
        notes: reason,
      });
      loggedOnly += 1;
    }
  }

  return { rows, applied, loggedOnly };
}

// ─── CLI plumbing ───────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src/scripts → repo root is ../../../..
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const DEFAULT_QUEUE = resolve(
  REPO_ROOT,
  '.github/docs/2026-04-23-team-score-reconcile-queue.json',
);

function parseArgs(argv: string[]): RunOptions {
  let limit: number | null = null;
  let queuePath = DEFAULT_QUEUE;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') {
      const next = argv[i + 1];
      if (!next) throw new Error('--limit requires a number');
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit must be a positive integer (got ${next})`);
      }
      limit = Math.floor(n);
      i += 1;
    } else if (a?.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit must be a positive integer (got ${a})`);
      }
      limit = Math.floor(n);
    } else if (a === '--queue') {
      const next = argv[i + 1];
      if (!next) throw new Error('--queue requires a path');
      queuePath = resolve(next);
      i += 1;
    } else if (a?.startsWith('--queue=')) {
      queuePath = resolve(a.slice('--queue='.length));
    }
  }
  return {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
    limit,
    queuePath,
  };
}

function loadQueue(path: string): QueueEntry[] {
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`queue file ${path} did not parse as a JSON array`);
  }
  return data as QueueEntry[];
}

function printPlan(result: RunResult, opts: RunOptions): void {
  const header = opts.apply ? 'APPLY' : 'DRY-RUN';
  log.info(`──────── reconcileWithSources (${header}) ────────`);
  log.info(`queue:    ${opts.queuePath}`);
  log.info(`entries:  ${result.rows.length}${opts.limit ? ` (limit=${opts.limit})` : ''}`);
  log.info('');
  // Compact table
  const cols = ['game', 'side', 'team', 'cur→mp', 'pSum', 'decision', 'reason'];
  log.info(cols.join('\t'));
  for (const r of result.rows) {
    log.info(
      [
        r.entry.gameId,
        r.teamSide ?? '?',
        r.entry.teamName.slice(0, 22),
        `${r.entry.currentScore}→${r.mpScore ?? '∅'}`,
        r.entry.playerGoalsSum,
        r.decision,
        r.reason.slice(0, 60),
      ].join('\t'),
    );
  }
  const wouldApply = result.rows.filter((r) => r.decision === 'apply').length;
  log.info('');
  log.info(`would-apply: ${wouldApply}`);
  if (opts.apply) {
    log.info(`applied:     ${result.applied}`);
    log.info(`logged-only: ${result.loggedOnly}`);
  } else {
    log.info('(dry-run only — re-run with --apply to write)');
  }
  log.info('────────────────────────────────────────────────');
}

/**
 * Resolve the production MaxPreps fetcher. Lane 2 ships
 * `packages/ingest/src/sources/maxprepsGame.ts`; if it isn't on disk yet we
 * surface a clear error rather than crashing on import.
 *
 * When a `db` is provided, the fetcher additionally performs schedule URL
 * discovery: for each (home, away, date) triple, it loads the home (or away)
 * team's MaxPreps schedule page once per run, finds the canonical game URL
 * (with the unguessable `?c=<hash>` token), and passes that URL directly into
 * the inner fetcher via `discoveredUrl`. Without this step, anon traffic 404s
 * on essentially all per-game URLs.
 */
async function loadProductionFetcher(
  db?: DatabaseType,
): Promise<MaxprepsFetcher> {
  try {
    // Dynamic import so missing module doesn't break dry-run-with-mocks usage.
    const mod = (await import('../sources/maxprepsGame.js')) as {
      fetchMaxprepsGameScore?: (
        opts: import('../sources/maxprepsGame.js').FetchMaxprepsGameOpts,
      ) => Promise<import('../sources/maxprepsGame.js').MaxprepsGameScore | null>;
    };
    if (typeof mod.fetchMaxprepsGameScore !== 'function') {
      throw new Error(
        'maxprepsGame.ts present but does not export fetchMaxprepsGameScore',
      );
    }
    const cookie = process.env.MAXPREPS_COOKIE?.trim();
    if (cookie && cookie.length > 0) {
      log.info(
        `[reconcileWithSources] MAXPREPS_COOKIE detected (${cookie.length} bytes) — using authenticated fetch`,
      );
    } else {
      log.info(
        '[reconcileWithSources] MAXPREPS_COOKIE not set — anon fetch only',
      );
    }

    // Schedule discovery setup (only if we have a DB to look up team slugs).
    const scheduleMod = await import('../sources/maxprepsSchedule.js');
    const teamSlugLookup = db
      ? buildTeamSlugLookup(db)
      : (_name: string) => null;
    const scheduleCache = new Map<
      string,
      Awaited<ReturnType<typeof scheduleMod.fetchTeamSchedule>>
    >();

    const inner = mod.fetchMaxprepsGameScore;
    return async (args: FetchMaxprepsArgs) => {
      // 1. Try to discover the canonical URL via the home team's schedule.
      let discoveredUrl: string | undefined;
      const homeSlug = teamSlugLookup(args.homeName);
      const awaySlug = teamSlugLookup(args.awayName);
      const ownSlug = homeSlug ?? awaySlug;
      if (ownSlug) {
        let schedule = scheduleCache.get(ownSlug);
        if (schedule === undefined) {
          schedule = await scheduleMod.fetchTeamSchedule({
            schoolSlug: ownSlug,
            cookie,
          });
          scheduleCache.set(ownSlug, schedule);
          log.info(
            `[reconcileWithSources] schedule for ${ownSlug}: ${
              schedule === null ? 'fetch failed' : `${schedule.length} entries`
            }`,
          );
        }
        if (schedule && schedule.length > 0) {
          // Build slug candidates from the school slug (keep both full and
          // mascot-stripped forms so we match either side of the pair).
          const ownCands = slugCandidatesFromSchoolSlug(ownSlug);
          const oppRawSlug = homeSlug ? awaySlug : homeSlug;
          const oppCands = oppRawSlug
            ? slugCandidatesFromSchoolSlug(oppRawSlug)
            : [slugifyName(homeSlug ? args.awayName : args.homeName)];
          const entry = scheduleMod.findScheduleEntry(schedule, {
            dateISO: args.dateISO,
            ownSlugCandidates: ownCands,
            opponentSlugCandidates: oppCands,
          });
          if (entry) {
            discoveredUrl = entry.url;
          }
        }
      }

      const result = await inner({
        homeName: args.homeName,
        awayName: args.awayName,
        dateISO: args.dateISO,
        cookie,
        discoveredUrl,
      });
      if (!result) return null;
      return {
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        sourceUrl: result.sourceUrl,
      };
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'MaxPreps fetcher not yet available (Lane 2 ships ' +
          'packages/ingest/src/sources/maxprepsGame.ts). Re-run after Lane 2 lands, ' +
          'or invoke reconcile() programmatically with an injected fetcher.',
      );
    }
    throw err;
  }
}

/**
 * Build a `name -> maxpreps_slug` lookup over the teams table. Returns null
 * when a team has no slug populated.
 */
function buildTeamSlugLookup(
  db: DatabaseType,
): (name: string) => string | null {
  const rows = db
    .prepare(
      `SELECT name, maxpreps_slug FROM teams WHERE maxpreps_slug IS NOT NULL`,
    )
    .all() as Array<{ name: string; maxpreps_slug: string }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.name.toLowerCase(), r.maxpreps_slug);
  }
  return (name: string) => map.get(name.toLowerCase()) ?? null;
}

/**
 * Derive slug match candidates from a school slug like
 * "royersford/spring-ford-rams" → ["spring-ford-rams", "spring-ford"].
 * The schedule URL slugs come without the city prefix and may or may not
 * include the mascot suffix.
 */
function slugCandidatesFromSchoolSlug(schoolSlug: string): string[] {
  const tail = schoolSlug.split('/').pop() ?? schoolSlug;
  const parts = tail.split('-');
  const out: string[] = [tail];
  if (parts.length > 1) out.push(parts.slice(0, -1).join('-'));
  if (parts.length > 2) out.push(parts.slice(0, -2).join('-'));
  return out.filter((s) => s.length > 0);
}

/** Light slugify for fallback when team has no maxpreps_slug. */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.apply) {
    checkServerProcs({ force: opts.force });
  }

  const dbPath =
    process.env.DB_PATH ??
    process.env.PLL_DB_PATH ??
    resolve(REPO_ROOT, 'data', 'lacrosse.db');

  log.info(
    `[reconcileWithSources] db=${dbPath} mode=${opts.apply ? 'APPLY' : 'dry-run'}`,
  );

  const queue = loadQueue(opts.queuePath);
  const db = openDb(dbPath);
  const fetcher = await loadProductionFetcher(db);
  try {
    const result = await reconcile(db, queue, fetcher, {
      apply: opts.apply,
      limit: opts.limit,
    });
    printPlan(result, opts);
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    log.error(err);
    process.exit(1);
  });
}
