import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

interface CacheEntry {
  etag: string;
  body: string;
  contentType: string;
  cachedAt: number;
}

export interface ResponseCacheOptions {
  includePrefixes?: string[];
  excludePrefixes?: string[];
  maxEntries?: number;
  ttlMs?: number;
  maxAgeSeconds?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    _responseCacheKey?: string;
    _responseCacheServed?: boolean;
  }
}

function shouldCacheRoute(
  routeUrl: string,
  includePrefixes: readonly string[],
  excludePrefixes: readonly string[],
): boolean {
  if (excludePrefixes.some((prefix) => routeUrl.startsWith(prefix))) return false;
  return includePrefixes.some((prefix) => routeUrl.startsWith(prefix));
}

function createEtag(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

const responseCache = fp<ResponseCacheOptions>(
  async (app: FastifyInstance, opts: ResponseCacheOptions = {}) => {
    const cache = new LRUCache<string, CacheEntry>({
      max: opts.maxEntries ?? 500,
      ttl: opts.ttlMs ?? 60_000,
    });
    const includePrefixes = opts.includePrefixes ?? [];
    const excludePrefixes = opts.excludePrefixes ?? [];
    const cacheControl = `public, max-age=${opts.maxAgeSeconds ?? 60}`;

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method !== 'GET') return;

      const routeUrl = request.routeOptions.url;
      if (!routeUrl) return;
      if (!shouldCacheRoute(routeUrl, includePrefixes, excludePrefixes)) return;

      const cacheKey = `${routeUrl}::${request.url}`;
      request._responseCacheKey = cacheKey;

      const hit = cache.get(cacheKey);
      if (!hit) return;

      reply.header('x-cache', 'HIT');
      reply.header('ETag', hit.etag);
      reply.header('Cache-Control', cacheControl);

      if (request.headers['if-none-match'] === hit.etag) {
        request._responseCacheServed = true;
        return reply.code(304).send();
      }

      request._responseCacheServed = true;
      reply.header('Content-Type', hit.contentType);
      return reply.send(hit.body);
    });

    app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
      if (request._responseCacheServed) return payload;
      if (!request._responseCacheKey) return payload;
      if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
      if (typeof payload !== 'string') return payload;

      const contentType = String(reply.getHeader('content-type') ?? 'application/json; charset=utf-8');
      const etag = createEtag(payload);

      cache.set(request._responseCacheKey, {
        etag,
        body: payload,
        contentType,
        cachedAt: Date.now(),
      });

      reply.header('x-cache', 'MISS');
      reply.header('ETag', etag);
      reply.header('Cache-Control', cacheControl);

      return payload;
    });
  },
  { name: 'pll-response-cache', fastify: '5.x' },
) as FastifyPluginAsync<ResponseCacheOptions>;

export default responseCache;
