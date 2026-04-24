#!/usr/bin/env tsx
// ingest.ts — CLI: walk data/raw-cache/<post-id>.html via raw_cache_meta and
// dispatch each post to the right parser+pipeline. Per-post idempotency via
// `ingest_post_log (post_id, parser_version)`.

import * as path from 'node:path';
import * as url from 'node:url';
import * as fs from 'node:fs';
import type { Database } from 'better-sqlite3';
import { PARSER_VERSION } from '@pll/shared';
import { openDb } from '../db.js';
import {
  parseScoreboardPost,
  parseSummariesPost,
  parseRankingList,
} from '../parsers/index.js';
import { categorizePost, type PipelineCategory } from '../pipelines/categorize.js';
import { extractPostDate } from '../pipelines/postMeta.js';
import { ingestScoreboardPost } from '../pipelines/scoreboard.js';
import { ingestSummariesPost } from '../pipelines/summaries.js';
import { ingestRankingsPost } from '../pipelines/rankings.js';
import { clearAnomaliesForPost, persistLaxNumbersAnomalies } from '../pipelines/anomalies.js';
import { ingestScheduleRows } from '../pipelines/schedule.js';
import { parseScheduleCsv } from '../parsers/scheduleCsv.js';
import { fetchPiaaScheduleCsv } from '../sources/piaaSchedule.js';
import { runImageExtraction } from '../pipelines/postImages.js';
import { DEFAULT_SEASON, seasonFromUrl } from '../crawler.js';

import { runLaxNumbersIngest } from '../pipelines/laxnumbers.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:ingest' });
interface CliArgs {
  limit?: number;
  category: 'all' | PipelineCategory;
  reparse: boolean;
  dbPath?: string;
  cacheDir?: string;
  schedule: boolean;
  scheduleSeason: number;
  scheduleForce: boolean;
  extractImages: boolean;
  // LaxNumbers subcommand
  source?: 'laxnumbers';
  laxDate?: string;
  laxSince?: string;
  laxUntil?: string;
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    category: 'all',
    reparse: false,
    schedule: false,
    scheduleSeason: DEFAULT_SEASON,
    scheduleForce: false,
    extractImages: false,
    apply: false,
  };
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const v = parseInt(a.slice('--limit='.length), 10);
      if (Number.isNaN(v) || v < 1) throw new Error(`Invalid --limit: ${a}`);
      args.limit = v;
    } else if (a.startsWith('--category=')) {
      const v = a.slice('--category='.length);
      if (!['all', 'scoreboard', 'hs-summaries', 'rankings'].includes(v)) {
        throw new Error(`Invalid --category: ${v}`);
      }
      args.category = v as CliArgs['category'];
    } else if (a === '--reparse') {
      args.reparse = true;
    } else if (a.startsWith('--db=')) {
      args.dbPath = a.slice('--db='.length);
    } else if (a.startsWith('--cache-dir=')) {
      args.cacheDir = a.slice('--cache-dir='.length);
    } else if (a === '--schedule') {
      args.schedule = true;
    } else if (a.startsWith('--season=')) {
      const v = parseInt(a.slice('--season='.length), 10);
      if (!Number.isInteger(v) || v < 1900 || v > 3000) throw new Error(`Invalid --season: ${a}`);
      args.scheduleSeason = v;
    } else if (a === '--force-fetch') {
      args.scheduleForce = true;
    } else if (a === '--extract-images') {
      args.extractImages = true;
    } else if (a === '--source=laxnumbers') {
      args.source = 'laxnumbers';
    } else if (a.startsWith('--date=')) {
      args.laxDate = a.slice('--date='.length);
    } else if (a.startsWith('--since=')) {
      args.laxSince = a.slice('--since='.length);
    } else if (a.startsWith('--until=')) {
      args.laxUntil = a.slice('--until='.length);
    } else if (a === '--apply') {
      args.apply = true;
    } else if (a === '--') {
      // pnpm passes '--' as an arg separator; ignore it.
      continue;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  log.info(
    `Usage: tsx src/cli/ingest.ts [--limit=N] [--category=scoreboard|hs-summaries|rankings|all] [--reparse]

Walks data/raw-cache/<post-id>.html via raw_cache_meta. Each post is routed to
its parser + pipeline. Per-post idempotency is keyed on (post_id, parser_version)
in ingest_post_log; bumping PARSER_VERSION (or passing --reparse) re-processes
all posts. A run-level summary row is appended to ingest_log.

LaxNumbers sub-command (PA Boys HS only, additive):
  --source=laxnumbers --date=YYYY-MM-DD [--apply]
  --source=laxnumbers --since=YYYY-MM-DD --until=YYYY-MM-DD [--apply]
  Default is dry-run; add --apply to write to the DB.`,
  );
}

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

interface CacheRow {
  post_id: string;
  url: string;
  fetched_at: string;
}

interface PostLogRow {
  status: string;
}

interface RunSummary {
  postsConsidered: number;
  postsSkippedAlreadyDone: number;
  postsSkippedUncategorized: number;
  postsProcessed: number;
  postsErrored: number;
  scoreboardGames: number;
  summariesGames: number;
  periodsAdded: number;
  playerStatsAdded: number;
  rankingsAdded: number;
  anomaliesAdded: number;
}

function newSummary(): RunSummary {
  return {
    postsConsidered: 0,
    postsSkippedAlreadyDone: 0,
    postsSkippedUncategorized: 0,
    postsProcessed: 0,
    postsErrored: 0,
    scoreboardGames: 0,
    summariesGames: 0,
    periodsAdded: 0,
    playerStatsAdded: 0,
    rankingsAdded: 0,
    anomaliesAdded: 0,
  };
}

function processPost(
  db: Database,
  cacheDir: string,
  meta: CacheRow,
  args: CliArgs,
  summary: RunSummary,
): void {
  summary.postsConsidered++;

  // Idempotency check.
  if (!args.reparse) {
    const prior = db
      .prepare(
        `SELECT status FROM ingest_post_log
         WHERE post_id = ? AND parser_version = ?`,
      )
      .get(meta.post_id, PARSER_VERSION) as PostLogRow | undefined;
    if (prior && (prior.status === 'ok' || prior.status === 'skipped')) {
      summary.postsSkippedAlreadyDone++;
      return;
    }
  }

  const htmlPath = path.join(cacheDir, `${meta.post_id}.html`);
  if (!fs.existsSync(htmlPath)) {
    upsertPostLog(db, meta.post_id, 'unknown', 'error', `cache file missing: ${htmlPath}`, 0, 0, 0, DEFAULT_SEASON);
    summary.postsErrored++;
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');

  const cat = categorizePost(meta.post_id, html);
  if (!cat) {
    upsertPostLog(db, meta.post_id, 'skipped', 'skipped', 'post does not match any pipeline category', 0, 0, 0, DEFAULT_SEASON);
    summary.postsSkippedUncategorized++;
    return;
  }

  // CLI category filter.
  if (args.category !== 'all' && cat.category !== args.category) {
    summary.postsSkippedAlreadyDone++; // counted separately would be confusing; skip silently
    return;
  }

  const postDate = extractPostDate(html) ?? meta.fetched_at.slice(0, 10);
  // Derive season from the post URL path (/2024/, /2025/, /2026/...). Fall
  // back to the year of the post date, then to DEFAULT_SEASON.
  const season =
    seasonFromUrl(meta.url) ??
    (Number(postDate.slice(0, 4)) || DEFAULT_SEASON);

  const tx = db.transaction(() => {
    // Replace prior anomalies for this post so re-runs don't accumulate.
    clearAnomaliesForPost(db, meta.post_id);

    if (cat.category === 'scoreboard') {
      const parsed = parseScoreboardPost(html);
      const r = ingestScoreboardPost(db, {
        postId: meta.post_id,
        postUrl: meta.url,
        postDate,
        season,
        parsed,
      });
      upsertPostLog(db, meta.post_id, 'scoreboard', 'ok', null,
        r.gamesUpserted, 0, r.anomaliesAdded, season);
      summary.scoreboardGames += r.gamesUpserted;
      summary.anomaliesAdded += r.anomaliesAdded;
    } else if (cat.category === 'hs-summaries') {
      const parsed = parseSummariesPost(html);
      const r = ingestSummariesPost(db, {
        postId: meta.post_id,
        postUrl: meta.url,
        postDate,
        season,
        parsed,
      });
      upsertPostLog(db, meta.post_id, 'hs-summaries', 'ok', null,
        r.gamesUpserted, r.playerStatsUpserted, r.anomaliesAdded, season);
      summary.summariesGames += r.gamesUpserted;
      summary.periodsAdded += r.periodsUpserted;
      summary.playerStatsAdded += r.playerStatsUpserted;
      summary.anomaliesAdded += r.anomaliesAdded;
    } else {
      const parsed = parseRankingList(html, {
        rankingSource: cat.rankingSource ?? 'philly',
        postUrl: meta.url,
      });
      const r = ingestRankingsPost(db, {
        postId: meta.post_id,
        postUrl: meta.url,
        postDate,
        rankingSource: cat.rankingSource ?? 'philly',
        parsed,
      });
      upsertPostLog(db, meta.post_id, 'rankings', 'ok', null,
        0, r.rankingsUpserted, r.anomaliesAdded, season);
      summary.rankingsAdded += r.rankingsUpserted;
      summary.anomaliesAdded += r.anomaliesAdded;
    }
  });

  try {
    tx();
    summary.postsProcessed++;
  } catch (err) {
    upsertPostLog(db, meta.post_id, cat.category, 'error', (err as Error).message, 0, 0, 0, season);
    summary.postsErrored++;
    log.error(`[ingest] post ${meta.post_id} failed: ${(err as Error).message}`);
  }
}

function upsertPostLog(
  db: Database,
  postId: string,
  category: string,
  status: string,
  errorMessage: string | null,
  gamesAdded: number,
  rowsAdded: number,
  anomaliesAdded: number,
  season: number,
): void {
  db.prepare(
    `INSERT INTO ingest_post_log
       (post_id, parser_version, category, status, error_message,
        games_added, rows_added, anomalies_added, processed_at, season)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id, parser_version) DO UPDATE SET
       category        = excluded.category,
       status          = excluded.status,
       error_message   = excluded.error_message,
       games_added     = excluded.games_added,
       rows_added      = excluded.rows_added,
       anomalies_added = excluded.anomalies_added,
       processed_at    = excluded.processed_at,
       season          = excluded.season`,
  ).run(
    postId,
    PARSER_VERSION,
    category,
    status,
    errorMessage,
    gamesAdded,
    rowsAdded,
    anomaliesAdded,
    new Date().toISOString(),
    season,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const dbPath = args.dbPath ?? process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(repoRoot, 'data', 'lacrosse.db');
  const cacheDir = args.cacheDir ?? path.join(repoRoot, 'data', 'raw-cache');

  log.info(
    `[ingest] db=${dbPath} cacheDir=${cacheDir} category=${args.category} reparse=${args.reparse} parser=${PARSER_VERSION}`,
  );

  const db = openDb(dbPath);

  // Wave 18 W2L1 (Han) — LaxNumbers PA-only additive ingest.
  if (args.source === 'laxnumbers') {
    if (!args.laxDate && !(args.laxSince && args.laxUntil)) {
      process.stderr.write(
        '[ingest:laxnumbers] ERROR: supply --date=YYYY-MM-DD or --since=YYYY-MM-DD --until=YYYY-MM-DD\n',
      );
      db.close();
      process.exit(1);
    }
    const mode = args.apply ? 'APPLY' : 'DRY-RUN';
    process.stderr.write(
      `[ingest:laxnumbers] mode=${mode} date=${args.laxDate ?? `${args.laxSince}..${args.laxUntil}`}\n`,
    );
    const r = await runLaxNumbersIngest(db, {
      date: args.laxDate,
      since: args.laxSince,
      until: args.laxUntil,
      apply: args.apply,
    });
    process.stderr.write(
      `[ingest:laxnumbers] fetched=${r.fetched} paGames=${r.paGames} resolved=${r.resolvedGames} inserted=${r.inserted} updated=${r.updated}\n`,
    );
    process.stderr.write(
      `[ingest:laxnumbers] skipped: nonPA=${r.skipped.nonPA} postponed=${r.skipped.postponed} unknownTeam=${r.skipped.unknownTeam} alreadyComplete=${r.skipped.alreadyComplete}\n`,
    );
    if (r.anomalies.length > 0) {
      process.stderr.write(
        `[ingest:laxnumbers] anomalies (first ${Math.min(r.anomalies.length, 20)} of ${r.anomalies.length}):\n`,
      );
      for (const a of r.anomalies.slice(0, 20)) {
        process.stderr.write(`  [${a.kind}] ${a.detail}\n`);
      }
    }
    if (args.apply && r.anomalies.length > 0) {
      const persisted = persistLaxNumbersAnomalies(db, r.anomalies);
      process.stderr.write(
        `[ingest:laxnumbers] persisted ${persisted} unknown-team anomalies to ingest_anomalies\n`,
      );
    }
    db.close();
    return;
  }
  // skips the recap/scoreboard pipelines, writes image URLs into post_images.
  if (args.extractImages) {
    log.info(`[ingest:images] cacheDir=${cacheDir} limit=${args.limit ?? 'all'}`);
    const r = runImageExtraction(db, cacheDir, { limit: args.limit });
    log.info(
      `[ingest:images] scanned=${r.postsScanned} with_image=${r.postsWithImage} inserted=${r.imagesInserted} skipped_existing=${r.imagesSkippedExisting}`,
    );
    db.close();
    return;
  }

  // Wave 16 Lane 2 (Leia) — schedule path runs independently of the
  // post-cache walker. Skips the recap pipeline entirely.
  if (args.schedule) {
    const scheduleCacheDir = path.join(repoRoot, 'data', 'schedule-cache');
    log.info(`[ingest:schedule] season=${args.scheduleSeason} cacheDir=${scheduleCacheDir} force=${args.scheduleForce}`);
    const fetched = await fetchPiaaScheduleCsv({
      season: args.scheduleSeason,
      cacheDir: scheduleCacheDir,
      force: args.scheduleForce,
    });
    log.info(`[ingest:schedule] csv source=${fetched.source} bytes=${fetched.csv.length} url=${fetched.url}`);
    const parsed = parseScheduleCsv(fetched.csv);
    const r = ingestScheduleRows(db, {
      source: 'piaa-d1',
      sourceUrl: fetched.url,
      season: args.scheduleSeason,
      rows: parsed.rows,
    });
    log.info(`[ingest:schedule] parsed_rows=${parsed.rows.length} malformed=${parsed.malformed.length}`);
    log.info(`[ingest:schedule] upserted=${r.scheduleRowsUpserted} skipped_completed=${r.scheduleRowsSkippedCompleted} home_unresolved=${r.homeUnresolved} away_unresolved=${r.awayUnresolved} anomalies_added=${r.anomaliesAdded}`);
    db.close();
    return;
  }

  const start = Date.now();
  const summary = newSummary();

  const rows = db
    .prepare(
      `SELECT post_id, url, fetched_at FROM raw_cache_meta ORDER BY fetched_at ASC`,
    )
    .all() as CacheRow[];

  let processedCount = 0;
  for (const row of rows) {
    if (args.limit !== undefined && processedCount >= args.limit) break;
    processPost(db, cacheDir, row, args, summary);
    if (summary.postsProcessed > processedCount || summary.postsErrored > 0) {
      // Increment the processed counter only when we actually did work (or
      // failed); silent skips don't count toward --limit.
      processedCount = summary.postsProcessed + summary.postsErrored;
    }
  }

  const elapsed = Date.now() - start;
  db.prepare(
    `INSERT INTO ingest_log
       (run_at, feed_items_seen, games_added, summaries_parsed,
        rankings_parsed, anomalies_created, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    new Date().toISOString(),
    summary.postsConsidered,
    summary.scoreboardGames + summary.summariesGames,
    summary.summariesGames,
    summary.rankingsAdded,
    summary.anomaliesAdded,
    elapsed,
  );

  log.info(`[ingest] done in ${elapsed}ms`);
  log.info(`  considered=${summary.postsConsidered} processed=${summary.postsProcessed} skipped=${summary.postsSkippedAlreadyDone} uncategorized=${summary.postsSkippedUncategorized} errors=${summary.postsErrored}`);
  log.info(`  scoreboard_games=${summary.scoreboardGames} summaries_games=${summary.summariesGames} periods=${summary.periodsAdded} player_stats=${summary.playerStatsAdded} rankings=${summary.rankingsAdded} anomalies=${summary.anomaliesAdded}`);

  db.close();
}

main().catch((err) => {
  log.error('[ingest] FAILED:', err);
  process.exit(1);
});
