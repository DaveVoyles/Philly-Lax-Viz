// seedPlayerAliases.ts — idempotent seed for known player-level merge aliases.
//
// Wave 18 Lane W1L3 (Leia 👑💁‍♀️): manual alias for the Pierce Merrill
// duplicate on team 80 (Harriton). Player 51229 "Peirce Merrill" is a
// letter-transposition dup of player 50907 "Pierce Merrill" / "Peirce Merrill".
//
// This script calls mergePlayers() for each known alias pair so that:
//   1. Stats under the dup player_id are reassigned to the canonical player.
//   2. The dup player row is deleted.
//   3. An audit record is written to player_aliases.
//
// Idempotent: mergePlayers() checks whether the drop player still exists;
// if it was already merged (deleted), the call is a clean no-op.
//
// Usage:
//   pnpm --filter @pll/ingest player-aliases:seed            # dry-run
//   pnpm --filter @pll/ingest player-aliases:seed -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { mergePlayers } from './dedupPlayers.js';

export interface PlayerAliasSeed {
  /** Player ID to drop (the duplicate). */
  dropId: number;
  /** Player ID to keep (the canonical). */
  keepId: number;
  /** Human-readable note for logs. */
  note: string;
}

/**
 * Known manual alias seeds. Each entry is verified by cross-checking the
 * live DB before seeding. Add new entries here when a new duplicate is
 * confirmed — do NOT edit existing entries.
 */
export const PLAYER_ALIAS_SEEDS: readonly PlayerAliasSeed[] = [
  // alias 51229 -> 50907 (Peirce Merrill dup, Harriton team 80)
  // "Peirce Merrill" (3g/0a, id=51229) is a letter-transposition duplicate of
  // "Peirce Merrill" / "Pierce Merrill" (20g/1a, id=50907). Both letter parts
  // differ: Peirce↔Pierce (swap i/e) and Merrill↔Merill (one r dropped).
  {
    dropId: 51229,
    keepId: 50907,
    note: 'Harriton team 80 — Peirce/Pierce Merrill/Merill transposition dup',
  },
];

export const SEED_SOURCE = 'manual';

/**
 * Apply all seeds to `db`. Returns how many merges were actually executed
 * (0 if all were already merged / no-ops).
 */
export function applySeedPlayerAliases(db: Database): number {
  let applied = 0;
  for (const seed of PLAYER_ALIAS_SEEDS) {
    const dropExists = db
      .prepare('SELECT COUNT(*) AS c FROM players WHERE id = ?')
      .get(seed.dropId) as { c: number };
    if (dropExists.c === 0) {
      console.log(`  [skip] drop id=${seed.dropId} already gone — ${seed.note}`);
      continue;
    }
    const result = mergePlayers(db, seed.keepId, seed.dropId, SEED_SOURCE, 1.0);
    console.log(
      `  [merge] keep=#${result.keptId}  drop=#${result.droppedId}  ` +
        `stats_reassigned=${result.statRowsReassigned}  ` +
        `dups_dropped=${result.duplicateStatsDropped}  ` +
        `(${seed.note})`,
    );
    applied++;
  }
  return applied;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  console.log(`[seedPlayerAliases] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  console.log(`Seeds defined: ${PLAYER_ALIAS_SEEDS.length}`);
  for (const s of PLAYER_ALIAS_SEEDS) {
    const dropRow = db
      .prepare('SELECT name FROM players WHERE id = ?')
      .get(s.dropId) as { name: string } | undefined;
    const keepRow = db
      .prepare('SELECT name FROM players WHERE id = ?')
      .get(s.keepId) as { name: string } | undefined;
    console.log(
      `  drop=#${s.dropId} "${dropRow?.name ?? '(not found)'}"  ` +
        `→ keep=#${s.keepId} "${keepRow?.name ?? '(not found)'}"`,
    );
  }

  if (!apply) {
    console.log('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  const applied = applySeedPlayerAliases(db);
  console.log(`\napplied: ${applied} / ${PLAYER_ALIAS_SEEDS.length} seeds`);
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
