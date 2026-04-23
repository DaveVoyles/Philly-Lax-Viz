import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listBackups, planPrune } from '../pruneBackups.js';

function touch(path: string, mtimeSec: number, body = ''): void {
  writeFileSync(path, body);
  utimesSync(path, mtimeSec, mtimeSec);
}

describe('pruneBackups', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'prune-backups-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists only lacrosse.db.bak* files and excludes -wal/-shm siblings', () => {
    touch(join(dir, 'lacrosse.db'), 1000, 'live');
    touch(join(dir, 'lacrosse.db-wal'), 1000, 'wal');
    touch(join(dir, 'lacrosse.db.bak-a'), 1100, 'a');
    touch(join(dir, 'lacrosse.db.bak-a-wal'), 1100, 'awal');
    touch(join(dir, 'lacrosse.db.bak-a-shm'), 1100, 'ashm');
    touch(join(dir, 'lacrosse.db.bak-b'), 1200, 'b');
    touch(join(dir, 'unrelated.txt'), 1300, 'x');

    const found = listBackups(dir).map((e) => e.path).sort();
    expect(found).toEqual(
      [join(dir, 'lacrosse.db.bak-a'), join(dir, 'lacrosse.db.bak-b')].sort(),
    );
  });

  it('keeps the N most recent by mtime and marks the rest for deletion', () => {
    // mtimes: c (newest) > b > a (oldest)
    touch(join(dir, 'lacrosse.db.bak-a'), 1000, 'a');
    touch(join(dir, 'lacrosse.db.bak-b'), 2000, 'b');
    touch(join(dir, 'lacrosse.db.bak-c'), 3000, 'c');
    touch(join(dir, 'lacrosse.db.bak-d'), 4000, 'd');

    const plan = planPrune(listBackups(dir), 2);
    const keepNames = plan.keep.map((e) => e.path).sort();
    const delNames = plan.deletePrimaries.map((e) => e.path).sort();

    expect(plan.totalFound).toBe(4);
    expect(keepNames).toEqual(
      [join(dir, 'lacrosse.db.bak-c'), join(dir, 'lacrosse.db.bak-d')].sort(),
    );
    expect(delNames).toEqual(
      [join(dir, 'lacrosse.db.bak-a'), join(dir, 'lacrosse.db.bak-b')].sort(),
    );
  });

  it('includes -wal/-shm siblings in the delete-set when the primary is being deleted', () => {
    touch(join(dir, 'lacrosse.db.bak-old'), 1000, 'old');
    touch(join(dir, 'lacrosse.db.bak-old-wal'), 1000, 'oldwal');
    touch(join(dir, 'lacrosse.db.bak-old-shm'), 1000, 'oldshm');
    touch(join(dir, 'lacrosse.db.bak-new'), 2000, 'new');
    touch(join(dir, 'lacrosse.db.bak-new-wal'), 2000, 'newwal'); // kept => sibling NOT deleted

    const plan = planPrune(listBackups(dir), 1);
    const sibPaths = plan.deleteSiblings.map((e) => e.path).sort();

    expect(plan.deletePrimaries.map((e) => e.path)).toEqual([
      join(dir, 'lacrosse.db.bak-old'),
    ]);
    expect(sibPaths).toEqual(
      [
        join(dir, 'lacrosse.db.bak-old-shm'),
        join(dir, 'lacrosse.db.bak-old-wal'),
      ].sort(),
    );
    // The kept primary's sibling must not be in the delete set.
    expect(sibPaths).not.toContain(join(dir, 'lacrosse.db.bak-new-wal'));
    expect(plan.bytesToFree).toBeGreaterThan(0);
  });

  it('keep=0 deletes everything; keep>=N is a no-op', () => {
    touch(join(dir, 'lacrosse.db.bak-a'), 1000, 'a');
    touch(join(dir, 'lacrosse.db.bak-b'), 2000, 'b');

    const all = planPrune(listBackups(dir), 0);
    expect(all.deletePrimaries.length).toBe(2);
    expect(all.keep.length).toBe(0);

    const none = planPrune(listBackups(dir), 5);
    expect(none.deletePrimaries.length).toBe(0);
    expect(none.keep.length).toBe(2);
    // Sanity: nothing was actually unlinked by planning.
    expect(existsSync(join(dir, 'lacrosse.db.bak-a'))).toBe(true);
    expect(readdirSync(dir).length).toBe(2);
  });
});
