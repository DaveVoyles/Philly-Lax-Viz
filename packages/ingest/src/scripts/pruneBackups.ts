/**
 * Prune stale SQLite backup files (Wave H0 Lane 2 hygiene, 2026-04-23).
 *
 * Globs `data/lacrosse.db.bak*` (excluding `-wal` / `-shm` siblings),
 * sorts by mtime descending, keeps the most recent N (default 3), and
 * deletes the rest along with their `-wal` / `-shm` siblings.
 *
 * Default is dry-run; pass --apply to actually unlink.
 *
 * Usage:
 *   pnpm --filter @pll/ingest run prune-backups            # dry-run, keep 3
 *   pnpm --filter @pll/ingest run prune-backups -- --apply
 *   pnpm --filter @pll/ingest run prune-backups -- --apply --keep 5
 */
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface BackupEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface PrunePlan {
  keep: BackupEntry[];
  deletePrimaries: BackupEntry[];
  deleteSiblings: BackupEntry[];
  totalFound: number;
  bytesToFree: number;
}

const SIBLING_SUFFIXES = ['-wal', '-shm'] as const;

function isSibling(name: string): boolean {
  return SIBLING_SUFFIXES.some((s) => name.endsWith(s));
}

export function listBackups(dataDir: string): BackupEntry[] {
  if (!existsSync(dataDir)) return [];
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(dataDir)) {
    if (!name.startsWith('lacrosse.db.bak')) continue;
    if (isSibling(name)) continue;
    const full = join(dataDir, name);
    const st = statSync(full);
    if (!st.isFile()) continue;
    entries.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
  }
  return entries;
}

export function planPrune(backups: BackupEntry[], keep: number): PrunePlan {
  const sorted = [...backups].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keptSet = sorted.slice(0, keep);
  const deletePrimaries = sorted.slice(keep);

  const deleteSiblings: BackupEntry[] = [];
  for (const primary of deletePrimaries) {
    for (const suffix of SIBLING_SUFFIXES) {
      const sibling = primary.path + suffix;
      if (existsSync(sibling)) {
        const st = statSync(sibling);
        if (st.isFile()) {
          deleteSiblings.push({ path: sibling, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    }
  }

  const bytesToFree =
    deletePrimaries.reduce((sum, e) => sum + e.size, 0) +
    deleteSiblings.reduce((sum, e) => sum + e.size, 0);

  return {
    keep: keptSet,
    deletePrimaries,
    deleteSiblings,
    totalFound: backups.length,
    bytesToFree,
  };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function parseArgs(argv: string[]): { keep: number; apply: boolean } {
  let keep = 3;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--keep') {
      const next = argv[i + 1];
      if (!next) throw new Error('--keep requires a number');
      const n = Number.parseInt(next, 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --keep: ${next}`);
      keep = n;
      i++;
    } else if (a?.startsWith('--keep=')) {
      const n = Number.parseInt(a.slice('--keep='.length), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --keep: ${a}`);
      keep = n;
    }
  }
  return { keep, apply };
}

function main(): void {
  const { keep, apply } = parseArgs(process.argv.slice(2));
  const dataDir = resolve(process.env.DATA_DIR ?? './data');
  const backups = listBackups(dataDir);
  const plan = planPrune(backups, keep);

  console.log(`pruneBackups: scanned ${dataDir}`);
  console.log(`  total backup files found: ${plan.totalFound}`);
  console.log(`  keeping (${plan.keep.length}):`);
  for (const e of plan.keep) {
    console.log(`    ${e.path}  (${fmtBytes(e.size)})`);
  }
  console.log(`  deleting primaries (${plan.deletePrimaries.length}):`);
  for (const e of plan.deletePrimaries) {
    console.log(`    ${e.path}  (${fmtBytes(e.size)})`);
  }
  console.log(`  deleting siblings (${plan.deleteSiblings.length}):`);
  for (const e of plan.deleteSiblings) {
    console.log(`    ${e.path}  (${fmtBytes(e.size)})`);
  }
  console.log(`  total bytes to free: ${fmtBytes(plan.bytesToFree)} (${plan.bytesToFree} B)`);

  if (!apply) {
    console.log('// DRY RUN — pass --apply to unlink the files above');
    return;
  }

  let unlinked = 0;
  for (const e of [...plan.deletePrimaries, ...plan.deleteSiblings]) {
    unlinkSync(e.path);
    console.log(`  unlinked ${e.path}`);
    unlinked++;
  }
  console.log(`pruneBackups: removed ${unlinked} files (~${fmtBytes(plan.bytesToFree)})`);
}

const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /pruneBackups\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (isDirectInvocation) main();
