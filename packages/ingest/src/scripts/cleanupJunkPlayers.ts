// cleanupJunkPlayers.ts — sweep degenerate player rows that pre-date the
// stricter ingest-time guards.
//
// Targets (Wave 5 Lane 1, see Appendix C):
//   - exact name 'None'
//   - exact name 'No name provided'
//   - any name ending in "'s" (possessive captured by old playerStat parser
//     before the Wave 5 fix; e.g. "Dylan Bella's", "Ryan's Turse" — wait,
//     the second one has the apostrophe mid-name and so is matched by the
//     trailing-quote branch only for names ending in "'s". We additionally
//     match names containing "'s " mid-string.)
//
// Apostrophe-ending names that are LEGITIMATE (e.g. Irish surnames like
// O'Kane, O'Leary, D'Annunzio) end in a letter, not "s". The "ends in 's"
// pattern is therefore safe and never matches a real player.
//
// Safety:
//   - Default DRY-RUN. Use --apply to write.
//   - Per-row FK check: rows with linked player_stats are PRESERVED and
//     loudly logged — they need manual review (the stat itself is real
//     attribution data; the player row needs to be re-pointed first).
//   - All deletes inside a single BEGIN/COMMIT.
//   - PRAGMA foreign_key_check verified after apply.
//
// Usage:
//   pnpm --filter @pll/ingest cleanup:junk            # dry-run
//   pnpm --filter @pll/ingest cleanup:junk -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';

export interface JunkRow {
  id: number;
  name: string;
  team_id: number;
  linkedStats: number;
}

export interface CleanupPlan {
  preCount: number;
  /** Rows safe to delete (zero linked player_stats). */
  deletable: JunkRow[];
  /** Rows preserved because they have linked stats — needs manual review. */
  skipped: JunkRow[];
}

export interface CleanupResult extends CleanupPlan {
  postCount: number;
  deleted: number;
}

/**
 * Identify junk player rows and split them by whether they can be safely
 * deleted (no FK dependents in player_stats).
 */
export function buildPlan(db: Database): CleanupPlan {
  const preCount = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  // SQLite escapes single-quote inside a string literal by doubling it: ''.
  // Pattern below matches names that LITERALLY end in apostrophe-s.
  const candidates = db
    .prepare(
      `SELECT p.id, p.name, p.team_id,
              (SELECT COUNT(*) FROM player_stats ps WHERE ps.player_id = p.id) AS linkedStats
         FROM players p
        WHERE p.name = 'None'
           OR p.name = 'No name provided'
           OR p.name LIKE '%''s'
           OR p.name LIKE '%''s %'
        ORDER BY p.id`,
    )
    .all() as JunkRow[];

  const deletable: JunkRow[] = [];
  const skipped: JunkRow[] = [];
  for (const row of candidates) {
    if (row.linkedStats === 0) deletable.push(row);
    else skipped.push(row);
  }
  return { preCount, deletable, skipped };
}

/**
 * Apply the plan: delete rows in `deletable` inside a single transaction.
 * Returns counts. Idempotent (a no-op when `deletable` is empty).
 */
export function applyPlan(db: Database, plan: CleanupPlan): CleanupResult {
  if (plan.deletable.length === 0) {
    return { ...plan, postCount: plan.preCount, deleted: 0 };
  }
  const ids = plan.deletable.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction((rowIds: number[]) => {
    db.prepare(`DELETE FROM players WHERE id IN (${placeholders})`).run(...rowIds);
  });
  tx(ids);
  const postCount = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  return { ...plan, postCount, deleted: plan.preCount - postCount };
}

function printPlan(plan: CleanupPlan, apply: boolean): void {
  const header = apply ? 'Applying' : 'Dry-run plan';
  console.log(`-------- ${header}: cleanupJunkPlayers --------`);
  console.log(`Pre-count: ${plan.preCount} players`);
  console.log(`Deletable (no linked stats): ${plan.deletable.length}`);
  for (const r of plan.deletable) {
    console.log(`  delete  id=${r.id}  team=${r.team_id}  name="${r.name}"`);
  }
  if (plan.skipped.length > 0) {
    console.log(`\n!! Skipped (linked player_stats present — manual review): ${plan.skipped.length}`);
    for (const r of plan.skipped) {
      console.log(
        `  KEEP    id=${r.id}  team=${r.team_id}  name="${r.name}"  linkedStats=${r.linkedStats}`,
      );
    }
  }
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDb = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const dbPath = process.env.DB_PATH ?? defaultDb;
  console.log(`[cleanupJunkPlayers] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const plan = buildPlan(db);
  printPlan(plan, apply);

  if (!apply) {
    console.log('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  const result = applyPlan(db, plan);
  console.log('\n-------- Apply result --------');
  console.log(`players  ${result.preCount} -> ${result.postCount}  (deleted ${result.deleted})`);
  if (result.skipped.length > 0) {
    console.log(`preserved (linked stats): ${result.skipped.length}`);
  }

  const fkIssues = db.pragma('foreign_key_check') as unknown[];
  if (fkIssues.length > 0) {
    console.error('FOREIGN KEY CHECK reported issues:');
    console.error(fkIssues);
    process.exitCode = 1;
  } else {
    console.log('foreign_key_check: clean');
  }
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
