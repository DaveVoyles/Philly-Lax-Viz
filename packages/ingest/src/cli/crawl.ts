#!/usr/bin/env tsx
import * as path from 'node:path';
import * as url from 'node:url';
import * as fs from 'node:fs';
import {
  ALL_CATEGORIES,
  type Category,
  type CrawlSummary,
  DEFAULT_SEASON,
  crawlAll,
  defaultCacheDir,
} from '../crawler.js';
import {
  InMemoryCacheStore,
  SqliteCacheStore,
  type CacheStore,
} from '../cache.js';

interface CliArgs {
  maxPages?: number;
  category: 'all' | Category;
  ignoreWatermark?: boolean;
  seasons: number[];
}

function parseSeasonsArg(raw: string): number[] {
  const out: number[] = [];
  for (const piece of raw.split(',')) {
    const t = piece.trim();
    if (!t) continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 2000 || n > 2100) {
      throw new Error(`Invalid season "${t}" — expected a 4-digit year`);
    }
    if (!out.includes(n)) out.push(n);
  }
  if (out.length === 0) throw new Error(`Empty season list`);
  return out;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { category: 'all', seasons: [DEFAULT_SEASON] };
  for (const a of argv) {
    if (a.startsWith('--max-pages=')) {
      const v = parseInt(a.slice('--max-pages='.length), 10);
      if (Number.isNaN(v) || v < 1) {
        throw new Error(`Invalid --max-pages: ${a}`);
      }
      args.maxPages = v;
    } else if (a.startsWith('--category=')) {
      const v = a.slice('--category='.length);
      if (v !== 'all' && !ALL_CATEGORIES.includes(v as Category)) {
        throw new Error(
          `Invalid --category: ${v}. Use one of: all, ${ALL_CATEGORIES.join(', ')}`,
        );
      }
      args.category = v as CliArgs['category'];
    } else if (a.startsWith('--year=')) {
      args.seasons = parseSeasonsArg(a.slice('--year='.length));
    } else if (a.startsWith('--years=')) {
      args.seasons = parseSeasonsArg(a.slice('--years='.length));
    } else if (a === '--ignore-watermark') {
      args.ignoreWatermark = true;
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
  console.log(
    `Usage: tsx src/cli/crawl.ts [--max-pages=N] [--category=scoreboard|hs-summaries|rankings|all] [--year=YYYY|--years=YYYY,YYYY]

Crawls the configured PhillyLacrosse.com category archives and writes
raw HTML to data/raw-cache/<post-id>.html, recording metadata in the
raw_cache_meta SQLite table. Each season's watermark is tracked
independently so backfill runs don't disturb live-season idempotency.`,
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

async function openCacheStore(repoRoot: string): Promise<{
  store: CacheStore;
  closer?: () => void;
  backend: 'sqlite' | 'memory';
}> {
  // Try the SQLite-backed store via the (Han-owned) db module. If it's not
  // available yet, fall back to an in-memory store so the crawler still runs
  // end-to-end during early development.
  try {
    const dbModule = (await import('../db.js')) as {
      openDb?: (p?: string) => unknown;
    };
    if (typeof dbModule.openDb !== 'function') {
      throw new Error('db.ts does not export openDb()');
    }
    const dbPath = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(repoRoot, 'data', 'lacrosse.db');
    const db = dbModule.openDb(dbPath) as ConstructorParameters<
      typeof SqliteCacheStore
    >[0] & {
      close?: () => void;
    };
    return {
      store: new SqliteCacheStore(db),
      ...(db.close ? { closer: () => db.close!() } : {}),
      backend: 'sqlite',
    };
  } catch (err) {
    console.warn(
      `[crawl] SQLite db not yet available (${(err as Error).message}); using in-memory cache store.`,
    );
    return { store: new InMemoryCacheStore(), backend: 'memory' };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  const cacheDir = defaultCacheDir(repoRoot);

  const { store, closer, backend } = await openCacheStore(repoRoot);
  console.log(
    `[crawl] backend=${backend} cacheDir=${cacheDir} category=${args.category} seasons=${args.seasons.join(',')} maxPages=${args.maxPages ?? 'unlimited'}`,
  );

  const categories: readonly Category[] =
    args.category === 'all' ? ALL_CATEGORIES : [args.category];

  const start = Date.now();
  const summaries: CrawlSummary[] = await crawlAll(
    categories,
    {
      maxPages: args.maxPages,
      ignoreWatermark: args.ignoreWatermark,
      seasons: args.seasons,
    },
    {
      fetch: globalThis.fetch as Parameters<typeof crawlAll>[2]['fetch'],
      cache: store,
      cacheDir,
    },
  );
  const elapsed = Date.now() - start;

  console.log(`[crawl] done in ${elapsed}ms`);
  for (const s of summaries) {
    console.log(
      `  ${s.category}/${s.season}: pages=${s.pagesFetched} seen=${s.postsSeen} fetched=${s.postsFetched} cached=${s.postsAlreadyCached} skipped-girls=${s.postsSkippedGirls} stop=${s.stoppedReason}`,
    );
  }

  if (closer) closer();
}

main().catch((err) => {
  console.error('[crawl] FAILED:', err);
  process.exit(1);
});
