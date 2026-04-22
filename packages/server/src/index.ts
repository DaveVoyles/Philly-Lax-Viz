// Server entrypoint. Opens (or creates+migrates) the SQLite DB and listens.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '@pll/ingest/src/db.js';
import { buildApp } from './app.js';

// Default DB path is resolved relative to the repo root (../../../data/lacrosse.db
// from packages/server/src/), so the server finds the same DB regardless of cwd.
// `DB_PATH` is the preferred env var; `PLL_DB_PATH` is kept for backward compat.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const db = openDb(DB_PATH);
  const app = await buildApp(db, { logger: true });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      db.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`@pll/server listening on http://${HOST}:${PORT} (db=${DB_PATH})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
