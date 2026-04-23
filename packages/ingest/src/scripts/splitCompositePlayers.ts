// splitCompositePlayers.ts — one-shot migration to split composite player
// rows like "Mason Proctor and Javier Gonzalez-Cruz" into two distinct
// players on the same team.
//
// Wave H5 Lane 1 — accompanies the parser fix in playerStat.ts /
// summariesPost.ts that now splits composite names at ingest time. This
// script cleans up rows already persisted under the old (buggy) parser.
//
// Behavior (per composite players row detected via splitCompositeNames):
//   1. Parse the composite into N split names using splitCompositeNames.
//   2. For each split name, findOrCreate a player row on the SAME team_id
//      (re-using the existing UNIQUE (team_id, name_normalized) index).
//   3. Reassign every player_stats row from the composite player_id to the
//      FIRST split player. Apportioning stats across N players is unsafe
//      (we don't know who scored what) — instead we log a warning and dump
//      each affected stat row for manual review.
//   4. After all stats are reassigned, DELETE the composite players row.
//
// Dry-run by default. Pass --apply to commit.
//
// Usage:
//   pnpm --filter @pll/ingest split:composite-players          # dry-run
//   pnpm --filter @pll/ingest split:composite-players --apply  # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizePlayerName } from '../normalize/playerName.js';
import { splitCompositeNames } from '../parsers/playerStat.js';

export interface CompositeRow {
  id: number;
  name: string;
  team_id: number;
}

export interface StatRow {
  id: number;
  game_id: number;
  player_id: number;
  goals: number;
  assists: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
}

export interface SplitAction {
  composite: CompositeRow;
  splitNames: string[];
  /** Stat rows currently attached to the composite player_id (for audit). */
  stats: StatRow[];
}

export interface SplitPlan {
  actions: SplitAction[];
  preCount: number;
}

export interface SplitResult extends SplitPlan {
  postCount: number;
  playersCreated: number;
  statRowsMoved: number;
  playersDeleted: number;
}

/** Fetch all composite player rows and their attached stats. */
export function buildPlan(db: Database): SplitPlan {
  const all = db
    .prepare<[], CompositeRow>(
      `SELECT id, name, team_id FROM players
       WHERE name LIKE '% and %' OR name LIKE '% AND %' OR name LIKE '% And %'
       ORDER BY id`,
    )
    .all();

  const actions: SplitAction[] = [];
  for (const row of all) {
    const split = splitCompositeNames(row.name);
    if (split.length < 2) continue; // not actually composite per helper rules
    const stats = db
      .prepare<[number], StatRow>(
        `SELECT id, game_id, player_id, goals, assists, ground_balls,
                caused_turnovers, saves, fo_won, fo_taken
         FROM player_stats WHERE player_id = ?`,
      )
      .all(row.id);
    actions.push({ composite: row, splitNames: split, stats });
  }

  const preCount = (db.prepare('SELECT COUNT(*) AS c FROM players').get() as {
    c: number;
  }).c;

  return { actions, preCount };
}

/**
 * findOrCreate a player on `teamId` with the given display name.
 * Returns the player id. Uses the existing UNIQUE (team_id, name_normalized)
 * to dedupe against pre-existing rows.
 */
export function findOrCreatePlayer(
  db: Database,
  teamId: number,
  name: string,
): { id: number; created: boolean } {
  const norm = normalizePlayerName(name);
  if (!norm) {
    throw new Error(`splitCompositePlayers: empty normalized name for "${name}"`);
  }
  const existing = db
    .prepare<[number, string], { id: number }>(
      'SELECT id FROM players WHERE team_id = ? AND name_normalized = ?',
    )
    .get(teamId, norm);
  if (existing) return { id: existing.id, created: false };

  const isPartial = !/\s/.test(name);
  const info = db
    .prepare(
      `INSERT INTO players (name, name_normalized, team_id, name_resolution)
       VALUES (?, ?, ?, ?)`,
    )
    .run(name, norm, teamId, isPartial ? 'partial' : 'full');
  return { id: Number(info.lastInsertRowid), created: true };
}

/** Apply the plan. Wraps all writes in BEGIN/COMMIT. */
export function applyPlan(db: Database, plan: SplitPlan): SplitResult {
  let playersCreated = 0;
  let statRowsMoved = 0;
  let playersDeleted = 0;

  const tx = db.transaction(() => {
    for (const action of plan.actions) {
      const splitIds: number[] = [];
      for (const n of action.splitNames) {
        const { id, created } = findOrCreatePlayer(db, action.composite.team_id, n);
        if (created) playersCreated += 1;
        splitIds.push(id);
      }
      const firstId = splitIds[0]!;
      // Reassign all stats from composite → first split player.
      // UPDATE OR IGNORE in case the first split already had a stat row
      // for the same game (UNIQUE(game_id, player_id)).
      const before = (
        db
          .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
          .get(firstId) as { c: number }
      ).c;
      db.prepare(
        'UPDATE OR IGNORE player_stats SET player_id = ? WHERE player_id = ?',
      ).run(firstId, action.composite.id);
      const after = (
        db
          .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
          .get(firstId) as { c: number }
      ).c;
      statRowsMoved += after - before;
      // Drop any leftover (collision) stats still pointing at composite.
      db.prepare('DELETE FROM player_stats WHERE player_id = ?').run(action.composite.id);
      // Delete the composite player row.
      db.prepare('DELETE FROM players WHERE id = ?').run(action.composite.id);
      playersDeleted += 1;
    }
  });

  tx();

  const postCount = (db.prepare('SELECT COUNT(*) AS c FROM players').get() as {
    c: number;
  }).c;

  return { ...plan, postCount, playersCreated, statRowsMoved, playersDeleted };
}

function printPlan(plan: SplitPlan, apply: boolean): void {
  const header = apply ? 'Applying' : 'Dry-run plan';
  console.log(`──────── ${header}: splitCompositePlayers ────────`);
  console.log(`Pre-count: ${plan.preCount} players`);
  console.log(`Composite player rows detected: ${plan.actions.length}`);
  if (plan.actions.length === 0) {
    console.log('  (none — nothing to do)');
    return;
  }
  let n = 0;
  for (const a of plan.actions) {
    n += 1;
    console.log(
      `\n  ${n}. composite #${a.composite.id} team=${a.composite.team_id} ` +
        `"${a.composite.name}"`,
    );
    console.log(`     → split into: ${a.splitNames.map((s) => `"${s}"`).join(', ')}`);
    console.log(
      `     → ${a.stats.length} stat row(s) will be reassigned to FIRST split ` +
        `player ("${a.splitNames[0]}")`,
    );
    if (a.stats.length > 0 && a.splitNames.length > 1) {
      console.log(
        `     ⚠️  WARNING: ${a.splitNames.length} players share these stats. ` +
          `Apportioning is unsafe — assigning to "${a.splitNames[0]}" only. ` +
          `Manual review recommended for stat rows below.`,
      );
      for (const s of a.stats) {
        console.log(
          `       - stat#${s.id} game=${s.game_id}: ` +
            `g=${s.goals} a=${s.assists} gb=${s.ground_balls} ` +
            `cto=${s.caused_turnovers} sv=${s.saves} fo=${s.fo_won}/${s.fo_taken}`,
        );
      }
    }
  }
}

function printResult(r: SplitResult): void {
  console.log('\n──────── Apply result ────────');
  console.log(`players       ${r.preCount} → ${r.postCount}`);
  console.log(`composites detected: ${r.actions.length}`);
  console.log(`players created    : ${r.playersCreated}`);
  console.log(`stat rows moved    : ${r.statRowsMoved}`);
  console.log(`composite players deleted: ${r.playersDeleted}`);
  console.log('──────────────────────────────');
}

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes('--apply') };
}

function main(): void {
  const args = parseArgs(process.argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  console.log(
    `[splitCompositePlayers] opening ${dbPath} (${args.apply ? 'APPLY' : 'dry-run'})`,
  );
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const plan = buildPlan(db);
  printPlan(plan, args.apply);

  if (!args.apply) {
    console.log('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  const result = applyPlan(db, plan);
  printResult(result);
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
