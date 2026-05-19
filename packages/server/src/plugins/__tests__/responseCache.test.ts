import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import responseCache, { cacheable } from '../responseCache.js';

let app: FastifyInstance;
let counter = 0;

beforeEach(async () => {
  counter = 0;
  app = Fastify();
  await app.register(responseCache, { ttlMs: 50, maxAgeSeconds: 60 });
  app.get('/cached', cacheable, async () => ({ value: ++counter }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('responseCache plugin', () => {
  it('returns x-cache MISS on the first request', async () => {
    const res = await app.inject({ method: 'GET', url: '/cached' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('returns x-cache HIT on the second identical request', async () => {
    const first = await app.inject({ method: 'GET', url: '/cached' });
    const second = await app.inject({ method: 'GET', url: '/cached' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body).toBe(first.body);
  });

  it('returns 304 for a matching If-None-Match header', async () => {
    const first = await app.inject({ method: 'GET', url: '/cached' });
    const etag = String(first.headers.etag);

    const second = await app.inject({
      method: 'GET',
      url: '/cached',
      headers: { 'if-none-match': etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.headers.etag).toBe(etag);
    expect(second.body).toBe('');
  });

  it('expires entries after the TTL', async () => {
    const first = await app.inject({ method: 'GET', url: '/cached' });
    await new Promise((resolve) => setTimeout(resolve, 70));
    const second = await app.inject({ method: 'GET', url: '/cached' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-cache']).toBe('MISS');
    expect(second.json()).toEqual({ value: 2 });
  });
});
