// In-memory LRU response cache for read-only GET routes.
//
// Per RFC 03 (docs/improvements/03-api-response-cache-and-http-caching.md):
//   - Route opts in via `app.cacheRoute(routeId)`; the plugin then matches
//     incoming requests against the registered set.
//   - Cache key = `${snapshotEpoch}::${routeId}::${sortedQueryString}`.
//   - On cache hit: serve cached body, set `x-cache: HIT`, ETag, Cache-Control.
//   - On `If-None-Match` matching the cached etag: 304 Not Modified.
//   - On miss: capture the serialised JSON in onSend, store, set headers.
//   - The snapshot epoch is mixed into both key and etag, so a new DB snapshot
//     atomically invalidates every entry without a manual flush.

import crypto from 'node:crypto';
import { LRUCache } from 'lru-cache';
import fp from 'fastify-plugin';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { getSnapshotEpoch } from '../snapshot.js';

interface CacheEntry {
  etag: string;
  body: string;
  contentType: string;
  cachedAt: number;
  epoch: string;
}

export interface ResponseCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  maxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    cacheRoute(routeId: string): void;
    clearResponseCache(): void;
  }
  interface FastifyRequest {
    _cacheRouteId?: string;
    _cacheKey?: string;
    _cacheEpoch?: string;
  }
}

function sortedQueryString(query: unknown): string {
  if (!query || typeof query !== 'object') return '';
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      for (const item of v) entries.push([k, String(item)]);
    } else if (v !== undefined && v !== null) {
      entries.push([k, String(v)]);
    }
  }
  entries.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.append(k, v);
  return sp.toString();
}

function computeEtag(epoch: string, body: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(epoch)
    .update('::')
    .update(body)
    .digest('hex')
    .slice(0, 16);
  return `W/"${hash}"`;
}

function buildCacheControl(maxAge: number, swr: number): string {
  return `public, max-age=${maxAge}, must-revalidate, stale-while-revalidate=${swr}`;
}

export const responseCachePlugin = fp<ResponseCacheOptions>(
  async (app: FastifyInstance, opts: ResponseCacheOptions = {}) => {
    const maxEntries = opts.maxEntries ?? 500;
    const ttlMs = opts.ttlMs ?? 60_000;
    const maxAgeSeconds = opts.maxAgeSeconds ?? 30;
    const swrSeconds = opts.staleWhileRevalidateSeconds ?? 300;
    const cacheControl = buildCacheControl(maxAgeSeconds, swrSeconds);

    const cache = new LRUCache<string, CacheEntry>({ max: maxEntries, ttl: ttlMs });
    const enabledRoutes = new Set<string>();

    app.decorate('cacheRoute', (routeId: string) => {
      enabledRoutes.add(routeId);
    });

    app.decorate('clearResponseCache', () => {
      cache.clear();
    });

    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.method !== 'GET') return;
      const routeId = req.routeOptions?.url;
      if (!routeId || !enabledRoutes.has(routeId)) return;

      const epoch = getSnapshotEpoch();
      const key = `${epoch}::${routeId}::${sortedQueryString(req.query)}`;
      req._cacheRouteId = routeId;
      req._cacheKey = key;
      req._cacheEpoch = epoch;

      const hit = cache.get(key);
      if (!hit) return;

      const ifNoneMatch = req.headers['if-none-match'];
      void reply.header('ETag', hit.etag);
      void reply.header('Cache-Control', cacheControl);
      void reply.header('Vary', 'Accept-Encoding');
      if (typeof ifNoneMatch === 'string' && ifNoneMatch === hit.etag) {
        void reply.header('x-cache', 'HIT-304');
        return reply.code(304).send();
      }
      void reply.header('x-cache', 'HIT');
      void reply.header('Content-Type', hit.contentType);
      return reply.send(hit.body);
    });

    app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
      const key = req._cacheKey;
      const epoch = req._cacheEpoch;
      if (!key || !epoch) return payload;
      if (reply.statusCode !== 200) return payload;
      const existingXCache = reply.getHeader('x-cache');
      if (existingXCache === 'HIT' || existingXCache === 'HIT-304') return payload;
      if (typeof payload !== 'string') return payload;

      const contentType =
        (reply.getHeader('content-type') as string | undefined) ??
        'application/json; charset=utf-8';
      const etag = computeEtag(epoch, payload);
      cache.set(key, {
        etag,
        body: payload,
        contentType,
        cachedAt: Date.now(),
        epoch,
      });

      void reply.header('ETag', etag);
      void reply.header('Cache-Control', cacheControl);
      void reply.header('Vary', 'Accept-Encoding');
      void reply.header('x-cache', 'MISS');

      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
        void reply.code(304);
        void reply.header('x-cache', 'MISS-304');
        return '';
      }

      return payload;
    });
  },
  { name: 'pll-response-cache', fastify: '5.x' },
) as FastifyPluginAsync<ResponseCacheOptions>;

export default responseCachePlugin;
