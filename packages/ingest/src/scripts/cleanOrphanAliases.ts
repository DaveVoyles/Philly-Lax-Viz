// cleanOrphanAliases.ts — Wave 15 Lane 1 (Chewy 🐻💪).
//
// Delete rows from `player_aliases` whose `player_id` no longer points at a
// live `players` row. These accumulate when ghost-team / junk-player cleanup
// runs delete the player but leave the alias behind (the FK has
// ON DELETE CASCADE in the schema, but historic cleanup paths bypassed FK
// checks via raw DELETE in PRAGMA off-mode, leaving these orphans).
//
// Dry-run by default. Use --apply to commit the deletes. Writes a JSON audit
// log to data/orphan-aliases-w15.json.
//
// Usage:
//   pnpm --filter @pll/ingest tsx src/scripts/cleanOrphanAliases.ts          # dry
//   pnpm --filter @pll/ingest tsx src/scripts/cleanOrphanAliases.ts --apply  # commit

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:cleanOrphanAliases' });
export interface OrphanAliasRow {
  id: number;
  alias: string;
  player_id: number;
  source: string;
}

export interface CleanOrphanAliasesReport {
  scanned: number;
  orphans: OrphanAliasRow[];
  deleted: number;
  applied: boolean;
}

/**
 * Find player_aliases whose player_id has no matching players.id row.
 * Lookup-only, no mutation.
 */
export function findOrphanAliases(db: Database): OrphanAliasRow[] {
  return db
    .prepare(
      `SELECT pa.id, pa.alias, pa.player_id, pa.source
         FROM player_aliases pa
    LEFT JOIN players p ON p.id = pa.player_id
        WHERE p.id IS NULL
        ORDER BY pa.id`,
    )
    .all() as OrphanAliasRow[];
}

/**
 * Run the cleanup. When `apply` is false, returns the orphans without
 * deleting. When true, deletes inside a transaction.
 */
export function cleanOrphanAliases(
  db: Database,
  apply: boolean,
): CleanOrphanAliasesReport {
  const scanned = (
    db.prepare('SELECT COUNT(*) AS c FROM player_aliases').get() as { c: number }
  ).c;
  const orphans = findOrphanAliases(db);
  let deleted = 0;
  if (apply && orphans.length > 0) {
    const del = db.prepare('DELETE FROM player_aliases WHERE id = ?');
    const tx = db.transaction((rows: OrphanAliasRow[]) => {
      for (const r of rows) {
        const info = del.run(r.id);
        deleted += info.changes;
      }
    });
    tx(orphans);
  }
  return { scanned, orphans, deleted, applied: apply };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath =
    process.env.DB_PATH ??
    process.env.PLL_DB_PATH ??
    resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const auditPath = resolve(here, '..', '..', '..', '..', 'data', 'orphan-aliases-w15.json');

  log.info(`[cleanOrphanAliases] db=${dbPath} apply=${apply}`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const report = cleanOrphanAliases(db, apply);

  writeFileSync(
    auditPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        apply,
        scanned: report.scanned,
        orphan_count: report.orphans.length,
        deleted: report.deleted,
        orphans: report.orphans,
      },
      null,
      2,
    ),
  );

  log.info(`[cleanOrphanAliases] scanned=${report.scanned}`);
  log.info(`[cleanOrphanAliases] orphans=${report.orphans.length}`);
  log.info(`[cleanOrphanAliases] deleted=${report.deleted}${apply ? '' : ' (dry-run)'}`);
  log.info(`[cleanOrphanAliases] audit=${auditPath}`);

  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
