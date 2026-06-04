// Server entrypoint. Opens (or creates+migrates) the SQLite DB and listens.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '@pll/ingest/src/db.js';
import { createLogger } from '@pll/shared';
import { buildApp } from './app.js';
import { startPblaScheduler } from './scheduler/pblaScheduler.js';

// Default DB path is resolved relative to the repo root (../../../data/lacrosse.db
// from packages/server/src/), so the server finds the same DB regardless of cwd.
// `DB_PATH` is the preferred env var; `PLL_DB_PATH` is kept for backward compat.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const bootLog = createLogger({ name: 'server:boot' });

async function main(): Promise<void> {
  const db = openDb(DB_PATH);
  const app = await buildApp(db, { logger: createLogger({ name: 'server' }) });

  // Start the PBLA scraper scheduler (Mon-Fri at 11 PM ET)
  const stopScheduler = startPblaScheduler({ dbPath: DB_PATH });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    stopScheduler();
    try {
      await app.close();
    } catch (err) {
      app.log.error(err);
    } finally {
      db.close();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    bootLog.error(err, 'uncaughtException — exiting');
    db.close();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    bootLog.error({ reason }, 'unhandledRejection — exiting');
    db.close();
    process.exit(1);
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`@pll/server listening on http://${HOST}:${PORT} (db=${DB_PATH})`);
}

main().catch((err) => {
  bootLog.error(err, 'fatal startup error');
  process.exit(1);
});
