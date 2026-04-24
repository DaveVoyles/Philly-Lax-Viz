// Snapshot epoch — a stable identifier for the current data snapshot.
//
// Production model: the SQLite DB is read-only between deploys. We use the
// DB file's mtime (in ms) as the snapshot identifier. It changes exactly when
// a new snapshot is rolled out, which is when caches must invalidate.
//
// We cache the stat() result for a short window so we don't fstat on every
// request hot path.

import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_DB_PATH = path.join(REPO_ROOT, 'data', 'lacrosse.db');

const STAT_TTL_MS = 5_000;

interface SnapshotState {
  dbPath: string;
  epoch: string;
  checkedAt: number;
}

let cached: SnapshotState | null = null;

function resolveDbPath(): string {
  return process.env['DB_PATH'] ?? process.env['PLL_DB_PATH'] ?? DEFAULT_DB_PATH;
}

function readEpoch(dbPath: string): string {
  try {
    const st = statSync(dbPath);
    // mtimeMs is a fractional ms; truncate so the epoch is a stable string.
    return String(Math.trunc(st.mtimeMs));
  } catch {
    // DB missing (e.g. :memory: in tests). Use the boot time instead so the
    // epoch is still stable for the life of the process.
    return `boot-${BOOT_TIME}`;
  }
}

const BOOT_TIME = Date.now();

export function getSnapshotEpoch(now: number = Date.now()): string {
  const dbPath = resolveDbPath();
  if (cached && cached.dbPath === dbPath && now - cached.checkedAt < STAT_TTL_MS) {
    return cached.epoch;
  }
  const epoch = readEpoch(dbPath);
  cached = { dbPath, epoch, checkedAt: now };
  return epoch;
}

// Test-only: drop the cached stat so a freshly-touched DB is observed
// immediately (instead of waiting for STAT_TTL_MS).
export function resetSnapshotEpochCache(): void {
  cached = null;
}
