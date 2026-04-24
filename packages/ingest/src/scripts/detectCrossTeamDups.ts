// detectCrossTeamDups.ts — Wave H7 Lane 1 (Han 😉🚀).
//
// Read-only audit that surfaces players sharing a normalized name across
// multiple `team_id` values. Emits one `ingest_anomalies` row per unique
// (name, team-pair) combination so the H6-style merge sweep
// (`dedup:cross-team`) can find them next time without manual prompting.
//
// This script ALWAYS writes to `ingest_anomalies` (no --apply gate); it is
// pure logging, not data mutation. It is idempotent — re-running does not
// duplicate rows.
//
// Usage:
//   pnpm --filter @pll/ingest detect:cross-team-dups
//
// No `checkServerProcs` guard needed: better-sqlite3 handles concurrent
// writes on a single file fine, and servers reading anomalies don't conflict
// with anomaly inserts.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { insertAnomaly } from '../pipelines/anomalies.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:detectCrossTeamDups' });
export interface DetectionGroup {
  name: string;
  instances: { id: number; team_id: number }[];
}

export interface DetectionResult {
  groupsFound: number;
  anomaliesInserted: number;
  anomaliesSkipped: number;
}

const STRATEGY = 'cross-team-duplicate-name';
const SOURCE_POST_ID = 'detect-cross-team-dups';

interface RawGroup {
  k: string;
  instances: string;
  n: number;
}

/** Find every player name appearing on more than one team_id. */
export function findCrossTeamGroups(db: Database): DetectionGroup[] {
  const rows = db
    .prepare<[], RawGroup>(
      `SELECT LOWER(TRIM(name)) AS k,
              GROUP_CONCAT(id || ':' || team_id, ',') AS instances,
              COUNT(*) AS n
       FROM players
       GROUP BY k
       HAVING n > 1`,
    )
    .all();

  const groups: DetectionGroup[] = [];
  for (const r of rows) {
    const instances = r.instances.split(',').map((pair) => {
      const [idStr, teamStr] = pair.split(':');
      return { id: Number(idStr), team_id: Number(teamStr) };
    });
    // Only true cross-team dupes: 2+ distinct team_ids.
    const teams = new Set(instances.map((i) => i.team_id));
    if (teams.size < 2) continue;
    groups.push({ name: r.k, instances });
  }
  return groups;
}

function buildRawLine(name: string): string {
  return `player_name=${name}`;
}

function buildReason(group: DetectionGroup): string {
  const parts = group.instances
    .map((i) => `${i.id}(team=${i.team_id})`)
    .join(', ');
  return `Same player name appears on multiple teams: ${parts}; review with dedup:cross-team`;
}

/** Emit anomalies for each group. Idempotent: skips rows already present. */
export function emitAnomalies(
  db: Database,
  groups: DetectionGroup[],
): DetectionResult {
  const existsStmt = db.prepare<[string, string], { c: number }>(
    `SELECT COUNT(*) AS c FROM ingest_anomalies
     WHERE strategy_attempted = ? AND raw_line = ?`,
  );

  let inserted = 0;
  let skipped = 0;
  for (const g of groups) {
    const rawLine = buildRawLine(g.name);
    const exists = (existsStmt.get(STRATEGY, rawLine)?.c ?? 0) > 0;
    if (exists) {
      skipped += 1;
      continue;
    }
    insertAnomaly(db, {
      sourcePostId: SOURCE_POST_ID,
      sourceUrl: '',
      rawLine,
      parentGameId: null,
      strategyAttempted: STRATEGY,
      reason: buildReason(g),
    });
    inserted += 1;
  }
  return { groupsFound: groups.length, anomaliesInserted: inserted, anomaliesSkipped: skipped };
}

/** Combined detect + emit. Convenience wrapper used by the CLI and tests. */
export function detectAndEmit(db: Database): DetectionResult {
  const groups = findCrossTeamGroups(db);
  return emitAnomalies(db, groups);
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath =
    process.env.PLL_DB_PATH ??
    resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  log.info(`[detectCrossTeamDups] opening ${dbPath}`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const result = detectAndEmit(db);
  log.info(`──────── detectCrossTeamDups summary ────────`);
  log.info(`cross-team groups found : ${result.groupsFound}`);
  log.info(`anomalies inserted      : ${result.anomaliesInserted}`);
  log.info(`anomalies skipped (dupe): ${result.anomaliesSkipped}`);
  log.info(`──────────────────────────────────────────────`);
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
