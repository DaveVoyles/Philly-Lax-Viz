// dedupTeams.ts — team-row dedup. Two passes, both idempotent and wrapped in
// a single transaction:
//
//   Pass 0 (W8 explicit pairs):
//     Hardcoded list of (keep_id, merge_from_id) pairs identified by
//     post-Wave-7-backfill audit. These are hyphen-vs-space variants
//     (e.g. "Spring-Ford" vs "Spring Ford") that the suffix-based pass
//     can't catch because neither name has a parenthetical suffix.
//     Reattributes games.home_team_id/away_team_id, players.team_id,
//     team_aliases.team_id, rankings.team_id, game_periods.team_id from
//     merge_from -> keep, then DELETEs the merge_from teams row.
//     Idempotent: rows already merged in a prior run are skipped.
//
//   Pass 1 (W4 parenthetical-suffix dedup, preserved):
//     For each team whose name contains a parenthetical suffix (e.g.
//     "(1)", "(Inter-Ac)", "(MAPL)") merge into the canonical base team.
//     State-marker suffixes "(NJ)" and "(NY)" are preserved.
//
// Backup: when invoked as a script, copies data/lacrosse.db to
// data/lacrosse.db.bak-w8-pre-dedup if that backup does not already exist.
//
// Usage:
//   pnpm --filter @pll/ingest dedup:teams
//
// Foreign-key collisions on UNIQUE indexes (games.UNIQUE(date, home, away),
// players.UNIQUE(team_id, name_normalized)) are handled by redirecting
// dependent rows to the existing target row and deleting the duplicate
// source row, or by skipping the offending update and logging an anomaly
// when no clean resolution is possible.

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizeTeamName, slugifyTeamName } from '../pipelines/teamResolver.js';
import { checkServerProcs } from './lib/checkServerProcs.js';

interface TeamRow {
  id: number;
  name: string;
  slug: string;
}

const STATE_SUFFIXES = new Set(['NJ', 'NY']);

/**
 * Wave 8 explicit dupe pairs. Identified post-W7 backfill (17 -> 74 posts,
 * +372 games, +4900 stats) which re-surfaced hyphen-vs-space team-row
 * duplicates. For each pair the hyphen variant is canonical because PIAA
 * uses hyphens in name_official (Spring-Ford, Hatboro-Horsham). Verified
 * 2026-04-22 against live data/lacrosse.db.
 *
 * - 279 keep Bonner-Prendie  <- 261 Bonner Prendie  (no PIAA match either way)
 * - 100 keep Hatboro-Horsham <- 72  Hatboro Horsham (alias hatborohorsham -> 100)
 * - 239 keep Lake-Lehman     <- 181 Lake Lehman     (no PIAA match either way)
 * -  10 keep New Hope-Solebury <- 73  New Hope Solebury (PIAA matches "new hope solebury";
 *                                                       alias added separately so the
 *                                                       PIAA join still resolves to id 10)
 * -   1 keep Spring-Ford     <- 162 Spring Ford     (alias springford -> 1)
 */
export interface ExplicitPair {
  keepId: number;
  mergeFromId: number;
  reason: string;
}

export const EXPLICIT_PAIRS: readonly ExplicitPair[] = [
  { keepId: 279, mergeFromId: 261, reason: 'Bonner-Prendie hyphen variant canonical (W8)' },
  { keepId: 100, mergeFromId: 72, reason: 'Hatboro-Horsham hyphen variant canonical (W8)' },
  { keepId: 239, mergeFromId: 181, reason: 'Lake-Lehman hyphen variant canonical (W8)' },
  { keepId: 10, mergeFromId: 73, reason: 'New Hope-Solebury hyphen variant canonical (W8)' },
  { keepId: 1, mergeFromId: 162, reason: 'Spring-Ford hyphen variant canonical (W8)' },
  // Wave 10 — Jack Barrack and Springside duplicates surfaced by anomaly
  // analysis after the W9 parser-strictness fix. Canonical chosen by
  // documented convention: lowest id with attached player rows (Jack
  // Barrack id=53 has 3 players) or highest data count where players are
  // absent (Springside id=161 has 9 games vs 28's 8). Aliases for the
  // dropped display names are seeded by seedTeamAliases.ts/PARSER_ABBREVIATIONS.
  { keepId: 53, mergeFromId: 102, reason: 'Jack Barrack: merge "Jack Barrack Academy" → canonical id=53 (W10)' },
  { keepId: 53, mergeFromId: 277, reason: 'Jack Barrack: merge "Jack Barrack Hebrew Academy" → canonical id=53 (W10)' },
  { keepId: 53, mergeFromId: 270, reason: 'Jack Barrack: merge "Barrack Academy" id=270 → canonical id=53 (W10)' },
  { keepId: 161, mergeFromId: 28, reason: 'Springside Chestnut Hill: merge "...Academy" id=28 → canonical id=161 (W10)' },
  // Wave 10 — additional hyphen/abbrev duplicates uncovered by re-ingest
  // anomaly inspection. All have zero players on the merge-from row, so
  // collisions are on games only (handled by mergeTeam).
  { keepId: 100, mergeFromId: 347, reason: 'Hatboro-Horsham hyphen variant canonical; merge "Hatboro Horsham" id=347 (W10)' },
  { keepId: 188, mergeFromId: 85, reason: 'West Chester East: merge "WC East" id=85 → canonical id=188 (W10)' },
  { keepId: 41, mergeFromId: 83, reason: 'WC Henderson: merge "Henderson" id=83 → canonical id=41 (W10; only WCASD Henderson in dataset)' },

  // Wave 17 Lane 1 (Chewy 🐻💪) — final dup-needs-merge cleanup. Pairs
  // surfaced by Yoda 🧙‍♂️🟢's W16 PIAA reconciliation pass and listed in
  // seedTeamAliases.ts UNMAPPABLE_PIAA under category 'dup-needs-merge'.
  // Keep-ids chosen to preserve the existing PIAA alias mapping where one
  // exists (e.g. id 174 holds "springfield twp" → PIAA Springfield Twp 2A;
  // id 69 holds "cb east" → PIAA CB East 3A) so the merge moves divergent
  // rows into match. Verified 2026-04-22 against live data/lacrosse.db.
  //
  // Springfield trio (ids 97, 266 → 174): three spellings of Springfield
  // Township (Montco). Keep id 174 — it owns the PIAA "springfield twp"
  // alias. id 97 has 5 games + 0 players; id 266 has 1 game + 0 players;
  // id 174 has 0 games + 0 players today, so the merge populates id 174.
  { keepId: 174, mergeFromId: 97, reason: 'Springfield Township: merge "Springfield-Montco" id=97 → canonical id=174 (W17; preserves PIAA alias)' },
  { keepId: 174, mergeFromId: 266, reason: 'Springfield Township: merge "Springfield-M" id=266 → canonical id=174 (W17)' },
  // CB East (id 157 → 69): id 69 holds "cb east" alias and 13 games / 25
  // players. id 157 has 3 games / 0 players, name "CB East" (LOWER matches
  // PIAA directly so it appears divergent; merging consolidates to 69).
  { keepId: 69, mergeFromId: 157, reason: 'Central Bucks East: merge "CB East" id=157 → canonical id=69 (W17; consolidates divergent split)' },
  // Henderson (id 462 → 41): third Henderson row that surfaced post-W10
  // (W10 already merged id 83 → 41). Same WCASD program.
  { keepId: 41, mergeFromId: 462, reason: 'WC Henderson: merge "Henderson" id=462 → canonical id=41 (W17; post-W10 second variant)' },
  // St. Joe's Prep (id 217 → 108): canonical id 108 owns the "sjp" alias.
  // id 217 has 19 players, id 108 has 26 — collisions on duplicate roster
  // names handled by mergeTeam.
  { keepId: 108, mergeFromId: 217, reason: "St. Joseph's Prep: merge \"St. Joe's Prep\" id=217 → canonical id=108 (W17)" },
  // U Darby → Upper Darby. id 271 has 0 players.
  { keepId: 20, mergeFromId: 271, reason: 'Upper Darby: merge "U Darby" id=271 → canonical id=20 (W17)' },
  // Arch Carroll → Archbishop Carroll. id 304 has 0 players.
  { keepId: 94, mergeFromId: 304, reason: 'Archbishop Carroll: merge "Arch Carroll" id=304 → canonical id=94 (W17)' },
  // Academy New Church → Academy of the New Church.
  { keepId: 110, mergeFromId: 301, reason: 'Academy of the New Church: merge "Academy New Church" id=301 → canonical id=110 (W17)' },
  // Bonner Prendie → Bonner-Prendie (hyphen variant canonical, matches W8
  // convention; id 279 already chosen W10).
  { keepId: 279, mergeFromId: 403, reason: 'Bonner-Prendie: merge "Bonner Prendie" id=403 → canonical id=279 (W17; hyphen canonical)' },
  // S. Lehigh → Southern Lehigh. id 262 has 8 players, id 87 has 6.
  { keepId: 87, mergeFromId: 262, reason: 'Southern Lehigh: merge "S. Lehigh" id=262 → canonical id=87 (W17)' },
  // Manheim Twp. → Manheim Township. id 250 has 5 players, id 127 has 13.
  { keepId: 127, mergeFromId: 250, reason: 'Manheim Township: merge "Manheim Twp." id=250 → canonical id=127 (W17)' },
  // Lake Lehman → Lake-Lehman (hyphen canonical, matches W8 convention).
  // id 361 has 9 players, id 239 has 2.
  { keepId: 239, mergeFromId: 361, reason: 'Lake-Lehman: merge "Lake Lehman" id=361 → canonical id=239 (W17; hyphen canonical)' },
  // Spring Ford → Spring-Ford (hyphen canonical; id 355 has 0 players,
  // id 1 holds "springford" PIAA alias).
  { keepId: 1, mergeFromId: 355, reason: 'Spring-Ford: merge "Spring Ford" id=355 → canonical id=1 (W17; hyphen canonical, preserves PIAA alias)' },
];

/** Parse a team name into [base, suffix] if it ends with " (foo)", else null. */
function parseSuffix(name: string): { base: string; suffix: string } | null {
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(name);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { base: m[1].trim(), suffix: m[2].trim() };
}

/** Aggressive matching key: lowercase, strip HS, strip periods, collapse ws. */
function canonicalKey(name: string): string {
  return normalizeTeamName(name).replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

/** Number of games (home or away) for a team id. */
function gameCount(db: ReturnType<typeof openDb>, teamId: number): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS c FROM games WHERE home_team_id = ? OR away_team_id = ?',
    )
    .get(teamId, teamId) as { c: number };
  return row.c;
}

/** Pick a slug for `name` that doesn't collide with any other team's slug. */
function ensureUniqueSlug(
  db: ReturnType<typeof openDb>,
  name: string,
  excludeId: number,
): string {
  const base = slugifyTeamName(normalizeTeamName(name)) || `team-${Date.now()}`;
  let slug = base;
  let suffix = 2;
  const stmt = db.prepare('SELECT id FROM teams WHERE slug = ? AND id != ?');
  while (stmt.get(slug, excludeId)) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

interface MergeResult {
  merged: number;
  renamed: number;
  collisions: number;
  anomalies: string[];
}

export interface ExplicitMergeReport {
  pair: ExplicitPair;
  applied: boolean;
  reasonSkipped?: string;
  keepName?: string;
  mergeFromName?: string;
  gamesMoved: number;
  playersMoved: number;
  aliasesMoved: number;
  collisions: number;
}

/**
 * Pass 0 — apply the W8 explicit (keep, merge_from) pairs. Idempotent: if
 * the merge_from team row no longer exists, the pair is a no-op. If the
 * keep row is missing we log an anomaly and skip rather than crash. Counts
 * games / players / aliases attached to merge_from BEFORE the merge so the
 * report reflects what was moved.
 *
 * Caller is responsible for the surrounding transaction.
 */
export function applyExplicitPairs(
  db: Database,
  pairs: readonly ExplicitPair[] = EXPLICIT_PAIRS,
  anomalies: string[] = [],
): ExplicitMergeReport[] {
  const reports: ExplicitMergeReport[] = [];
  const getTeam = db.prepare('SELECT id, name FROM teams WHERE id = ?');
  const countGames = db.prepare(
    'SELECT COUNT(*) AS c FROM games WHERE home_team_id = ? OR away_team_id = ?',
  );
  const countPlayers = db.prepare('SELECT COUNT(*) AS c FROM players WHERE team_id = ?');
  const countAliases = db.prepare(
    'SELECT COUNT(*) AS c FROM team_aliases WHERE team_id = ?',
  );

  for (const pair of pairs) {
    const src = getTeam.get(pair.mergeFromId) as { id: number; name: string } | undefined;
    const keep = getTeam.get(pair.keepId) as { id: number; name: string } | undefined;
    if (!src) {
      reports.push({
        pair,
        applied: false,
        reasonSkipped: 'merge-from row absent (already merged or never existed)',
        keepName: keep?.name,
        gamesMoved: 0,
        playersMoved: 0,
        aliasesMoved: 0,
        collisions: 0,
      });
      continue;
    }
    if (!keep) {
      anomalies.push(
        `explicit-pair: keep team id=${pair.keepId} missing; cannot merge id=${pair.mergeFromId} "${src.name}"`,
      );
      reports.push({
        pair,
        applied: false,
        reasonSkipped: 'keep row absent',
        mergeFromName: src.name,
        gamesMoved: 0,
        playersMoved: 0,
        aliasesMoved: 0,
        collisions: 0,
      });
      continue;
    }
    const gamesMoved = (countGames.get(pair.mergeFromId, pair.mergeFromId) as { c: number }).c;
    const playersMoved = (countPlayers.get(pair.mergeFromId) as { c: number }).c;
    const aliasesMoved = (countAliases.get(pair.mergeFromId) as { c: number }).c;
    console.log(
      `[explicit] keep id=${keep.id} "${keep.name}" <- merge id=${src.id} "${src.name}" ` +
        `(games=${gamesMoved}, players=${playersMoved}, aliases=${aliasesMoved})`,
    );
    const collisions = mergeTeam(db, pair.mergeFromId, pair.keepId, anomalies);
    reports.push({
      pair,
      applied: true,
      keepName: keep.name,
      mergeFromName: src.name,
      gamesMoved,
      playersMoved,
      aliasesMoved,
      collisions,
    });
  }
  return reports;
}

/**
 * Move all FKs from sourceId → targetId, then delete the source team.
 * Handles UNIQUE collisions on players(team_id, name_normalized) and
 * games(date, home_team_id, away_team_id). Returns # of skipped collisions.
 */
export function mergeTeam(
  db: ReturnType<typeof openDb>,
  sourceId: number,
  targetId: number,
  anomalies: string[],
): number {
  let collisions = 0;

  // ─── Players ───────────────────────────────────────────────────────────
  // Identify (source player, existing target player) collisions on
  // (team_id, name_normalized). For each, redirect player_stats from source
  // player → target player, then delete source player. Then bulk-update the
  // remaining (non-colliding) source players' team_id.
  const collidingPlayers = db
    .prepare(
      `SELECT sp.id AS source_player_id, tp.id AS target_player_id
         FROM players sp
         JOIN players tp
           ON tp.team_id = ?
          AND tp.name_normalized = sp.name_normalized
        WHERE sp.team_id = ?`,
    )
    .all(targetId, sourceId) as Array<{
    source_player_id: number;
    target_player_id: number;
  }>;

  const updateStat = db.prepare(
    `UPDATE OR IGNORE player_stats SET player_id = ? WHERE player_id = ?`,
  );
  const deleteOrphanStats = db.prepare(
    `DELETE FROM player_stats WHERE player_id = ?`,
  );
  const deletePlayer = db.prepare(`DELETE FROM players WHERE id = ?`);
  for (const { source_player_id, target_player_id } of collidingPlayers) {
    // Redirect stats; UNIQUE (game_id, player_id) collisions get IGNOREd, so
    // any leftover stats for the source player are duplicates → drop them.
    updateStat.run(target_player_id, source_player_id);
    deleteOrphanStats.run(source_player_id);
    deletePlayer.run(source_player_id);
  }
  db.prepare(`UPDATE players SET team_id = ? WHERE team_id = ?`).run(
    targetId,
    sourceId,
  );

  // ─── Games ─────────────────────────────────────────────────────────────
  // Update home_team_id and away_team_id, but handle UNIQUE (date, home, away)
  // collisions row-by-row: when a collision occurs, the source game is a
  // duplicate of one already attached to the target team — delete the source
  // game (player_stats + game_periods cascade-delete).
  for (const col of ['home_team_id', 'away_team_id'] as const) {
    const rows = db
      .prepare(`SELECT id FROM games WHERE ${col} = ?`)
      .all(sourceId) as Array<{ id: number }>;
    const upd = db.prepare(`UPDATE games SET ${col} = ? WHERE id = ?`);
    const delGame = db.prepare(`DELETE FROM games WHERE id = ?`);
    for (const { id } of rows) {
      try {
        upd.run(targetId, id);
      } catch (err) {
        if (
          err instanceof Error &&
          /UNIQUE constraint failed.*games/.test(err.message)
        ) {
          collisions += 1;
          anomalies.push(
            `game collision: source game id=${id} duplicates an existing game on target team ${targetId} (date+home+away). Deleted source game (cascades player_stats + game_periods).`,
          );
          delGame.run(id);
        } else {
          throw err;
        }
      }
    }
  }

  // ─── Rankings ─────────────────────────────────────────────────────────
  // UNIQUE (week_start, ranking_source, team_id) — use INSERT OR IGNORE
  // semantics: try to update each, on conflict drop the source row.
  const rankRows = db
    .prepare(`SELECT id FROM rankings WHERE team_id = ?`)
    .all(sourceId) as Array<{ id: number }>;
  const updRank = db.prepare(`UPDATE rankings SET team_id = ? WHERE id = ?`);
  const delRank = db.prepare(`DELETE FROM rankings WHERE id = ?`);
  for (const { id } of rankRows) {
    try {
      updRank.run(targetId, id);
    } catch (err) {
      if (
        err instanceof Error &&
        /UNIQUE constraint failed.*rankings/.test(err.message)
      ) {
        delRank.run(id);
      } else {
        throw err;
      }
    }
  }

  // ─── Game periods ─────────────────────────────────────────────────────
  // UNIQUE (game_id, team_id, period_number). Update row-by-row, dropping
  // duplicates that would collide with already-present target rows.
  const periodRows = db
    .prepare(`SELECT id FROM game_periods WHERE team_id = ?`)
    .all(sourceId) as Array<{ id: number }>;
  const updPeriod = db.prepare(
    `UPDATE game_periods SET team_id = ? WHERE id = ?`,
  );
  const delPeriod = db.prepare(`DELETE FROM game_periods WHERE id = ?`);
  for (const { id } of periodRows) {
    try {
      updPeriod.run(targetId, id);
    } catch (err) {
      if (
        err instanceof Error &&
        /UNIQUE constraint failed.*game_periods/.test(err.message)
      ) {
        delPeriod.run(id);
      } else {
        throw err;
      }
    }
  }

  // ─── team_aliases (if present) — best-effort ───────────────────────────
  try {
    db.prepare(`UPDATE OR IGNORE team_aliases SET team_id = ? WHERE team_id = ?`).run(
      targetId,
      sourceId,
    );
    db.prepare(`DELETE FROM team_aliases WHERE team_id = ?`).run(sourceId);
  } catch {
    /* table may not exist in some snapshots; ignore */
  }

  // ─── Delete source team ────────────────────────────────────────────────
  db.prepare(`DELETE FROM teams WHERE id = ?`).run(sourceId);

  return collisions;
}

function main(): void {
  // dedupTeams always mutates when invoked as a script — guard against running
  // while dev servers hold the SQLite DB open. Pass --force to override.
  checkServerProcs({ force: process.argv.includes('--force') });

  // Resolve repo-root data/lacrosse.db relative to this file: src/scripts → ../../../../data
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath =
    process.env.DB_PATH ??
    process.env.PLL_DB_PATH ??
    resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');

  // Backup BEFORE opening — only if the W8 backup doesn't already exist.
  const backupPath = `${dbPath}.bak-w8-pre-dedup`;
  if (!existsSync(backupPath)) {
    copyFileSync(dbPath, backupPath);
    console.log(`[dedupTeams] backup written: ${backupPath}`);
  } else {
    console.log(`[dedupTeams] backup already present: ${backupPath} (skipped)`);
  }

  console.log(`[dedupTeams] opening ${dbPath}`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  // Capture pre-mutation counts for the summary.
  const pre = {
    teams: (db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c,
    games: (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c,
    players: (db.prepare('SELECT COUNT(*) AS c FROM players').get() as { c: number })
      .c,
    player_stats: (
      db.prepare('SELECT COUNT(*) AS c FROM player_stats').get() as { c: number }
    ).c,
  };

  const result: MergeResult = { merged: 0, renamed: 0, collisions: 0, anomalies: [] };
  let explicitReports: ExplicitMergeReport[] = [];

  // Re-load `allTeams` AFTER explicit-pair merges run inside the tx by
  // querying inside the transaction below. The map built here is only used
  // for the suffix pass which iterates `allTeams`; the suffix pass also
  // re-checks `SELECT 1 FROM teams WHERE id = ?` for liveness so stale
  // entries are tolerated. We snapshot once here for the suffix pass:
  const allTeamsSnapshot = db
    .prepare('SELECT id, name, slug FROM teams ORDER BY id')
    .all() as TeamRow[];

  // Build a lookup from canonicalKey(name) → list of teams sharing that key.
  const byKey = new Map<string, TeamRow[]>();
  for (const t of allTeamsSnapshot) {
    const parsed = parseSuffix(t.name);
    // For state-marker suffixes, the canonical key includes the suffix so we
    // group e.g. "St. Anthony's (NY)" with "St. Anthony's HS (NY)" but NOT
    // with "St. Anthony's" (a hypothetical PA team).
    let key: string;
    if (parsed && STATE_SUFFIXES.has(parsed.suffix.toUpperCase())) {
      key = `${canonicalKey(parsed.base)}|${parsed.suffix.toUpperCase()}`;
    } else if (parsed) {
      key = canonicalKey(parsed.base);
    } else {
      key = canonicalKey(t.name);
    }
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  const tx = db.transaction(() => {
    // ─── Pass 0 — W8 explicit hyphen-pair merges ──────────────────────────
    explicitReports = applyExplicitPairs(db, EXPLICIT_PAIRS, result.anomalies);

    // ─── Pass 1 — parenthetical-suffix dedup (W4) ────────────────────────
    const allTeams = allTeamsSnapshot;
    for (const team of allTeams) {
      const parsed = parseSuffix(team.name);
      if (!parsed) continue;

      const isState = STATE_SUFFIXES.has(parsed.suffix.toUpperCase());
      const stateUpper = parsed.suffix.toUpperCase();
      const groupKey = isState
        ? `${canonicalKey(parsed.base)}|${stateUpper}`
        : canonicalKey(parsed.base);
      const group = byKey.get(groupKey) ?? [];

      // Skip if this team has already been deleted in a prior iteration of
      // the same group.
      const stillExists = db
        .prepare('SELECT 1 FROM teams WHERE id = ?')
        .get(team.id);
      if (!stillExists) continue;

      if (isState) {
        // Group all members sharing canonicalKey(base)+state. Pick the team
        // with the most games as winner; merge the rest into it. Run only
        // when we encounter the winner; skip otherwise (handled when winner
        // is processed).
        const live = group.filter((g) =>
          db.prepare('SELECT 1 FROM teams WHERE id = ?').get(g.id),
        );
        if (live.length <= 1) {
          // Solo state-suffix team — leave as-is (legitimate marker).
          continue;
        }
        const ranked = [...live].sort((a, b) => {
          const ga = gameCount(db, a.id);
          const gb = gameCount(db, b.id);
          if (gb !== ga) return gb - ga;
          // Tie-break by shorter base name (prefer "St. Anthony's (NY)" over
          // "St. Anthony's HS (NY)"), then by lower id for determinism.
          if (a.name.length !== b.name.length) return a.name.length - b.name.length;
          return a.id - b.id;
        });
        const winner = ranked[0]!;
        const losers = ranked.slice(1);
        if (team.id !== winner.id) {
          // Will be merged when we process the winner; skip.
          continue;
        }
        // Ensure winner's display name uses base + state suffix in canonical
        // form (e.g. drop trailing "HS"). Recompute slug if name changes.
        const desiredName = `${parsed.base.replace(/\s+(?:HS|H\.?S\.?|High School)$/i, '').trim()} (${stateUpper})`;
        if (winner.name !== desiredName) {
          // Defer rename until after merges to avoid UNIQUE collision with
          // a loser still holding the desired name.
        }
        for (const loser of losers) {
          console.log(
            `[merge state] ${loser.name} (id=${loser.id}) → ${winner.name} (id=${winner.id})`,
          );
          result.collisions += mergeTeam(db, loser.id, winner.id, result.anomalies);
          result.merged += 1;
        }
        if (winner.name !== desiredName) {
          const newSlug = ensureUniqueSlug(db, desiredName, winner.id);
          db.prepare('UPDATE teams SET name = ?, slug = ? WHERE id = ?').run(
            desiredName,
            newSlug,
            winner.id,
          );
          console.log(
            `[rename] ${winner.name} (id=${winner.id}) → ${desiredName} (slug=${newSlug})`,
          );
          result.renamed += 1;
        }
        continue;
      }

      // Non-state suffix — strip and merge into canonical sibling, or rename
      // in place if no canonical sibling exists.
      const canonicalName = parsed.base;
      const targetKey = canonicalKey(canonicalName);
      const candidates = (byKey.get(targetKey) ?? []).filter(
        (g) =>
          g.id !== team.id &&
          parseSuffix(g.name) === null &&
          db.prepare('SELECT 1 FROM teams WHERE id = ?').get(g.id),
      );
      if (candidates.length > 0) {
        // Prefer a candidate whose name exactly matches the canonical base;
        // otherwise pick the one with the most games.
        const exact = candidates.find((c) => c.name === canonicalName);
        const target =
          exact ??
          [...candidates].sort((a, b) => gameCount(db, b.id) - gameCount(db, a.id))[0]!;
        console.log(
          `[merge] ${team.name} (id=${team.id}) → ${target.name} (id=${target.id})`,
        );
        result.collisions += mergeTeam(db, team.id, target.id, result.anomalies);
        result.merged += 1;
      } else {
        // Rename in place — strip the suffix.
        const newSlug = ensureUniqueSlug(db, canonicalName, team.id);
        db.prepare('UPDATE teams SET name = ?, slug = ? WHERE id = ?').run(
          canonicalName,
          newSlug,
          team.id,
        );
        console.log(
          `[rename] ${team.name} (id=${team.id}) → ${canonicalName} (slug=${newSlug})`,
        );
        result.renamed += 1;
      }
    }
  });

  tx();

  const post = {
    teams: (db.prepare('SELECT COUNT(*) AS c FROM teams').get() as { c: number }).c,
    games: (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c,
    players: (db.prepare('SELECT COUNT(*) AS c FROM players').get() as { c: number })
      .c,
    player_stats: (
      db.prepare('SELECT COUNT(*) AS c FROM player_stats').get() as { c: number }
    ).c,
  };

  console.log('\n──────────── Explicit-pair Pass (W8) ────────────');
  for (const r of explicitReports) {
    if (r.applied) {
      console.log(
        `  applied: keep=#${r.pair.keepId} "${r.keepName}" <- merge=#${r.pair.mergeFromId} "${r.mergeFromName}" ` +
          `games=${r.gamesMoved} players=${r.playersMoved} aliases=${r.aliasesMoved} collisions=${r.collisions}`,
      );
    } else {
      console.log(
        `  skipped: keep=#${r.pair.keepId} merge=#${r.pair.mergeFromId} (${r.reasonSkipped})`,
      );
    }
  }

  console.log('\n──────────── Dedup Summary ────────────');
  console.log(`merged (suffix)   : ${result.merged}`);
  console.log(`renamed-in-place  : ${result.renamed}`);
  console.log(`collisions skipped: ${result.collisions}`);
  console.log(`explicit-pair runs: ${explicitReports.filter((r) => r.applied).length}/${explicitReports.length}`);
  console.log(`teams        ${pre.teams} → ${post.teams}`);
  console.log(`games        ${pre.games} → ${post.games}`);
  console.log(`players      ${pre.players} → ${post.players}`);
  console.log(`player_stats ${pre.player_stats} → ${post.player_stats}`);
  if (result.anomalies.length > 0) {
    console.log('\nAnomalies:');
    for (const a of result.anomalies) console.log(`  - ${a}`);
  }
  console.log('───────────────────────────────────────');

  // FK integrity sanity check.
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
