import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

// Pattern matches dev servers that hold the SQLite DB open:
//   - `pnpm dev` / `pnpm start` for `@pll/server` (matches `pll/server` in cwd)
//   - direct `tsx src/index.ts` invocations
// pgrep's -f flag matches against the full command line, so this catches both
// the tsx wrapper and node child processes.
export const SERVER_PROC_PATTERN = 'pll/server|src/index\\.ts';

interface ProcInfo {
  pid: string;
  line: string;
}

function parsePgrepOutput(out: string): ProcInfo[] {
  const procs: ProcInfo[] = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // `pgrep -lf` output: "<pid> <full command line>"
    const m = /^(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    procs.push({ pid: m[1]!, line: m[2]! });
  }
  return procs;
}

function getStartTime(pid: string): string {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', pid], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Refuse to run a destructive `--apply` migration if dev servers are still
 * holding the SQLite DB open. Stale connections cause WAL desync that surfaces
 * later as `SqliteError: database disk image is malformed`.
 *
 * On non-Unix systems (Windows) `pgrep` is unavailable; we warn and skip.
 * Pass `{ force: true }` to bypass after a deliberate decision.
 */
export function checkServerProcs(opts: { force?: boolean } = {}): void {
  if (opts.force) return;

  if (platform() === 'win32') {
    console.warn(
      '[checkServerProcs] pgrep unavailable on Windows — skipping dev-server check. ' +
        'Make sure no `pnpm dev` / `pnpm start` is running before applying.',
    );
    return;
  }

  let stdout = '';
  try {
    stdout = execFileSync('pgrep', ['-lf', SERVER_PROC_PATTERN], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number };
    // pgrep exits 1 when no matches — that's the happy path.
    if (e.status === 1) return;
    // ENOENT (pgrep missing) → warn and skip.
    if (e.code === 'ENOENT') {
      console.warn(
        '[checkServerProcs] pgrep not found on PATH — skipping dev-server check.',
      );
      return;
    }
    // Any other failure: warn but don't block the migration.
    console.warn(
      `[checkServerProcs] pgrep failed (${e.message ?? 'unknown error'}) — skipping check.`,
    );
    return;
  }

  // Filter out our own process (in case our cmdline matched the pattern).
  const ownPid = String(process.pid);
  const procs = parsePgrepOutput(stdout).filter((p) => p.pid !== ownPid);
  if (procs.length === 0) return;

  const lines: string[] = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🛑 Refusing to run --apply: dev server processes detected.');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(
    'These processes hold the SQLite DB open. Running a migration now will',
    'desync WAL state and produce "database disk image is malformed" errors',
    'on the cached connections.',
  );
  lines.push('');
  lines.push('Detected processes:');
  for (const p of procs) {
    const start = getStartTime(p.pid);
    lines.push(`  • PID ${p.pid}  started ${start}`);
    lines.push(`      ${p.line}`);
  }
  lines.push('');
  lines.push('Resolution:');
  lines.push('  1. Stop the dev server(s):  kill <PID>   (or stop `pnpm dev`)');
  lines.push('  2. Re-run the --apply command.');
  lines.push('');
  lines.push('Override (only if you know the servers do not touch this DB):');
  lines.push('  Re-run with --force');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  console.error(lines.join('\n'));
  process.exit(1);
}
