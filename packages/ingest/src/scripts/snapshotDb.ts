/**
 * Nightly DB snapshot uploader (Wave H4 Lane 6 / Luke, 2026-04-23).
 *
 * Uploads the local SQLite database to Azure Blob Storage so we have an
 * off-host backup independent of the container disk. Scheduling (GitHub
 * Actions cron, secrets, retention policy) is intentionally NOT wired
 * here — that lands in a follow-up once the storage account + secret
 * are provisioned.
 *
 * Approach: shells out to the `az` CLI rather than pulling in the
 * `@azure/storage-blob` SDK. Keeps the ingest package dependency
 * footprint small and matches how the rest of our infra already
 * authenticates in CI.
 *
 * Env:
 *   AZURE_STORAGE_CONNECTION_STRING  required, never logged
 *   DB_PATH                          optional, default `data/lacrosse.db`
 *   SNAPSHOT_CONTAINER               optional, default `db-snapshots`
 *
 * Usage:
 *   pnpm --filter @pll/ingest snapshot:db
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createLogger } from '@pll/shared';
const moduleLog = createLogger({ name: 'ingest:snapshotDb' });
export interface SnapshotEnv {
  AZURE_STORAGE_CONNECTION_STRING?: string;
  DB_PATH?: string;
  SNAPSHOT_CONTAINER?: string;
}

export interface SnapshotDeps {
  now?: () => Date;
  upload?: (args: {
    connectionString: string;
    container: string;
    blobName: string;
    file: string;
  }) => void;
  fileExists?: (path: string) => boolean;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
}

export function buildBlobName(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `lacrosse-${y}-${m}-${d}.db`;
}

function defaultUpload(args: {
  connectionString: string;
  container: string;
  blobName: string;
  file: string;
}): void {
  // `az storage blob upload` reads the connection string via env so it
  // never appears on the command line / process listing.
  execFileSync(
    'az',
    [
      'storage',
      'blob',
      'upload',
      '--container-name',
      args.container,
      '--name',
      args.blobName,
      '--file',
      args.file,
      '--overwrite',
      'true',
      '--only-show-errors',
    ],
    {
      env: {
        ...process.env,
        AZURE_STORAGE_CONNECTION_STRING: args.connectionString,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
}

/**
 * Pure-ish entry point. Returns a process exit code rather than calling
 * `process.exit` so it can be unit-tested without spawning a subprocess.
 */
export function runSnapshot(env: SnapshotEnv, deps: SnapshotDeps = {}): number {
  const log = deps.log ?? ((m) => moduleLog.info(m));
  const err = deps.err ?? ((m) => moduleLog.error(m));
  const fileExists = deps.fileExists ?? existsSync;
  const upload = deps.upload ?? defaultUpload;
  const now = deps.now ?? (() => new Date());

  const connectionString = env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString || connectionString.trim() === '') {
    err(
      'snapshotDb: AZURE_STORAGE_CONNECTION_STRING is not set. ' +
        'Refusing to upload without credentials. Set the env var and retry.',
    );
    return 1;
  }

  const dbPath = resolve(env.DB_PATH ?? 'data/lacrosse.db');
  if (!fileExists(dbPath)) {
    err(`snapshotDb: database file not found at ${dbPath}`);
    return 1;
  }

  const container = env.SNAPSHOT_CONTAINER ?? 'db-snapshots';
  const blobName = buildBlobName(now());

  log(`snapshotDb: uploading ${dbPath} -> ${container}/${blobName}`);
  try {
    upload({ connectionString, container, blobName, file: dbPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`snapshotDb: upload failed: ${msg}`);
    return 1;
  }

  // Account name is embedded in the connection string; deriving the
  // exact public URL would require parsing it. Print container+blob so
  // the operator can locate it in the portal without us logging the
  // connection string.
  log(`snapshotDb: success — ${container}/${blobName}`);
  return 0;
}

const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /snapshotDb\.(ts|js|mjs|cjs)$/.test(process.argv[1]);

if (isDirectInvocation) {
  process.exit(runSnapshot(process.env));
}
