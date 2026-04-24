// reattributeJunkStats.ts — handle the 4 stat rows still bound to junk
// player rows after Wave 5 cleanup.
//
// Wave 5 Lane 1's cleanup script PRESERVED player rows that had linked
// player_stats (safety: don't drop real stat attribution). Wave 6 Lane 1
// finishes the job by deciding what to do with each survivor:
//
//   id   | name              | team             | game | decision
//   -----+-------------------+------------------+------+-------------------
//   434  | Dylan Bella's     | Abington Heights | 32   | RENAME in place
//                                                       (no canonical
//                                                       "Dylan Bella" row
//                                                       exists; rename the
//                                                       junk row itself
//                                                       and re-normalize.)
//   974  | Ryan's Turse      | WC Henderson     | 150  | REATTRIBUTE to
//                                                       canonical id 258
//                                                       "Ryan Turse" then
//                                                       DELETE the junk row.
//   1007 | No name provided  | Spring-Ford      | 154  | SOFT-FLAG only
//                                                       (no canonical
//                                                       attributable; log
//                                                       to ingest_anomalies
//                                                       and leave the FK
//                                                       alone so the goal/
//                                                       save totals stay
//                                                       intact at game level).
//   1235 | None              | Parkland         | 167  | SOFT-FLAG only
//                                                       (same rationale).
//
// Why soft-flag the unknowns instead of inventing a sentinel "(unknown)"
// player: the per-team-aggregate views downstream sum player_stats by
// player.team_id, so the goals/assists already roll up to the correct
// team. A sentinel row would require either per-team sentinels (clutter)
// or a NULL team_id (which the players.team_id NOT NULL constraint
// disallows). Logging to ingest_anomalies preserves the audit trail
// without further schema gymnastics.
//
// Idempotent: the script checks for each transformation's prior state and
// no-ops if already applied. Safe to re-run.
//
// Usage:
//   pnpm --filter @pll/ingest reattribute:junk            # dry-run
//   pnpm --filter @pll/ingest reattribute:junk -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizePlayerName } from '../normalize/playerName.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:reattributeJunkStats' });
export type ActionKind = 'rename' | 'reattribute' | 'soft-flag';

export interface RenamePlan {
  kind: 'rename';
  junkId: number;
  fromName: string;
  toName: string;
  toNormalized: string;
}

export interface ReattributePlan {
  kind: 'reattribute';
  junkId: number;
  fromName: string;
  canonicalId: number;
  canonicalName: string;
  statIds: number[];
}

export interface SoftFlagPlan {
  kind: 'soft-flag';
  junkId: number;
  fromName: string;
  gameIds: number[];
  reason: string;
}

export type Plan = RenamePlan | ReattributePlan | SoftFlagPlan;

export interface JunkSpec {
  junkId: number;
  /** Discriminates how to resolve this row. */
  resolution:
    | { kind: 'rename'; toName: string }
    | { kind: 'reattribute'; canonicalName: string }
    | { kind: 'soft-flag' };
}

export const JUNK_SPECS: readonly JunkSpec[] = [
  { junkId: 434, resolution: { kind: 'rename', toName: 'Dylan Bella' } },
  { junkId: 974, resolution: { kind: 'reattribute', canonicalName: 'Ryan Turse' } },
  { junkId: 1007, resolution: { kind: 'soft-flag' } },
  { junkId: 1235, resolution: { kind: 'soft-flag' } },
];

export const ANOMALY_STRATEGY = 'wave6-reattribute-junk-stats';

interface PlayerRow {
  id: number;
  name: string;
  name_normalized: string;
  team_id: number;
}

interface StatRow {
  id: number;
  game_id: number;
}

interface GameRow {
  id: number;
  source_post_id: string;
  recap_url: string | null;
}

function getPlayer(db: Database, id: number): PlayerRow | null {
  const row = db
    .prepare('SELECT id, name, name_normalized, team_id FROM players WHERE id = ?')
    .get(id) as PlayerRow | undefined;
  return row ?? null;
}

function findCanonical(db: Database, teamId: number, name: string): PlayerRow | null {
  const norm = normalizePlayerName(name);
  if (!norm) return null;
  const row = db
    .prepare(
      `SELECT id, name, name_normalized, team_id
         FROM players WHERE team_id = ? AND name_normalized = ? LIMIT 1`,
    )
    .get(teamId, norm) as PlayerRow | undefined;
  return row ?? null;
}

function getStats(db: Database, playerId: number): StatRow[] {
  return db
    .prepare('SELECT id, game_id FROM player_stats WHERE player_id = ? ORDER BY id')
    .all(playerId) as StatRow[];
}

function getGame(db: Database, gameId: number): GameRow | null {
  const row = db
    .prepare('SELECT id, source_post_id, recap_url FROM games WHERE id = ?')
    .get(gameId) as GameRow | undefined;
  return row ?? null;
}

function anomalyExists(db: Database, sourcePostId: string, rawLine: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM ingest_anomalies
        WHERE source_post_id = ? AND raw_line = ? AND strategy_attempted = ? LIMIT 1`,
    )
    .get(sourcePostId, rawLine, ANOMALY_STRATEGY);
  return Boolean(row);
}

export interface BuildPlanResult {
  plans: Plan[];
  /** Junk ids whose row is no longer present (already cleaned). */
  alreadyResolved: number[];
  /** Junk ids whose canonical target couldn't be found — needs operator review. */
  unresolved: Array<{ junkId: number; reason: string }>;
}

export function buildPlan(
  db: Database,
  specs: readonly JunkSpec[] = JUNK_SPECS,
): BuildPlanResult {
  const plans: Plan[] = [];
  const alreadyResolved: number[] = [];
  const unresolved: Array<{ junkId: number; reason: string }> = [];

  for (const spec of specs) {
    const player = getPlayer(db, spec.junkId);
    if (!player) {
      alreadyResolved.push(spec.junkId);
      continue;
    }

    if (spec.resolution.kind === 'rename') {
      const targetNorm = normalizePlayerName(spec.resolution.toName);
      if (!targetNorm) {
        unresolved.push({ junkId: spec.junkId, reason: 'rename target normalized to empty' });
        continue;
      }
      if (player.name === spec.resolution.toName && player.name_normalized === targetNorm) {
        alreadyResolved.push(spec.junkId);
        continue;
      }
      // Reject if a canonical row with that normalized name already exists on
      // the team — would collide with the UNIQUE (team_id, name_normalized)
      // index. In that case the right move is "reattribute", not "rename".
      const collision = db
        .prepare(
          `SELECT id FROM players
            WHERE team_id = ? AND name_normalized = ? AND id != ? LIMIT 1`,
        )
        .get(player.team_id, targetNorm, player.id) as { id: number } | undefined;
      if (collision) {
        unresolved.push({
          junkId: spec.junkId,
          reason: `rename would collide with existing player id=${collision.id}`,
        });
        continue;
      }
      plans.push({
        kind: 'rename',
        junkId: spec.junkId,
        fromName: player.name,
        toName: spec.resolution.toName,
        toNormalized: targetNorm,
      });
    } else if (spec.resolution.kind === 'reattribute') {
      const canonical = findCanonical(db, player.team_id, spec.resolution.canonicalName);
      if (!canonical) {
        unresolved.push({
          junkId: spec.junkId,
          reason: `no canonical "${spec.resolution.canonicalName}" on team ${player.team_id}`,
        });
        continue;
      }
      const stats = getStats(db, spec.junkId);
      // Detect UNIQUE(game_id, player_id) conflicts before we commit.
      const conflict = db.prepare(
        'SELECT id FROM player_stats WHERE game_id = ? AND player_id = ?',
      );
      for (const s of stats) {
        if (conflict.get(s.game_id, canonical.id)) {
          unresolved.push({
            junkId: spec.junkId,
            reason: `canonical id=${canonical.id} already has stats on game ${s.game_id}`,
          });
        }
      }
      if (unresolved.some((u) => u.junkId === spec.junkId)) continue;
      plans.push({
        kind: 'reattribute',
        junkId: spec.junkId,
        fromName: player.name,
        canonicalId: canonical.id,
        canonicalName: canonical.name,
        statIds: stats.map((s) => s.id),
      });
    } else {
      const stats = getStats(db, spec.junkId);
      plans.push({
        kind: 'soft-flag',
        junkId: spec.junkId,
        fromName: player.name,
        gameIds: stats.map((s) => s.game_id),
        reason: `unattributable junk player name "${player.name}" surviving Wave 5 sweep`,
      });
    }
  }

  return { plans, alreadyResolved, unresolved };
}

export interface ApplyResult {
  renamed: number;
  reattributed: number;
  reattributedStats: number;
  deletedJunkPlayers: number;
  softFlagged: number;
  anomaliesInserted: number;
  anomaliesAlreadyPresent: number;
}

export function applyPlan(db: Database, planResult: BuildPlanResult): ApplyResult {
  const result: ApplyResult = {
    renamed: 0,
    reattributed: 0,
    reattributedStats: 0,
    deletedJunkPlayers: 0,
    softFlagged: 0,
    anomaliesInserted: 0,
    anomaliesAlreadyPresent: 0,
  };

  const renameStmt = db.prepare(
    'UPDATE players SET name = ?, name_normalized = ? WHERE id = ?',
  );
  const reattribStmt = db.prepare(
    'UPDATE player_stats SET player_id = ? WHERE player_id = ?',
  );
  const deletePlayer = db.prepare('DELETE FROM players WHERE id = ?');
  const insertAnomaly = db.prepare(
    `INSERT INTO ingest_anomalies
       (source_post_id, source_url, raw_line, parent_game_id,
        strategy_attempted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const plan of planResult.plans) {
      if (plan.kind === 'rename') {
        renameStmt.run(plan.toName, plan.toNormalized, plan.junkId);
        result.renamed += 1;
      } else if (plan.kind === 'reattribute') {
        const info = reattribStmt.run(plan.canonicalId, plan.junkId);
        result.reattributedStats += info.changes;
        deletePlayer.run(plan.junkId);
        result.reattributed += 1;
        result.deletedJunkPlayers += 1;
      } else {
        for (const gameId of plan.gameIds) {
          const game = getGame(db, gameId);
          if (!game) continue;
          const url = game.recap_url ?? `https://phillylacrosse.com/2026/${game.source_post_id}/`;
          if (anomalyExists(db, game.source_post_id, plan.fromName)) {
            result.anomaliesAlreadyPresent += 1;
            continue;
          }
          insertAnomaly.run(
            game.source_post_id,
            url,
            plan.fromName,
            gameId,
            ANOMALY_STRATEGY,
            plan.reason,
            new Date().toISOString(),
          );
          result.anomaliesInserted += 1;
        }
        result.softFlagged += 1;
      }
    }
  });
  tx();

  return result;
}

function printPlan(planResult: BuildPlanResult, apply: boolean): void {
  const header = apply ? 'Applying' : 'Dry-run plan';
  log.info(`-------- ${header}: reattributeJunkStats --------`);
  for (const p of planResult.plans) {
    if (p.kind === 'rename') {
      log.info(
        `  rename       id=${p.junkId}  "${p.fromName}" -> "${p.toName}" (norm="${p.toNormalized}")`,
      );
    } else if (p.kind === 'reattribute') {
      log.info(
        `  reattribute  id=${p.junkId} "${p.fromName}" -> id=${p.canonicalId} "${p.canonicalName}"  stats=[${p.statIds.join(',')}]  then DELETE junk player`,
      );
    } else {
      log.info(
        `  soft-flag    id=${p.junkId} "${p.fromName}"  games=[${p.gameIds.join(',')}]  (FK left in place)`,
      );
    }
  }
  if (planResult.alreadyResolved.length > 0) {
    log.info(`already resolved (no-op): ${planResult.alreadyResolved.join(',')}`);
  }
  if (planResult.unresolved.length > 0) {
    log.info(`!! UNRESOLVED (manual review):`);
    for (const u of planResult.unresolved) {
      log.info(`    id=${u.junkId}: ${u.reason}`);
    }
  }
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDb = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const dbPath = process.env.DB_PATH ?? defaultDb;
  log.info(`[reattributeJunkStats] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);

  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const planResult = buildPlan(db);
  printPlan(planResult, apply);

  if (!apply) {
    log.info('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  const result = applyPlan(db, planResult);
  log.info('\n-------- Apply result --------');
  log.info(JSON.stringify(result, null, 2));

  const fkIssues = db.pragma('foreign_key_check') as unknown[];
  if (fkIssues.length > 0) {
    log.error('FOREIGN KEY CHECK reported issues:');
    log.error(fkIssues);
    process.exitCode = 1;
  } else {
    log.info('foreign_key_check: clean');
  }

  const playerCount = (db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n;
  log.info(`players total: ${playerCount}`);
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
