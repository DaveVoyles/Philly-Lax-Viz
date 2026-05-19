// buildApp(db) — pure factory so tests can pass a :memory: DB.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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
import { coachDashboardRoutes } from './routes/coachDashboard.js';
import { commitmentsRoutes } from './routes/commitments.js';
import correctionsRoutes from './routes/corrections.js';
import uploadRoutes from './routes/upload.js';
import adminDedupRoutes from './routes/adminDedup.js';
import hudlRoutes from './routes/hudl.js';
import responseCache, { type ResponseCacheOptions } from './plugins/responseCache.js';

export interface BuildOptions {
  /** A pino logger instance (preferred), or `true` to enable Fastify's
   *  default pino, or `false`/undefined to disable. */
  logger?: Logger | boolean;
  logosDir?: string;
  responseCache?: ResponseCacheOptions | false;
}

const CACHED_ROUTE_PREFIXES: readonly string[] = [
  '/api/leaders',
  '/api/teams',
  '/api/games',
  '/api/rankings',
  '/api/h2h',
  '/api/constellation',
  '/api/schedule',
  '/api/sources',
];

const UNCACHED_ROUTE_PREFIXES: readonly string[] = [
  '/api/corrections',
  '/api/upload',
  '/api/health',
];

// Resolve the default logos directory the same way index.ts resolves the DB:
// relative to the repo root (../../.. from packages/server/src/).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_LOGOS_DIR = path.join(REPO_ROOT, 'data', 'logos');

export async function buildApp(db: Database, opts: BuildOptions = {}): Promise<FastifyInstance> {
  // Fastify v5 API: pre-built pino instances go on `loggerInstance`; the
  // `logger` option only accepts boolean or a config object. Passing a
  // pino instance via `logger` throws FST_ERR_LOG_INVALID_LOGGER_CONFIG.
  // The cast keeps FastifyInstance's default logger generic so route types
  // throughout the app stay homogenous (pino.Logger is structurally a
  // superset of FastifyBaseLogger but TS's generic inference makes them
  // appear incompatible at the route layer).
  const loggerOpt = opts.logger;
  const app: FastifyInstance =
    loggerOpt && typeof loggerOpt === 'object'
      ? (Fastify({ loggerInstance: loggerOpt as never }) as unknown as FastifyInstance)
      : Fastify({ logger: loggerOpt ?? false });

  const corsOriginsEnv = process.env.CORS_ORIGINS?.trim();
  const corsOrigins = corsOriginsEnv
    ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5173'];

  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024,
    },
  });

  if (opts.responseCache !== false) {
    await app.register(responseCache, {
      includePrefixes: [...CACHED_ROUTE_PREFIXES],
      excludePrefixes: [...UNCACHED_ROUTE_PREFIXES],
      ...(opts.responseCache ?? {}),
    });
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

  app.decorate('db', db);

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
  await coachDashboardRoutes(app, db);
  await commitmentsRoutes(app, db);
  await app.register(correctionsRoutes, { prefix: '/api' });
  await app.register(uploadRoutes);
  await app.register(adminDedupRoutes, { db });
  await app.register(hudlRoutes, { db });

  return app;
}
