// cleanGhostTeams.ts — Wave 14 Lane 1 (Yoda 🧙‍♂️🟢).
//
// Sweep "ghost" team rows that the score-line probe created from sub-header
// abbreviations ("PR", "DV", "OH" — sub-headers, not real teams). Chewy's
// W13 alias work knocked out a lot, but a few stragglers remain in the DB.
//
// Criteria for a ghost candidate (ALL must hold):
//   - team name length <= 3 chars OR matches /^[A-Z]{1,3}$/
//   - zero rows in `games` referencing the team (home_team_id, away_team_id)
//   - zero rows in `player_stats` linked through `players.team_id`
//
// Best-effort orphan recovery: if a ghost team has linked players but those
// players have player_stats whose game has another team that the ghost name
// is a plausible initials/alias match for, repoint players to that team
// before deleting. Audit log written to data/cleanup-log-w14.json.
//
// Safety:
//   - Default DRY-RUN. Use --apply to write.
//   - All deletes / repoints inside one BEGIN/COMMIT.
//   - PRAGMA foreign_key_check verified after apply.
//   - Pre-flight prints all candidates so you can sanity-check.
//
// Usage:
//   pnpm --filter @pll/ingest clean:ghosts            # dry-run
//   pnpm --filter @pll/ingest clean:ghosts -- --apply # writes

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { partialMatchesTeam } from '../pipelines/summaries.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:cleanGhostTeams' });
export interface GhostCandidate {
  id: number;
  name: string;
  slug: string;
  games: number;
  players: number;
  playerStats: number;
}

export interface RepointPlan {
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
  reason: string;
}

export interface GhostCleanupPlan {
  preTeams: number;
  candidates: GhostCandidate[];
  deletable: GhostCandidate[];
  repoints: RepointPlan[];
  skipped: GhostCandidate[];
}

export interface GhostCleanupResult extends GhostCleanupPlan {
  postTeams: number;
  deleted: number;
  repointed: number;
}

interface TeamRowFull {
  id: number;
  name: string;
  slug: string;
}

/**
 * Predicate: is this team-name shape a "ghost" candidate? Length <= 3 OR
 * a 1-3 letter ALL-CAPS token.
 */
export function looksLikeGhostName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length <= 3) return true;
  if (/^[A-Z]{1,3}$/.test(trimmed)) return true;
  return false;
}

export function buildPlan(db: Database): GhostCleanupPlan {
  const preTeams = (db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n;
  const allTeams = db
    .prepare('SELECT id, name, slug FROM teams')
    .all() as TeamRowFull[];

  const candidates: GhostCandidate[] = [];
  for (const t of allTeams) {
    if (!looksLikeGhostName(t.name)) continue;
    const games = (db
      .prepare('SELECT COUNT(*) AS n FROM games WHERE home_team_id = ? OR away_team_id = ?')
      .get(t.id, t.id) as { n: number }).n;
    const players = (db
      .prepare('SELECT COUNT(*) AS n FROM players WHERE team_id = ?')
      .get(t.id) as { n: number }).n;
    const playerStats = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM player_stats ps
           JOIN players p ON ps.player_id = p.id
          WHERE p.team_id = ?`,
      )
      .get(t.id) as { n: number }).n;
    candidates.push({ id: t.id, name: t.name, slug: t.slug, games, players, playerStats });
  }

  const deletable: GhostCandidate[] = [];
  const repoints: RepointPlan[] = [];
  const skipped: GhostCandidate[] = [];

  for (const c of candidates) {
    if (c.games === 0 && c.players === 0 && c.playerStats === 0) {
      deletable.push(c);
      continue;
    }

    // Best-effort: if the only attachment is players with stats whose
    // games have a sibling team whose name initials/word-prefix-matches
    // the ghost name, repoint those players to that sibling.
    if (c.games === 0 && c.players > 0) {
      const playerRows = db
        .prepare('SELECT id FROM players WHERE team_id = ?')
        .all(c.id) as { id: number }[];
      let allRepointed = true;
      for (const pr of playerRows) {
        // Find candidate parent games via player_stats.
        const parentGames = db
          .prepare(
            `SELECT g.id, g.home_team_id, g.away_team_id
               FROM player_stats ps JOIN games g ON ps.game_id = g.id
              WHERE ps.player_id = ?`,
          )
          .all(pr.id) as { id: number; home_team_id: number; away_team_id: number }[];
        if (parentGames.length === 0) {
          // Player with no stats — safe to delete the player too in apply,
          // but keep simple: count it as repointed-to-null = skip ghost.
          allRepointed = false;
          break;
        }
        // Look for a sibling team in those games where partialMatchesTeam(ghost, sibling.name) is true.
        let target: number | null = null;
        for (const g of parentGames) {
          for (const sid of [g.home_team_id, g.away_team_id]) {
            if (sid === c.id) continue;
            const sibling = db
              .prepare('SELECT id, name, slug FROM teams WHERE id = ?')
              .get(sid) as TeamRowFull | undefined;
            if (!sibling) continue;
            if (partialMatchesTeam(c.name, sibling.name)) {
              target = sibling.id;
              break;
            }
          }
          if (target !== null) break;
        }
        if (target === null) {
          allRepointed = false;
          break;
        }
        repoints.push({
          playerId: pr.id,
          fromTeamId: c.id,
          toTeamId: target,
          reason: `ghost team "${c.name}" partial-matches sibling team in shared game`,
        });
      }
      if (allRepointed) {
        deletable.push(c);
      } else {
        // Roll back any partial repoints we queued for this ghost.
        while (repoints.length && repoints[repoints.length - 1]!.fromTeamId === c.id) {
          repoints.pop();
        }
        skipped.push(c);
      }
      continue;
    }

    skipped.push(c);
  }

  return { preTeams, candidates, deletable, repoints, skipped };
}

export function applyPlan(db: Database, plan: GhostCleanupPlan): GhostCleanupResult {
  if (plan.deletable.length === 0 && plan.repoints.length === 0) {
    return { ...plan, postTeams: plan.preTeams, deleted: 0, repointed: 0 };
  }
  const tx = db.transaction(() => {
    const updPlayer = db.prepare('UPDATE players SET team_id = ? WHERE id = ?');
    for (const rp of plan.repoints) updPlayer.run(rp.toTeamId, rp.playerId);

    if (plan.deletable.length > 0) {
      const ids = plan.deletable.map((c) => c.id);
      const placeholders = ids.map(() => '?').join(',');
      // Delete any orphan players left on the ghost team (will only fire
      // when allRepointed but some players had zero stats).
      db.prepare(`DELETE FROM players WHERE team_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM team_aliases WHERE team_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM teams WHERE id IN (${placeholders})`).run(...ids);
    }
  });
  tx();
  const postTeams = (db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n;
  return {
    ...plan,
    postTeams,
    deleted: plan.preTeams - postTeams,
    repointed: plan.repoints.length,
  };
}

function printPlan(plan: GhostCleanupPlan, apply: boolean): void {
  const header = apply ? 'Applying' : 'Dry-run plan';
  log.info(`-------- ${header}: cleanGhostTeams (W14) --------`);
  log.info(`Pre-count: ${plan.preTeams} teams`);
  log.info(`Ghost candidates: ${plan.candidates.length}`);
  for (const c of plan.candidates) {
    log.info(
      `  id=${c.id}  name="${c.name}"  games=${c.games} players=${c.players} stats=${c.playerStats}`,
    );
  }
  log.info(`\nDeletable: ${plan.deletable.length}`);
  for (const c of plan.deletable) {
    log.info(`  delete  id=${c.id}  name="${c.name}"`);
  }
  log.info(`\nPlayer repoints: ${plan.repoints.length}`);
  for (const rp of plan.repoints) {
    log.info(
      `  player ${rp.playerId}: team ${rp.fromTeamId} -> ${rp.toTeamId} (${rp.reason})`,
    );
  }
  if (plan.skipped.length > 0) {
    log.info(`\n!! Skipped (have games or unrepointable players): ${plan.skipped.length}`);
    for (const c of plan.skipped) {
      log.info(`  KEEP  id=${c.id}  name="${c.name}"  games=${c.games} players=${c.players}`);
    }
  }
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDb = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const dbPath = process.env.DB_PATH ?? defaultDb;
  const auditPath = resolve(here, '..', '..', '..', '..', 'data', 'cleanup-log-w14.json');
  log.info(`[cleanGhostTeams] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const plan = buildPlan(db);
  printPlan(plan, apply);

  if (!apply) {
    writeFileSync(auditPath, JSON.stringify({ mode: 'dry-run', plan }, null, 2));
    log.info(`\n(Dry-run only. Audit written to ${auditPath}. Re-run with --apply to write.)`);
    db.close();
    return;
  }

  const result = applyPlan(db, plan);
  writeFileSync(auditPath, JSON.stringify({ mode: 'apply', result }, null, 2));
  log.info('\n-------- Apply result --------');
  log.info(`teams  ${result.preTeams} -> ${result.postTeams}  (deleted ${result.deleted})`);
  log.info(`players repointed: ${result.repointed}`);
  log.info(`audit log: ${auditPath}`);

  const fkIssues = db.pragma('foreign_key_check') as unknown[];
  if (fkIssues.length > 0) {
    log.error('FOREIGN KEY CHECK reported issues:');
    log.error(fkIssues);
    process.exitCode = 1;
  } else {
    log.info('foreign_key_check: clean');
  }
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
