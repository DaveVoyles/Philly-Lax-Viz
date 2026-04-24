// dedupStateSuffixTeams.ts — Wave 15 Lane 1 (Chewy 🐻💪).
//
// After W14 added state-suffix stripping inside `normalizeTeamName`, many
// teams that ingest had previously stored under both forms — e.g.
// "Pennington (NJ)" (id=159) AND "Pennington" (id=??) — collide on
// normalized name but were not merged by the W4 / W8 dedup passes
// (those treat NJ/NY suffixes as legitimate disambiguation markers).
//
// This script finds every (suffixed, bare) pair where
//   normalizeTeamName(suffixed) === normalizeTeamName(bare)
// and merges into the BARE row (canonical). The suffixed row's exact
// display name is preserved as a `team_aliases` entry so future ingest
// of "(NJ)"-tagged sources still resolves correctly.
//
// Dry-run by default. Use `--apply` to commit. Audit JSON is always
// written to data/state-suffix-dedup-w15.json.
//
// Usage:
//   pnpm --filter @pll/ingest tsx src/scripts/dedupStateSuffixTeams.ts
//   pnpm --filter @pll/ingest tsx src/scripts/dedupStateSuffixTeams.ts --apply

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizeTeamName } from '../pipelines/teamResolver.js';
import { mergeTeam } from './dedupTeams.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:dedupStateSuffixTeams' });
interface TeamRow {
  id: number;
  name: string;
  slug: string;
}

export interface StateSuffixPair {
  suffixedId: number;
  suffixedName: string;
  bareId: number;
  bareName: string;
  suffix: string; // e.g. "NJ"
  normalized: string; // normalizeTeamName() result both share
}

export interface StateSuffixMergeResult {
  pair: StateSuffixPair;
  applied: boolean;
  gamesMoved: number;
  playersMoved: number;
  aliasesMoved: number;
  collisions: number;
  aliasInserted: boolean;
}

/** Match "Foo Bar (XX)" / "Foo Bar (XXX)" — uppercase 2–3 letter suffix. */
const STATE_SUFFIX_RE = /\s*\(([A-Z]{2,3})\)\s*$/;

function gameCount(db: Database, teamId: number): number {
  return (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM games WHERE home_team_id = ? OR away_team_id = ?',
      )
      .get(teamId, teamId) as { c: number }
  ).c;
}

/**
 * Find all collision pairs. Lookup-only. Pairs are returned with
 * `bareId` always pointing at the no-suffix row (canonical).
 */
export function findStateSuffixPairs(db: Database): StateSuffixPair[] {
  const all = db
    .prepare('SELECT id, name, slug FROM teams ORDER BY id')
    .all() as TeamRow[];

  const suffixed: Array<TeamRow & { suffix: string; normalized: string }> = [];
  const bareByNorm = new Map<string, TeamRow>();

  for (const t of all) {
    const m = STATE_SUFFIX_RE.exec(t.name);
    if (m) {
      suffixed.push({
        ...t,
        suffix: m[1]!.toUpperCase(),
        normalized: normalizeTeamName(t.name),
      });
    } else {
      const norm = normalizeTeamName(t.name);
      // Prefer the bare row with the most games (or lowest id on tie) when
      // multiple bare rows share the same normalized key — extremely rare,
      // but defensive.
      const existing = bareByNorm.get(norm);
      if (!existing) {
        bareByNorm.set(norm, t);
      } else if (gameCount(db, t.id) > gameCount(db, existing.id)) {
        bareByNorm.set(norm, t);
      }
    }
  }

  const pairs: StateSuffixPair[] = [];
  for (const s of suffixed) {
    const bare = bareByNorm.get(s.normalized);
    if (!bare) continue;
    if (bare.id === s.id) continue; // shouldn't happen but defensive
    pairs.push({
      suffixedId: s.id,
      suffixedName: s.name,
      bareId: bare.id,
      bareName: bare.name,
      suffix: s.suffix,
      normalized: s.normalized,
    });
  }
  return pairs;
}

/**
 * Merge each pair: bare row is canonical; suffixed row's games/players/etc.
 * move into bare via existing `mergeTeam` helper. The suffixed display name
 * is preserved as a `team_aliases` row before the merge so the alias survives
 * the merge (mergeTeam() repoints + dedups team_aliases).
 */
export function dedupStateSuffixTeams(
  db: Database,
  apply: boolean,
): StateSuffixMergeResult[] {
  const pairs = findStateSuffixPairs(db);
  if (!apply) {
    return pairs.map((pair) => ({
      pair,
      applied: false,
      gamesMoved: gameCount(db, pair.suffixedId),
      playersMoved: (
        db
          .prepare('SELECT COUNT(*) AS c FROM players WHERE team_id = ?')
          .get(pair.suffixedId) as { c: number }
      ).c,
      aliasesMoved: (
        db
          .prepare('SELECT COUNT(*) AS c FROM team_aliases WHERE team_id = ?')
          .get(pair.suffixedId) as { c: number }
      ).c,
      collisions: 0,
      aliasInserted: false,
    }));
  }

  const reports: StateSuffixMergeResult[] = [];
  const tx = db.transaction(() => {
    for (const pair of pairs) {
      const gamesMoved = gameCount(db, pair.suffixedId);
      const playersMoved = (
        db
          .prepare('SELECT COUNT(*) AS c FROM players WHERE team_id = ?')
          .get(pair.suffixedId) as { c: number }
      ).c;
      const aliasesMoved = (
        db
          .prepare('SELECT COUNT(*) AS c FROM team_aliases WHERE team_id = ?')
          .get(pair.suffixedId) as { c: number }
      ).c;

      // Insert the suffixed display name as an alias on the BARE (canonical)
      // row before the merge runs. team_aliases.alias is UNIQUE — INSERT OR
      // IGNORE handles the case where the alias already points at the
      // suffixed row (mergeTeam will then repoint it to bare).
      let aliasInserted = false;
      try {
        const info = db
          .prepare(
            "INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence) VALUES (?, ?, 'state-suffix-dedup-w15', 1.0)",
          )
          .run(pair.suffixedName, pair.bareId);
        aliasInserted = info.changes > 0;
      } catch {
        /* table presence guaranteed by migrations */
      }

      const anomalies: string[] = [];
      const collisions = mergeTeam(db, pair.suffixedId, pair.bareId, anomalies);

      reports.push({
        pair,
        applied: true,
        gamesMoved,
        playersMoved,
        aliasesMoved,
        collisions,
        aliasInserted,
      });
    }
  });
  tx();
  return reports;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath =
    process.env.DB_PATH ??
    process.env.PLL_DB_PATH ??
    resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  const auditPath = resolve(
    here,
    '..',
    '..',
    '..',
    '..',
    'data',
    'state-suffix-dedup-w15.json',
  );

  log.info(`[dedupStateSuffixTeams] db=${dbPath} apply=${apply}`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const pre = {
    teams: (db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c,
    games: (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c,
    aliases: (
      db.prepare('SELECT COUNT(*) AS c FROM team_aliases').get() as { c: number }
    ).c,
  };

  const reports = dedupStateSuffixTeams(db, apply);

  const post = {
    teams: (db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c,
    games: (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c,
    aliases: (
      db.prepare('SELECT COUNT(*) AS c FROM team_aliases').get() as { c: number }
    ).c,
  };

  for (const r of reports) {
    const verb = r.applied ? 'merged' : 'WOULD-merge';
    log.info(
      `[${verb}] "${r.pair.suffixedName}" id=${r.pair.suffixedId} → "${r.pair.bareName}" id=${r.pair.bareId} ` +
        `(games=${r.gamesMoved} players=${r.playersMoved} aliases=${r.aliasesMoved} collisions=${r.collisions} aliasIns=${r.aliasInserted})`,
    );
  }

  log.info('\n──────── State-Suffix Dedup Summary (W15) ────────');
  log.info(`pairs found : ${reports.length}`);
  log.info(`applied     : ${apply}`);
  log.info(`teams       : ${pre.teams} → ${post.teams}`);
  log.info(`games       : ${pre.games} → ${post.games}`);
  log.info(`aliases     : ${pre.aliases} → ${post.aliases}`);

  writeFileSync(
    auditPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        apply,
        pre,
        post,
        pair_count: reports.length,
        merges: reports.map((r) => ({
          suffixed: { id: r.pair.suffixedId, name: r.pair.suffixedName },
          bare: { id: r.pair.bareId, name: r.pair.bareName },
          suffix: r.pair.suffix,
          normalized: r.pair.normalized,
          gamesMoved: r.gamesMoved,
          playersMoved: r.playersMoved,
          aliasesMoved: r.aliasesMoved,
          collisions: r.collisions,
          aliasInserted: r.aliasInserted,
          applied: r.applied,
        })),
      },
      null,
      2,
    ),
  );
  log.info(`audit       : ${auditPath}`);

  if (apply) {
    const fkIssues = db.pragma('foreign_key_check') as unknown[];
    if (fkIssues.length > 0) {
      log.error('FOREIGN KEY CHECK reported issues:');
      log.error(fkIssues);
      process.exitCode = 1;
    } else {
      log.info('foreign_key_check: clean');
    }
  }

  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
