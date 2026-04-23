import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkServerProcs } from '../checkServerProcs.js';

const isWin = platform() === 'win32';

describe('checkServerProcs', () => {
  let child: ChildProcess | undefined;
  let scratchDir: string | undefined;

  afterEach(() => {
    if (child && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    child = undefined;
    if (scratchDir) {
      rmSync(scratchDir, { recursive: true, force: true });
      scratchDir = undefined;
    }
    vi.restoreAllMocks();
  });

  it('--force bypass returns immediately even with no check performed', () => {
    // Should not throw and should not call process.exit.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    checkServerProcs({ force: true });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.skipIf(isWin)(
    'detects a matching process and exits with friendly message',
    async () => {
      // Spawn a `node` process whose argv contains the pattern `src/index.ts`
      // so `pgrep -lf` matches it. We point it at a real (no-op) script so
      // the process actually starts.
      scratchDir = mkdtempSync(join(tmpdir(), 'checksrv-'));
      const fakeScript = join(scratchDir, 'index.ts');
      // The file is interpreted by node directly as JS; we just need the path
      // string `src/index.ts` to appear in argv. We pass it as an arg, not
      // the script path, by using a tiny inline sleep script.
      writeFileSync(fakeScript, '// noop');

      child = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 60000)', '--', 'src/index.ts'],
        { stdio: 'ignore', detached: false },
      );

      // Wait briefly for pgrep to see the process.
      await new Promise((r) => setTimeout(r, 250));

      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('__exit__');
        }) as never);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => checkServerProcs()).toThrow('__exit__');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const msg = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(msg).toMatch(/Refusing to run --apply/);
      expect(msg).toMatch(new RegExp(`PID ${child.pid}`));
      expect(msg).toMatch(/--force/);
    },
  );

  it.skipIf(isWin)('--force bypasses detection of a matching process', async () => {
    child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 60000)', '--', 'src/index.ts'],
      { stdio: 'ignore', detached: false },
    );
    await new Promise((r) => setTimeout(r, 250));

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    checkServerProcs({ force: true });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
