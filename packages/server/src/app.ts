// buildApp(db) — pure factory so tests can pass a :memory: DB.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { Database } from 'better-sqlite3';
import type { Logger } from '@pll/shared';

import { healthRoutes } from './routes/health.js';
import { teamsRoutes } from './routes/teams.js';
import { gamesRoutes } from './routes/games.js';
import { playersRoutes } from './routes/players.js';
import { rankingsRoutes } from './routes/rankings.js';
import { anomaliesRoutes } from './routes/anomalies.js';
import { leadersRoutes } from './routes/leaders.js';
import { leaderSparklinesRoutes } from './routes/leaderSparklines.js';
import { piaaRoutes } from './routes/piaa.js';
import { rivalriesRoutes } from './routes/rivalries.js';
import { h2hRoutes } from './routes/h2h.js';
import { seasonsRoutes } from './routes/seasons.js';
import { constellationRoutes } from './routes/constellation.js';
import { scheduleRoutes } from './routes/schedule.js';
import { freshnessRoutes } from './routes/freshness.js';
import { postImagesRoutes } from './routes/postImages.js';
import { searchRoutes } from './routes/search.js';
import { comparePlayersRoutes } from './routes/comparePlayers.js';
import { responseCachePlugin, type ResponseCacheOptions } from './plugins/responseCache.js';

export interface BuildOptions {
  /** A pino logger instance (preferred), or `true` to enable Fastify's
   *  default pino, or `false`/undefined to disable. */
  logger?: Logger | boolean;
  logosDir?: string;
  responseCache?: ResponseCacheOptions | false;
}

// Routes that opt into the in-memory response cache + ETag/Cache-Control.
// See docs/improvements/03-api-response-cache-and-http-caching.md.
// MUST NOT include /api/health or /api/freshness — those communicate
// snapshot/deploy state and need to bypass the cache.
const CACHED_ROUTES: readonly string[] = [
  '/api/teams',
  '/api/games',
  '/api/leaders/players',
  '/api/leaders/teams',
];

// Resolve the default logos directory the same way index.ts resolves the DB:
// relative to the repo root (../../.. from packages/server/src/).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_LOGOS_DIR = path.join(REPO_ROOT, 'data', 'logos');

export async function buildApp(db: Database, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  const corsOriginsEnv = process.env.CORS_ORIGINS?.trim();
  const corsOrigins = corsOriginsEnv
    ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5173'];

  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'OPTIONS'],
  });

  if (opts.responseCache !== false) {
    await app.register(responseCachePlugin, opts.responseCache ?? {});
    for (const routeId of CACHED_ROUTES) app.cacheRoute(routeId);
  }

  await app.register(fastifyStatic, {
    root: opts.logosDir ?? DEFAULT_LOGOS_DIR,
    prefix: '/logos/',
    index: false,
    list: false,
    decorateReply: false,
    cacheControl: true,
    maxAge: 31536000000,
    immutable: true,
  });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const message = err instanceof Error ? err.message : 'unexpected error';
    reply.code(500).send({ error: 'InternalServerError', message });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'NotFound', message: 'Route not found' });
  });

  await healthRoutes(app, db);
  await teamsRoutes(app, db);
  await gamesRoutes(app, db);
  await playersRoutes(app, db);
  await rankingsRoutes(app, db);
  await anomaliesRoutes(app, db);
  await leadersRoutes(app, db);
  await leaderSparklinesRoutes(app, db);
  await piaaRoutes(app, db);
  await rivalriesRoutes(app, db);
  await h2hRoutes(app, db);
  await seasonsRoutes(app, db);
  await constellationRoutes(app, db);
  await scheduleRoutes(app, db);
  await freshnessRoutes(app, db);
  await postImagesRoutes(app, db);
  await searchRoutes(app, db);
  await comparePlayersRoutes(app, db);

  return app;
}
