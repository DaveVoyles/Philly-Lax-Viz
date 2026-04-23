import { describe, it, expect, vi } from 'vitest';
import { runSnapshot, buildBlobName } from '../snapshotDb.js';

describe('snapshotDb', () => {
  it('exits 1 with a friendly error when AZURE_STORAGE_CONNECTION_STRING is missing', () => {
    const errs: string[] = [];
    const code = runSnapshot(
      {},
      {
        log: () => {},
        err: (m) => errs.push(m),
        upload: () => {
          throw new Error('upload should not be called');
        },
        fileExists: () => true,
      },
    );
    expect(code).toBe(1);
    expect(errs.join('\n')).toMatch(/AZURE_STORAGE_CONNECTION_STRING/);
  });

  it('exits 1 when the connection string is whitespace', () => {
    const code = runSnapshot(
      { AZURE_STORAGE_CONNECTION_STRING: '   ' },
      {
        log: () => {},
        err: () => {},
        upload: () => {
          throw new Error('upload should not be called');
        },
        fileExists: () => true,
      },
    );
    expect(code).toBe(1);
  });

  it('builds blob name as lacrosse-YYYY-MM-DD.db', () => {
    expect(buildBlobName(new Date('2026-04-23T00:00:00Z'))).toBe(
      'lacrosse-2026-04-23.db',
    );
  });

  it('invokes upload exactly once when env + file are present', () => {
    const upload = vi.fn();
    const code = runSnapshot(
      { AZURE_STORAGE_CONNECTION_STRING: 'fake-cs', DB_PATH: 'data/lacrosse.db' },
      {
        log: () => {},
        err: () => {},
        upload,
        fileExists: () => true,
        now: () => new Date('2026-04-23T00:00:00Z'),
      },
    );
    expect(code).toBe(0);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toMatchObject({
      container: 'db-snapshots',
      blobName: 'lacrosse-2026-04-23.db',
    });
  });
});
