import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as path from 'node:path';
import * as url from 'node:url';
import { promises as fs } from 'node:fs';
import {
  crawlCategory,
  extractPostUrls,
  isGirlsSlug,
  categoryUrl,
  type FetchFn,
  type FetchResponseLike,
} from '../crawler.js';
import { InMemoryCacheStore, postIdFromUrl, sha256 } from '../cache.js';

function ok(body: string): FetchResponseLike {
  return { ok: true, status: 200, text: async () => body };
}
function notFound(): FetchResponseLike {
  return { ok: false, status: 404, text: async () => '' };
}

function archive(urls: string[]): string {
  return `<html><body>${urls
    .map((u) => `<a href="${u}">post</a>`)
    .join('\n')}</body></html>`;
}

// Use a scratch dir inside the package (not /tmp) per repo rules.
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SCRATCH_ROOT = path.resolve(HERE, '..', '..', '.test-scratch');
let tmpDir: string;
let counter = 0;
beforeEach(async () => {
  await fs.mkdir(SCRATCH_ROOT, { recursive: true });
  tmpDir = path.join(SCRATCH_ROOT, `crawler-${process.pid}-${++counter}`);
  await fs.mkdir(tmpDir, { recursive: true });
});
afterAll(async () => {
  await fs.rm(SCRATCH_ROOT, { recursive: true, force: true });
});

describe('extractPostUrls', () => {
  it('keeps only /2026/<slug>/ post URLs and dedupes', () => {
    const html = `
      <a href="https://phillylacrosse.com/2026/post-a/">a</a>
      <a href="https://phillylacrosse.com/2026/post-a/">a-dup</a>
      <a href="https://phillylacrosse.com/2026/post-b">b-no-slash</a>
      <a href="https://phillylacrosse.com/category/scoreboard/page/2/">archive</a>
      <a href="https://phillylacrosse.com/about/">about</a>
      <a href="https://other.com/2026/post-c/">other-domain</a>
    `;
    expect(extractPostUrls(html)).toEqual([
      'https://phillylacrosse.com/2026/post-a/',
      'https://phillylacrosse.com/2026/post-b/',
    ]);
  });
});

describe('isGirlsSlug', () => {
  it.each([
    ['tuesday-girls-summaries-1', true],
    ['girls-pa-rankings-week-3', true],
    ['womens-college-recap', true],
    ['boys-summaries-1', false],
    ['phillylacrosse-boys-rankings-23', false],
    ['scoreboard-sponsored-by-x', false],
  ])('isGirlsSlug(%s) -> %s', (slug, expected) => {
    expect(isGirlsSlug(slug)).toBe(expected);
  });
});

describe('postIdFromUrl', () => {
  it('returns the last path segment', () => {
    expect(
      postIdFromUrl('https://phillylacrosse.com/2026/some-cool-post/'),
    ).toBe('some-cool-post');
    expect(
      postIdFromUrl('https://phillylacrosse.com/2026/another-post'),
    ).toBe('another-post');
  });
});

describe('crawlCategory', () => {
  it('fetches archive then each new post and writes html + meta', async () => {
    const cache = new InMemoryCacheStore();
    const postA = 'https://phillylacrosse.com/2026/post-a/';
    const postB = 'https://phillylacrosse.com/2026/post-b/';
    const responses = new Map<string, FetchResponseLike>([
      [categoryUrl('scoreboard', 1), ok(archive([postA, postB]))],
      [postA, ok('<html>A</html>')],
      [postB, ok('<html>B</html>')],
      [categoryUrl('scoreboard', 2), notFound()],
    ]);
    const fetched: string[] = [];
    const fetchFn: FetchFn = async (u) => {
      fetched.push(u);
      const r = responses.get(u);
      if (!r) throw new Error(`unexpected fetch ${u}`);
      return r;
    };

    const summary = await crawlCategory(
      { category: 'scoreboard', maxPages: 5 },
      {
        fetch: fetchFn,
        cache,
        cacheDir: tmpDir,
        delayMs: 0,
        now: () => new Date('2026-04-22T12:00:00Z'),
      },
    );

    expect(summary.pagesFetched).toBe(1);
    expect(summary.postsFetched).toBe(2);
    expect(summary.postsSeen).toBe(2);
    expect(summary.stoppedReason).toBe('empty-page');

    expect(await fs.readFile(path.join(tmpDir, 'post-a.html'), 'utf8')).toBe(
      '<html>A</html>',
    );
    expect(await fs.readFile(path.join(tmpDir, 'post-b.html'), 'utf8')).toBe(
      '<html>B</html>',
    );
    const rows = cache.all();
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.postId === 'post-a')!;
    expect(a.url).toBe(postA);
    expect(a.fetchedAt).toBe('2026-04-22T12:00:00.000Z');
    expect(a.contentSha256).toBe(sha256('<html>A</html>'));
  });

  it('skips girls slugs in non-scoreboard categories', async () => {
    const cache = new InMemoryCacheStore();
    const boysUrl = 'https://phillylacrosse.com/2026/boys-summaries-1/';
    const girlsUrl = 'https://phillylacrosse.com/2026/girls-summaries-1/';
    const responses = new Map<string, FetchResponseLike>([
      [categoryUrl('hs-summaries', 1), ok(archive([boysUrl, girlsUrl]))],
      [boysUrl, ok('<html>boys</html>')],
      [categoryUrl('hs-summaries', 2), notFound()],
    ]);
    const fetched: string[] = [];
    const fetchFn: FetchFn = async (u) => {
      fetched.push(u);
      const r = responses.get(u);
      if (!r) throw new Error(`unexpected fetch ${u}`);
      return r;
    };

    const summary = await crawlCategory(
      { category: 'hs-summaries', maxPages: 5 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );

    expect(summary.postsFetched).toBe(1);
    expect(summary.postsSkippedGirls).toBe(1);
    expect(fetched).not.toContain(girlsUrl);
  });

  it('keeps girls slugs in scoreboard category (mixed-gender posts)', async () => {
    const cache = new InMemoryCacheStore();
    // Scoreboard slugs do not contain "girls" but exercise the carve-out.
    const mixedUrl = 'https://phillylacrosse.com/2026/girls-and-boys-scoreboard/';
    const responses = new Map<string, FetchResponseLike>([
      [categoryUrl('scoreboard', 1), ok(archive([mixedUrl]))],
      [mixedUrl, ok('<html>mixed</html>')],
      [categoryUrl('scoreboard', 2), notFound()],
    ]);
    const fetchFn: FetchFn = async (u) => {
      const r = responses.get(u);
      if (!r) throw new Error(`unexpected fetch ${u}`);
      return r;
    };
    const summary = await crawlCategory(
      { category: 'scoreboard', maxPages: 5 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(summary.postsSkippedGirls).toBe(0);
    expect(summary.postsFetched).toBe(1);
  });

  it('stops at maxPages', async () => {
    const cache = new InMemoryCacheStore();
    let pageRequests = 0;
    const fetchFn: FetchFn = async (u) => {
      if (u.includes('/page/')) {
        pageRequests++;
        const slug = `post-page-${pageRequests}`;
        return ok(archive([`https://phillylacrosse.com/2026/${slug}/`]));
      }
      return ok(`<html>${u}</html>`);
    };

    const summary = await crawlCategory(
      { category: 'rankings', maxPages: 2 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(summary.pagesFetched).toBe(2);
    expect(summary.stoppedReason).toBe('max-pages');
    expect(summary.postsFetched).toBe(2);
  });

  it('stops when a page is fully cached and watermark exists', async () => {
    const cache = new InMemoryCacheStore();
    const postA = 'https://phillylacrosse.com/2026/post-a/';
    // Pre-populate cache so post-a is "already cached" and a watermark exists.
    await cache.upsert({
      postId: 'post-a',
      url: postA,
      fetchedAt: '2026-04-20T00:00:00.000Z',
      contentSha256: 'abc',
    });
    let page2Visited = false;
    const fetchFn: FetchFn = async (u) => {
      if (u === categoryUrl('rankings', 1)) return ok(archive([postA]));
      if (u === categoryUrl('rankings', 2)) {
        page2Visited = true;
        return ok(archive([postA]));
      }
      throw new Error(`unexpected fetch ${u}`);
    };
    const summary = await crawlCategory(
      { category: 'rankings', maxPages: 5 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(summary.stoppedReason).toBe('no-new-posts');
    expect(summary.postsFetched).toBe(0);
    expect(summary.postsAlreadyCached).toBe(1);
    expect(summary.pagesFetched).toBe(1);
    expect(page2Visited).toBe(false);
  });

  it('is idempotent: re-running yields zero new fetches', async () => {
    const cache = new InMemoryCacheStore();
    const postA = 'https://phillylacrosse.com/2026/post-a/';
    const responses = new Map<string, FetchResponseLike>([
      [categoryUrl('scoreboard', 1), ok(archive([postA]))],
      [postA, ok('<html>A</html>')],
      [categoryUrl('scoreboard', 2), notFound()],
    ]);
    const fetchFn: FetchFn = async (u) => {
      const r = responses.get(u);
      if (!r) throw new Error(`unexpected fetch ${u}`);
      return r;
    };
    const first = await crawlCategory(
      { category: 'scoreboard', maxPages: 5 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(first.postsFetched).toBe(1);
    const second = await crawlCategory(
      { category: 'scoreboard', maxPages: 5 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(second.postsFetched).toBe(0);
    expect(second.postsAlreadyCached).toBe(1);
    expect(second.stoppedReason).toBe('no-new-posts');
  });

  it('treats 404 on first archive page as empty-page and stops', async () => {
    const cache = new InMemoryCacheStore();
    const fetchFn: FetchFn = async () => notFound();
    const summary = await crawlCategory(
      { category: 'scoreboard', maxPages: 5 },
      { fetch: fetchFn, cache, cacheDir: tmpDir, delayMs: 0 },
    );
    expect(summary.pagesFetched).toBe(0);
    expect(summary.stoppedReason).toBe('empty-page');
  });
});
