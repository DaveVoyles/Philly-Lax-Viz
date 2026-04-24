// dedupCrossTeam.ts — merge players that share an exact (case/whitespace
// insensitive) name across DIFFERENT team_ids.
//
// Wave H6 Lane 1. Background: H5's composite-name split (splitCompositePlayers)
// created a handful of cross-team duplicate rows (e.g. Mason Proctor on
// team 108 and team 491; Javier Gonzalez-Cruz on team 108 and team 491).
// `dedupPlayers.ts` intentionally only collapses SAME-team dupes, so these
// cross-team pairs need their own pass.
//
// Behavior (per group of 2+ player rows sharing LOWER(TRIM(name))):
//   1. keep_id = the player_id with the most player_stats rows
//      (games_played). Tie-break: lower id wins.
//   2. For each other_id in the group:
//        - UPDATE player_stats SET player_id = keep_id
//          WHERE player_id = other_id
//            AND game_id NOT IN (SELECT game_id
//                                FROM player_stats
//                                WHERE player_id = keep_id)
//        - For each colliding game_id (both players had a stat row in the
//          same game): log a warning and leave the other_id row in place.
//          Stats are NOT auto-merged.
//        - DELETE FROM players WHERE id = other_id ONLY when no stat rows
//          remain attached to other_id.
//
// Dry-run by default. Pass --apply to commit.
//
// Usage:
//   pnpm --filter @pll/ingest dedup:cross-team           # dry-run
//   pnpm --filter @pll/ingest dedup:cross-team -- --apply  # writes
//
// TODO(H6 Lane 3): once Leia's `lib/checkServerProcs.ts` lands, import it
// and gate the --apply path on a clean dev-server check. For now the
// orchestrator handles that out of band.
//
// (Wired: `checkServerProcs` is called below before --apply commits.)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { checkServerProcs } from './lib/checkServerProcs.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:dedupCrossTeam' });
export interface PlayerRow {
  id: number;
  name: string;
  team_id: number;
  games_played: number;
}

export interface CollisionWarning {
  keepId: number;
  otherId: number;
  gameId: number;
}

export interface MergeAction {
  normalizedKey: string;
  displayName: string;
  keepId: number;
  keepTeamId: number;
  keepGames: number;
  others: PlayerRow[];
}

export interface DedupPlan {
  actions: MergeAction[];
  preCount: number;
}

export interface DedupResult extends DedupPlan {
  postCount: number;
  rowsRepointed: number;
  rowsSkippedCollision: number;
  playersDeleted: number;
  collisions: CollisionWarning[];
}

interface RawPlayer {
  id: number;
  name: string;
  team_id: number;
}

/** Build the dedup plan: enumerate every cross-team duplicate name group. */
export function buildPlan(db: Database): DedupPlan {
  const groups = db
    .prepare<[], { key: string; ids: string }>(
      `SELECT LOWER(TRIM(name)) AS key, GROUP_CONCAT(id) AS ids
       FROM players
       GROUP BY LOWER(TRIM(name))
       HAVING COUNT(*) > 1
       ORDER BY key`,
    )
    .all();

  const actions: MergeAction[] = [];
  const gamesStmt = db.prepare<[number], { c: number }>(
    'SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?',
  );
  const playerStmt = db.prepare<[number], RawPlayer>(
    'SELECT id, name, team_id FROM players WHERE id = ?',
  );

  for (const g of groups) {
    const ids = g.ids.split(',').map((s) => Number(s));
    const rows: PlayerRow[] = ids.map((id) => {
      const p = playerStmt.get(id);
      if (!p) throw new Error(`dedupCrossTeam: player ${id} vanished`);
      const games = gamesStmt.get(id)?.c ?? 0;
      return { id: p.id, name: p.name, team_id: p.team_id, games_played: games };
    });

    // Skip same-team groups — those are dedupPlayers.ts's job.
    const teamIds = new Set(rows.map((r) => r.team_id));
    if (teamIds.size < 2) continue;

    // keep = most games_played, tiebreak lower id.
    rows.sort((a, b) => {
      if (b.games_played !== a.games_played) return b.games_played - a.games_played;
      return a.id - b.id;
    });
    const [keep, ...others] = rows;
    actions.push({
      normalizedKey: g.key,
      displayName: keep!.name,
      keepId: keep!.id,
      keepTeamId: keep!.team_id,
      keepGames: keep!.games_played,
      others,
    });
  }

  const preCount = (db.prepare('SELECT COUNT(*) AS c FROM players').get() as {
    c: number;
  }).c;

  return { actions, preCount };
}

/** Apply the plan inside a single transaction. */
export function applyPlan(db: Database, plan: DedupPlan): DedupResult {
  let rowsRepointed = 0;
  let rowsSkippedCollision = 0;
  let playersDeleted = 0;
  const collisions: CollisionWarning[] = [];

  const tx = db.transaction(() => {
    for (const a of plan.actions) {
      for (const other of a.others) {
        // Detect collisions first (game_ids present on both keep & other).
        const collidingGames = db
          .prepare<[number, number], { game_id: number }>(
            `SELECT game_id FROM player_stats
             WHERE player_id = ?
               AND game_id IN (SELECT game_id FROM player_stats WHERE player_id = ?)`,
          )
          .all(other.id, a.keepId);
        for (const c of collidingGames) {
          collisions.push({ keepId: a.keepId, otherId: other.id, gameId: c.game_id });
          rowsSkippedCollision += 1;
        }

        // Repoint non-colliding stat rows.
        const info = db
          .prepare(
            `UPDATE player_stats SET player_id = ?
             WHERE player_id = ?
               AND game_id NOT IN (SELECT game_id FROM player_stats WHERE player_id = ?)`,
          )
          .run(a.keepId, other.id, a.keepId);
        rowsRepointed += info.changes;

        // Delete the other player row only if it has zero remaining stats.
        const remaining = (
          db
            .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
            .get(other.id) as { c: number }
        ).c;
        if (remaining === 0) {
          db.prepare('DELETE FROM players WHERE id = ?').run(other.id);
          playersDeleted += 1;
        }
      }
    }
  });
  tx();

  const postCount = (db.prepare('SELECT COUNT(*) AS c FROM players').get() as {
    c: number;
  }).c;

  return {
    ...plan,
    postCount,
    rowsRepointed,
    rowsSkippedCollision,
    playersDeleted,
    collisions,
  };
}

function printPlan(plan: DedupPlan, apply: boolean): void {
  const header = apply ? 'Applying' : 'Dry-run plan';
  log.info(`──────── ${header}: dedupCrossTeam ────────`);
  log.info(`Pre-count: ${plan.preCount} players`);
  log.info(`Cross-team duplicate groups detected: ${plan.actions.length}`);
  if (plan.actions.length === 0) {
    log.info('  (none — nothing to do)');
    return;
  }
  let n = 0;
  for (const a of plan.actions) {
    n += 1;
    log.info(
      `\n  ${n}. "${a.displayName}" (key="${a.normalizedKey}")` +
        `\n     keep #${a.keepId} team=${a.keepTeamId} games=${a.keepGames}`,
    );
    for (const o of a.others) {
      log.info(
        `     drop #${o.id} team=${o.team_id} games=${o.games_played}` +
          ` → repoint stats to #${a.keepId}`,
      );
    }
  }
}

function printResult(r: DedupResult): void {
  log.info('\n──────── Apply result ────────');
  log.info(`players               ${r.preCount} → ${r.postCount}`);
  log.info(`pairs found          : ${r.actions.length}`);
  log.info(`stat rows repointed  : ${r.rowsRepointed}`);
  log.info(`rows skipped (collision): ${r.rowsSkippedCollision}`);
  log.info(`players deleted      : ${r.playersDeleted}`);
  if (r.collisions.length > 0) {
    log.info('\n⚠️  Game-id collisions (other player kept, manual review):');
    for (const c of r.collisions) {
      log.info(
        `   - game=${c.gameId}: both player#${c.keepId} (keep) and #${c.otherId} have stats`,
      );
    }
  }
  log.info('──────────────────────────────');
}

function parseArgs(argv: string[]): { apply: boolean; force: boolean } {
  return {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  if (args.apply) {
    checkServerProcs({ force: args.force });
  }
  log.info(
    `[dedupCrossTeam] opening ${dbPath} (${args.apply ? 'APPLY' : 'dry-run'})`,
  );
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const plan = buildPlan(db);
  printPlan(plan, args.apply);

  if (!args.apply) {
    log.info('\n(Dry-run only. Re-run with --apply to write.)');
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
