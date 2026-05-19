import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';

interface CacheEntry {
  etag: string;
  body: string;
  contentType: string;
  cachedAt: number;
}

interface ResponseCacheRouteConfig {
  cacheable?: boolean;
}

export interface ResponseCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  maxAgeSeconds?: number;
}

export const cacheable: RouteShorthandOptions = {
  config: {
    responseCache: {
      cacheable: true,
    },
  },
};

declare module 'fastify' {
  interface FastifyContextConfig {
    responseCache?: ResponseCacheRouteConfig;
  }

  interface FastifyRequest {
    _responseCacheKey?: string;
    _responseCacheServed?: boolean;
  }
}

function isCacheableRequest(request: FastifyRequest): boolean {
  if (request.method !== 'GET') return false;
  if (request.headers.authorization !== undefined) return false;
  return request.routeOptions.config.responseCache?.cacheable === true;
}

function createEtag(body: string): string {
  return `"${createHash('md5').update(body).digest('hex')}"`;
}

function getBody(payload: string | Buffer): string {
  return typeof payload === 'string' ? payload : payload.toString('utf8');
}

const responseCache = fp<ResponseCacheOptions>(
  async (app: FastifyInstance, opts: ResponseCacheOptions = {}) => {
    const cache = new LRUCache<string, CacheEntry>({
      max: opts.maxEntries ?? 200,
      ttl: opts.ttlMs ?? 60_000,
    });
    const cacheControl = `public, max-age=${opts.maxAgeSeconds ?? 60}`;

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isCacheableRequest(request)) return;

      const cacheKey = request.url;
      request._responseCacheKey = cacheKey;

      const hit = cache.get(cacheKey);
      if (!hit) return;

      request._responseCacheServed = true;
      reply.header('x-cache', 'HIT');
      reply.header('ETag', hit.etag);
      reply.header('Cache-Control', cacheControl);

      if (request.headers['if-none-match'] === hit.etag) {
        return reply.code(304).send();
      }

      reply.header('Content-Type', hit.contentType);
      return reply.send(hit.body);
    });

    app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
      if (request._responseCacheServed) return payload;
      if (!request._responseCacheKey) return payload;
      if (reply.statusCode !== 200) return payload;
      if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;

      const body = getBody(payload);
      const contentType = String(reply.getHeader('content-type') ?? 'application/json; charset=utf-8');
      const etag = createEtag(body);

      cache.set(request._responseCacheKey, {
        etag,
        body,
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
