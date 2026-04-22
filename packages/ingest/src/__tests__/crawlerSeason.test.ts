// Wave 13 Lane 2 — season-aware crawler + season derivation tests.

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as url from 'node:url';
import { promises as fs } from 'node:fs';
import {
  crawlCategory,
  extractPostUrls,
  postHrefRegex,
  seasonFromUrl,
  categoryUrl,
  type FetchFn,
  type FetchResponseLike,
} from '../crawler.js';
import { InMemoryCacheStore } from '../cache.js';

function ok(body: string): FetchResponseLike {
  return { ok: true, status: 200, text: async () => body };
}
function notFound(): FetchResponseLike {
  return { ok: false, status: 404, text: async () => '' };
}
function archive(urls: string[]): string {
  return `<html><body>${urls.map((u) => `<a href="${u}">x</a>`).join('\n')}</body></html>`;
}

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SCRATCH_ROOT = path.resolve(HERE, '..', '..', '.test-scratch');

describe('seasonFromUrl', () => {
  it('extracts 4-digit year from /YYYY/ in phillylacrosse URL paths', () => {
    expect(seasonFromUrl('https://phillylacrosse.com/2024/some-post/')).toBe(2024);
    expect(seasonFromUrl('https://phillylacrosse.com/2025/another/')).toBe(2025);
    expect(seasonFromUrl('https://phillylacrosse.com/2026/x/')).toBe(2026);
  });
  it('returns undefined when no year segment exists', () => {
    expect(seasonFromUrl('https://phillylacrosse.com/about/')).toBeUndefined();
    expect(seasonFromUrl('https://phillylacrosse.com/category/scoreboard/')).toBeUndefined();
  });
});

describe('postHrefRegex / extractPostUrls — per-season filtering', () => {
  it('postHrefRegex(2024) only matches /2024/ post URLs', () => {
    const re = postHrefRegex(2024);
    expect(re.test('https://phillylacrosse.com/2024/post-a/')).toBe(true);
    expect(re.test('https://phillylacrosse.com/2026/post-a/')).toBe(false);
  });

  it('extractPostUrls(html, 2025) only keeps /2025/ posts', () => {
    const html = `
      <a href="https://phillylacrosse.com/2024/old-post/">a</a>
      <a href="https://phillylacrosse.com/2025/spring-1/">b</a>
      <a href="https://phillylacrosse.com/2025/spring-2/">c</a>
      <a href="https://phillylacrosse.com/2026/new/">d</a>
    `;
    expect(extractPostUrls(html, 2025)).toEqual([
      'https://phillylacrosse.com/2025/spring-1/',
      'https://phillylacrosse.com/2025/spring-2/',
    ]);
  });
});

describe('crawlCategory — season-aware idempotency', () => {
  it('uses a per-season watermark so 2024 backfill does not block 2026', async () => {
    const cache = new InMemoryCacheStore();
    const tmpDir = path.join(SCRATCH_ROOT, `crawler-season-${process.pid}-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Pre-populate a 2026 post in the cache so the 2026 watermark exists.
    await cache.upsert({
      postId: 'live-2026',
      url: 'https://phillylacrosse.com/2026/live-2026/',
      fetchedAt: '2026-04-22T00:00:00.000Z',
      contentSha256: 'h',
    });

    // Now crawl scoreboard for season=2024. The watermark for 2024 should be
    // *empty*, so we must NOT short-circuit on the all-cached-zero-new check.
    const post24 = 'https://phillylacrosse.com/2024/old-post/';
    const responses = new Map<string, FetchResponseLike>([
      [categoryUrl('scoreboard', 1), ok(archive([post24]))],
      [post24, ok('<html>old</html>')],
      [categoryUrl('scoreboard', 2), notFound()],
    ]);
    const fetchFn: FetchFn = async (u) => {
      const r = responses.get(u);
      if (!r) throw new Error(`unexpected fetch ${u}`);
      return r;
    };
    const summary = await crawlCategory(
      { category: 'scoreboard', maxPages: 5, season: 2024 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(summary.season).toBe(2024);
    expect(summary.postsFetched).toBe(1);
    // Re-running the same crawl should now stop on the 2024 watermark.
    const second = await crawlCategory(
      { category: 'scoreboard', maxPages: 5, season: 2024 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(second.postsFetched).toBe(0);
    expect(second.stoppedReason).toBe('no-new-posts');

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('default season (no opts.season) preserves the W12 2026-only behavior', async () => {
    const cache = new InMemoryCacheStore();
    const tmpDir = path.join(SCRATCH_ROOT, `crawler-default-${process.pid}-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const post26 = 'https://phillylacrosse.com/2026/x/';
    const post24 = 'https://phillylacrosse.com/2024/y/';
    const responses = new Map<string, FetchResponseLike>([
      [categoryUrl('scoreboard', 1), ok(archive([post24, post26]))],
      [post26, ok('<html>26</html>')],
      [categoryUrl('scoreboard', 2), notFound()],
    ]);
    const fetchFn: FetchFn = async (u) => {
      const r = responses.get(u);
      if (!r) throw new Error(`unexpected fetch ${u}`);
      return r;
    };
    const summary = await crawlCategory(
      { category: 'scoreboard', maxPages: 5 }, // no season → defaults to 2026
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(summary.season).toBe(2026);
    expect(summary.postsFetched).toBe(1); // 2024 link filtered out
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
