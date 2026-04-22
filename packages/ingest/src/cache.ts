import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { RawCacheMeta } from '@pll/shared';

/**
 * Storage abstraction for raw HTML cache. The crawler depends on this interface
 * so it can be unit-tested without a real DB. The production wiring uses the
 * SQLite-backed implementation below; tests pass an in-memory fake.
 */
export interface CacheStore {
  /** Look up cache metadata by post id. Returns undefined if not cached. */
  get(postId: string): Promise<RawCacheMeta | undefined>;
  /** Upsert cache metadata. */
  upsert(meta: RawCacheMeta): Promise<void>;
  /** Latest fetched_at for posts whose URL starts with the given prefix. */
  latestFetchedAt(urlPrefix: string): Promise<string | undefined>;
}

export interface CacheWriteResult {
  postId: string;
  filePath: string;
  contentSha256: string;
}

/** Compute SHA-256 of a string, hex-encoded. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Derive a stable post id from a post URL.
 *
 * Examples:
 *   https://phillylacrosse.com/2026/foo-bar-baz/   -> "foo-bar-baz"
 *   https://phillylacrosse.com/2026/foo-bar-baz    -> "foo-bar-baz"
 *
 * The slug is the last non-empty path segment.
 */
export function postIdFromUrl(url: string): string {
  const u = new URL(url);
  const segments = u.pathname.split('/').filter((s) => s.length > 0);
  const slug = segments[segments.length - 1];
  if (!slug) {
    throw new Error(`Cannot derive post id from URL: ${url}`);
  }
  return slug;
}

/**
 * Write raw HTML to disk under data/raw-cache/<post-id>.html.
 * Returns the absolute file path and content hash.
 */
export async function writeRawHtml(
  cacheDir: string,
  postId: string,
  html: string,
): Promise<CacheWriteResult> {
  await fs.mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, `${postId}.html`);
  await fs.writeFile(filePath, html, 'utf8');
  return {
    postId,
    filePath,
    contentSha256: sha256(html),
  };
}

/**
 * In-memory CacheStore used for tests and as a fallback when no DB is wired in.
 */
export class InMemoryCacheStore implements CacheStore {
  private readonly rows = new Map<string, RawCacheMeta>();

  async get(postId: string): Promise<RawCacheMeta | undefined> {
    return this.rows.get(postId);
  }

  async upsert(meta: RawCacheMeta): Promise<void> {
    this.rows.set(meta.postId, meta);
  }

  async latestFetchedAt(urlPrefix: string): Promise<string | undefined> {
    let max: string | undefined;
    for (const row of this.rows.values()) {
      if (!row.url.startsWith(urlPrefix)) continue;
      if (max === undefined || row.fetchedAt > max) max = row.fetchedAt;
    }
    return max;
  }

  /** Test helper: synchronous snapshot of all rows. */
  all(): RawCacheMeta[] {
    return Array.from(this.rows.values());
  }
}

/**
 * SQLite-backed CacheStore. Lazily imports the shared `db` module so the
 * crawler module can be loaded (and unit-tested) even when better-sqlite3 isn't
 * available or Han hasn't wired the schema yet.
 *
 * The expected schema (owned by Han) is:
 *   CREATE TABLE raw_cache_meta (
 *     post_id          TEXT PRIMARY KEY,
 *     url              TEXT NOT NULL,
 *     fetched_at       TEXT NOT NULL,
 *     content_sha256   TEXT NOT NULL
 *   );
 */
export class SqliteCacheStore implements CacheStore {
  // Untyped to avoid a hard compile-time dep on better-sqlite3 typings here;
  // the real type is `import('better-sqlite3').Database`.
  private readonly db: {
    prepare: (sql: string) => {
      get: (...params: unknown[]) => unknown;
      run: (...params: unknown[]) => unknown;
    };
  };

  constructor(db: SqliteCacheStore['db']) {
    this.db = db;
  }

  async get(postId: string): Promise<RawCacheMeta | undefined> {
    const row = this.db
      .prepare(
        'SELECT post_id as postId, url, fetched_at as fetchedAt, content_sha256 as contentSha256 FROM raw_cache_meta WHERE post_id = ?',
      )
      .get(postId) as RawCacheMeta | undefined;
    return row;
  }

  async upsert(meta: RawCacheMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO raw_cache_meta (post_id, url, fetched_at, content_sha256)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(post_id) DO UPDATE SET
           url = excluded.url,
           fetched_at = excluded.fetched_at,
           content_sha256 = excluded.content_sha256`,
      )
      .run(meta.postId, meta.url, meta.fetchedAt, meta.contentSha256);
  }

  async latestFetchedAt(urlPrefix: string): Promise<string | undefined> {
    const row = this.db
      .prepare(
        'SELECT MAX(fetched_at) as max FROM raw_cache_meta WHERE url LIKE ?',
      )
      .get(`${urlPrefix}%`) as { max: string | null } | undefined;
    return row?.max ?? undefined;
  }
}
