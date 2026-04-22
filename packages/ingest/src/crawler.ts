import * as path from 'node:path';
import * as cheerio from 'cheerio';
import type { RawCacheMeta } from '@pll/shared';
import {
  type CacheStore,
  postIdFromUrl,
  sha256,
  writeRawHtml,
} from './cache.js';

export type Category = 'scoreboard' | 'hs-summaries' | 'rankings';
export const ALL_CATEGORIES: readonly Category[] = [
  'scoreboard',
  'hs-summaries',
  'rankings',
] as const;

export const USER_AGENT = 'philly-lacrosse-vis/0.1 (local dev)';
export const DEFAULT_DELAY_MS = 250;

const POST_HREF_RE =
  /^https?:\/\/phillylacrosse\.com\/2026\/[a-z0-9][a-z0-9-]*\/?$/i;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}
export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponseLike>;

export interface CrawlerDeps {
  fetch: FetchFn;
  cache: CacheStore;
  cacheDir: string;
  /** Delay between fetches in ms. Default 250. Tests pass 0. */
  delayMs?: number;
  /** Optional clock override for fetchedAt timestamps. */
  now?: () => Date;
  /** Optional sleep override for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional logger. Default console. */
  log?: (msg: string) => void;
}

export interface CrawlOptions {
  category: Category;
  /** Hard cap on archive pages crawled. */
  maxPages?: number;
  /**
   * If true, do NOT stop early when a page is fully cached. Used for
   * backfill runs where prior crawls only covered the most-recent page
   * but older pages still contain uncached posts.
   */
  ignoreWatermark?: boolean;
}

export interface CrawlSummary {
  category: Category;
  pagesFetched: number;
  postsSeen: number;
  postsSkippedGirls: number;
  postsAlreadyCached: number;
  postsFetched: number;
  stoppedReason: 'max-pages' | 'no-new-posts' | 'empty-page' | 'http-error';
}

const DEFAULT_DEPS_SLEEP = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function categoryUrl(category: Category, page: number): string {
  return `https://phillylacrosse.com/category/${category}/page/${page}/`;
}

export function postUrlPrefix(category: Category): string {
  // Watermark prefix isn't tied to category — post URLs all live under
  // /YYYY/<slug>/. We use the bare origin as the prefix so the watermark
  // covers every post we've ever cached. Categories are tracked separately by
  // the URL pattern of the archive root.
  void category;
  return 'https://phillylacrosse.com/';
}

/**
 * Slug filter: drop URLs whose slug clearly belongs to a girls / women's post.
 * Scoreboard posts bundle both genders so we keep them all and let parsers
 * section-filter; for hs-summaries and rankings we filter at crawl time.
 */
export function isGirlsSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  // Match whole words to avoid false positives. Common variants:
  //   girls-summaries-..., -girls-, womens-college-...
  return /(^|-)(girls|womens|women)(-|$)/.test(s);
}

/**
 * Extract candidate post URLs from an archive page. We accept any link whose
 * href matches `https://phillylacrosse.com/2026/<slug>/`. Duplicates within a
 * page are de-duplicated, preserving first-seen order.
 */
export function extractPostUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    if (!raw) return;
    let href = raw.trim();
    if (!POST_HREF_RE.test(href)) return;
    if (!href.endsWith('/')) href += '/';
    if (seen.has(href)) return;
    seen.add(href);
    out.push(href);
  });
  return out;
}

export async function crawlCategory(
  opts: CrawlOptions,
  deps: CrawlerDeps,
): Promise<CrawlSummary> {
  const {
    fetch,
    cache,
    cacheDir,
    delayMs = DEFAULT_DELAY_MS,
    now = () => new Date(),
    sleep = DEFAULT_DEPS_SLEEP,
    log = (m: string) => console.log(m),
  } = deps;
  const maxPages = opts.maxPages ?? 50;

  const watermark = await cache.latestFetchedAt(postUrlPrefix(opts.category));

  const summary: CrawlSummary = {
    category: opts.category,
    pagesFetched: 0,
    postsSeen: 0,
    postsSkippedGirls: 0,
    postsAlreadyCached: 0,
    postsFetched: 0,
    stoppedReason: 'max-pages',
  };

  for (let page = 1; page <= maxPages; page++) {
    const archiveUrl = categoryUrl(opts.category, page);
    const archiveRes = await fetch(archiveUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!archiveRes.ok) {
      summary.stoppedReason = archiveRes.status === 404 ? 'empty-page' : 'http-error';
      log(
        `[crawler:${opts.category}] page ${page} returned ${archiveRes.status}; stopping`,
      );
      break;
    }
    summary.pagesFetched++;
    const archiveHtml = await archiveRes.text();
    if (delayMs > 0) await sleep(delayMs);

    const allUrls = extractPostUrls(archiveHtml);
    if (allUrls.length === 0) {
      summary.stoppedReason = 'empty-page';
      log(`[crawler:${opts.category}] page ${page} had no post URLs; stopping`);
      break;
    }

    let newOnPage = 0;
    for (const postUrl of allUrls) {
      summary.postsSeen++;
      const postId = postIdFromUrl(postUrl);

      if (opts.category !== 'scoreboard' && isGirlsSlug(postId)) {
        summary.postsSkippedGirls++;
        continue;
      }

      const existing = await cache.get(postId);
      if (existing) {
        summary.postsAlreadyCached++;
        continue;
      }

      const postRes = await fetch(postUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!postRes.ok) {
        log(
          `[crawler:${opts.category}] post ${postUrl} returned ${postRes.status}; skipping`,
        );
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }
      const html = await postRes.text();
      const written = await writeRawHtml(cacheDir, postId, html);
      const meta: RawCacheMeta = {
        postId,
        url: postUrl,
        fetchedAt: now().toISOString(),
        contentSha256: written.contentSha256 || sha256(html),
      };
      await cache.upsert(meta);
      summary.postsFetched++;
      newOnPage++;
      if (delayMs > 0) await sleep(delayMs);
    }

    // Stop condition: every URL on the page was already cached AND the
    // watermark exists (we've ingested before — older pages will be older).
    if (newOnPage === 0 && watermark !== undefined && !opts.ignoreWatermark) {
      summary.stoppedReason = 'no-new-posts';
      log(
        `[crawler:${opts.category}] page ${page} fully cached; stopping (watermark ${watermark})`,
      );
      break;
    }
  }

  return summary;
}

export async function crawlAll(
  categories: readonly Category[],
  options: { maxPages?: number; ignoreWatermark?: boolean },
  deps: CrawlerDeps,
): Promise<CrawlSummary[]> {
  // Concurrency = 1 per category, parallel across categories.
  const tasks = categories.map((category) =>
    crawlCategory(
      {
        category,
        maxPages: options.maxPages,
        ignoreWatermark: options.ignoreWatermark,
      },
      deps,
    ),
  );
  return Promise.all(tasks);
}

/** Default cache directory: <repo-root>/data/raw-cache. */
export function defaultCacheDir(repoRoot: string): string {
  return path.join(repoRoot, 'data', 'raw-cache');
}
