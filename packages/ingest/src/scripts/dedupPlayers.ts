// dedupPlayers.ts — one-shot migration to merge duplicate player rows that
// collapse to the same `normalizePlayerName(name)` key on the SAME team_id.
//
// Background: Chewy's Wave 3 satellite audit (docs/.../Appendix A) cataloged 9
// hard same-team dupes from patterns 1, 2, 3 (initial-with-period vs without,
// trailing terminal period, embedded position annotation). The new
// `normalizePlayerName` collapses all of those to one key, but the live DB
// still has the un-collapsed rows because they were inserted before the
// stronger normalizer existed.
//
// Pattern 7 (last-name-only partial vs full first+last on same team) is also
// handled, but ONLY when exactly one full-name candidate exists on the team
// (per Appendix A.5 #1 — Mikey Depetris vs Michael Depetris on team 37 is
// ambiguous and must be skipped).
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/dedupPlayers.ts          # dry-run (default)
//   pnpm --filter @pll/ingest exec tsx src/scripts/dedupPlayers.ts --apply  # writes
//   pnpm --filter @pll/ingest dedup:players                                 # alias
//
// Behavior (per group of 2+ rows that share team_id + normalized key):
//   1. Pick canonical row = longest original `name`; tie-break by lower id.
//   2. For each non-canonical row:
//        - UPDATE OR IGNORE player_stats SET player_id = canonical
//          (UNIQUE (game_id, player_id) collisions get IGNORE'd; leftover
//           stats on the dup row are duplicates → DELETE them).
//        - DELETE FROM players WHERE id = dup.id;
//   3. Refresh players.name_normalized for ALL surviving rows so the index
//      reflects the new normalizer (idempotent — re-running is a no-op).
//
// Cross-team identical names are NEVER merged (intentional per A.5 #3).
// All writes wrapped in a single transaction; PRAGMA foreign_keys=ON.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizePlayerName } from '../normalize/playerName.js';

export interface PlayerRow {
  id: number;
  team_id: number;
  name: string;
  name_normalized: string;
  name_resolution: string;
}

export interface MergeAction {
  teamId: number;
  canonicalId: number;
  canonicalName: string;
  normalizedKey: string;
  duplicateIds: number[];
  duplicateNames: string[];
  /** 'normalize' = pattern 1/2/3, 'pattern7' = last-name-only partial merge. */
  reason: 'normalize' | 'pattern7';
}

export interface SkippedAmbiguous {
  teamId: number;
  partialId: number;
  partialName: string;
  candidateIds: number[];
  candidateNames: string[];
  /** 0 = no candidate; >=2 = multiple candidates. */
  reason: 'no-candidate' | 'multiple-candidates';
}

export interface DedupPlan {
  merges: MergeAction[];
  skippedAmbiguous: SkippedAmbiguous[];
  preCount: number;
}

export interface DedupResult extends DedupPlan {
  postCount: number;
  statsRedirected: number;
  duplicateStatsDeleted: number;
  playersDeleted: number;
  normalizedRowsRefreshed: number;
}

/** Last whitespace-separated token of a name (post-trim). */
function lastToken(s: string): string {
  const parts = s.trim().split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/**
 * Pick the canonical row from a group: longest original name wins,
 * tie-break by lowest id.
 */
function pickCanonical(rows: PlayerRow[]): PlayerRow {
  return [...rows].sort((a, b) => {
    if (b.name.length !== a.name.length) return b.name.length - a.name.length;
    return a.id - b.id;
  })[0]!;
}

/**
 * Build the merge plan from the current `players` table. Pure: does not
 * mutate the DB. Two passes:
 *
 *   Pass A — normalize-key collisions (patterns 1/2/3):
 *     Group ALL rows by (team_id, normalizePlayerName(name)). Each group
 *     with size >= 2 produces one MergeAction.
 *
 *   Pass B — pattern-7 (last-name-only partials):
 *     For each surviving (post-Pass-A) row whose name has exactly 1 token,
 *     find candidates on the same team whose last-token matches AND whose
 *     name has 2+ tokens. Merge only when exactly 1 candidate exists.
 */
export function buildPlan(db: Database): DedupPlan {
  const allRows = db
    .prepare(
      'SELECT id, team_id, name, name_normalized, name_resolution FROM players ORDER BY id',
    )
    .all() as PlayerRow[];

  const merges: MergeAction[] = [];
  const skippedAmbiguous: SkippedAmbiguous[] = [];
  const removedIds = new Set<number>();

  // ─── Pass A — normalize-key collisions ──────────────────────────────────
  const byKey = new Map<string, PlayerRow[]>();
  for (const r of allRows) {
    const key = normalizePlayerName(r.name);
    if (!key) continue; // sentinel / empty — leave for anomaly review
    const composite = `${r.team_id}\u0000${key}`;
    const list = byKey.get(composite) ?? [];
    list.push(r);
    byKey.set(composite, list);
  }
  for (const [composite, rows] of byKey) {
    if (rows.length < 2) continue;
    const key = composite.split('\u0000')[1]!;
    const canonical = pickCanonical(rows);
    const dups = rows.filter((r) => r.id !== canonical.id);
    merges.push({
      teamId: canonical.team_id,
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      normalizedKey: key,
      duplicateIds: dups.map((d) => d.id),
      duplicateNames: dups.map((d) => d.name),
      reason: 'normalize',
    });
    for (const d of dups) removedIds.add(d.id);
  }

  // ─── Pass B — Pattern 7 (last-name-only partial → full) ─────────────────
  // Survivors after Pass A:
  const survivors = allRows.filter((r) => !removedIds.has(r.id));
  // Group survivors by team for cheap lookups.
  const byTeam = new Map<number, PlayerRow[]>();
  for (const r of survivors) {
    const list = byTeam.get(r.team_id) ?? [];
    list.push(r);
    byTeam.set(r.team_id, list);
  }

  for (const partial of survivors) {
    const norm = normalizePlayerName(partial.name);
    if (!norm) continue;
    const tokens = norm.split(/\s+/).filter(Boolean);
    if (tokens.length !== 1) continue; // not a single-token "partial"
    const partialToken = tokens[0]!;
    const teamPeers = byTeam.get(partial.team_id) ?? [];
    const candidates = teamPeers.filter((p) => {
      if (p.id === partial.id) return false;
      if (removedIds.has(p.id)) return false;
      const pNorm = normalizePlayerName(p.name);
      const pTokens = pNorm.split(/\s+/).filter(Boolean);
      if (pTokens.length < 2) return false;
      return lastToken(pNorm) === partialToken;
    });
    if (candidates.length === 0) {
      skippedAmbiguous.push({
        teamId: partial.team_id,
        partialId: partial.id,
        partialName: partial.name,
        candidateIds: [],
        candidateNames: [],
        reason: 'no-candidate',
      });
      continue;
    }
    if (candidates.length > 1) {
      skippedAmbiguous.push({
        teamId: partial.team_id,
        partialId: partial.id,
        partialName: partial.name,
        candidateIds: candidates.map((c) => c.id),
        candidateNames: candidates.map((c) => c.name),
        reason: 'multiple-candidates',
      });
      continue;
    }
    const canonical = candidates[0]!;
    merges.push({
      teamId: partial.team_id,
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      normalizedKey: normalizePlayerName(canonical.name),
      duplicateIds: [partial.id],
      duplicateNames: [partial.name],
      reason: 'pattern7',
    });
    removedIds.add(partial.id);
  }

  const preCount = (db.prepare('SELECT COUNT(*) AS c FROM players').get() as {
    c: number;
  }).c;

  return { merges, skippedAmbiguous, preCount };
}

/**
 * Apply a previously-built plan. Wraps all writes in BEGIN/COMMIT.
 * Idempotent: a second call on a clean DB produces zero merges.
 */
export function applyPlan(db: Database, plan: DedupPlan): DedupResult {
  const updateStat = db.prepare(
    'UPDATE OR IGNORE player_stats SET player_id = ? WHERE player_id = ?',
  );
  const deleteOrphanStats = db.prepare(
    'DELETE FROM player_stats WHERE player_id = ?',
  );
  const deletePlayer = db.prepare('DELETE FROM players WHERE id = ?');
  const refreshNormalized = db.prepare(
    'UPDATE players SET name_normalized = ? WHERE id = ?',
  );

  let statsRedirected = 0;
  let duplicateStatsDeleted = 0;
  let playersDeleted = 0;
  let normalizedRowsRefreshed = 0;

  const tx = db.transaction(() => {
    for (const m of plan.merges) {
      for (const dupId of m.duplicateIds) {
        const beforeDup = (
          db
            .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
            .get(dupId) as { c: number }
        ).c;
        const beforeCanon = (
          db
            .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
            .get(m.canonicalId) as { c: number }
        ).c;
        updateStat.run(m.canonicalId, dupId);
        const afterDup = (
          db
            .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
            .get(dupId) as { c: number }
        ).c;
        const afterCanon = (
          db
            .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
            .get(m.canonicalId) as { c: number }
        ).c;
        statsRedirected += afterCanon - beforeCanon;
        // afterDup rows are stats that couldn't be redirected (UNIQUE
        // collision on (game_id, player_id)) — they're per-game duplicates
        // and we drop them.
        if (afterDup > 0) {
          deleteOrphanStats.run(dupId);
          duplicateStatsDeleted += afterDup;
        }
        // beforeDup-afterDup were the ones successfully redirected.
        // (sanity tracker — not surfaced separately)
        void beforeDup;
        deletePlayer.run(dupId);
        playersDeleted += 1;
      }
    }

    // Refresh name_normalized on every surviving row so the index matches the
    // new normalizer's output exactly. Idempotent.
    const surviving = db
      .prepare('SELECT id, name, name_normalized FROM players')
      .all() as Array<{ id: number; name: string; name_normalized: string }>;
    for (const row of surviving) {
      const fresh = normalizePlayerName(row.name);
      if (fresh && fresh !== row.name_normalized) {
        refreshNormalized.run(fresh, row.id);
        normalizedRowsRefreshed += 1;
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
    statsRedirected,
    duplicateStatsDeleted,
    playersDeleted,
    normalizedRowsRefreshed,
  };
}

function printPlan(plan: DedupPlan, apply: boolean): void {
  const header = apply ? 'Applying' : 'Dry-run plan';
  console.log(`──────── ${header}: dedupPlayers ────────`);
  console.log(`Pre-count: ${plan.preCount} players`);
  console.log(`Merges: ${plan.merges.length}`);
  for (const m of plan.merges) {
    const tag = m.reason === 'pattern7' ? '[p7]' : '[norm]';
    console.log(
      `  ${tag} team=${m.teamId} key="${m.normalizedKey}" canonical=#${m.canonicalId} "${m.canonicalName}"  ←  ` +
        m.duplicateIds
          .map((id, i) => `#${id} "${m.duplicateNames[i]}"`)
          .join(', '),
    );
  }
  if (plan.skippedAmbiguous.length > 0) {
    console.log(`\nSkipped (Pattern 7 ambiguity): ${plan.skippedAmbiguous.length}`);
    for (const s of plan.skippedAmbiguous) {
      if (s.reason === 'no-candidate') continue; // noisy, omit from console
      console.log(
        `  team=${s.teamId} partial=#${s.partialId} "${s.partialName}" — candidates: ` +
          s.candidateIds
            .map((id, i) => `#${id} "${s.candidateNames[i]}"`)
            .join(', '),
      );
    }
  }
}

function printResult(r: DedupResult): void {
  console.log('\n──────── Apply result ────────');
  console.log(`players       ${r.preCount} → ${r.postCount}  (Δ -${r.preCount - r.postCount})`);
  console.log(`stats redirected to canonical : ${r.statsRedirected}`);
  console.log(`per-game duplicate stats dropped: ${r.duplicateStatsDeleted}`);
  console.log(`player rows deleted             : ${r.playersDeleted}`);
  console.log(`name_normalized refreshed       : ${r.normalizedRowsRefreshed}`);
  console.log('──────────────────────────────');
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  console.log(`[dedupPlayers] opening ${dbPath} (${apply ? 'APPLY' : 'dry-run'})`);
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
  printResult(result);

  // FK integrity sanity.
  const fkIssues = db.pragma('foreign_key_check') as unknown[];
  if (fkIssues.length > 0) {
    console.error('FOREIGN KEY CHECK reported issues:');
    console.error(fkIssues);
    process.exitCode = 1;
  } else {
    console.log('foreign_key_check: clean ✓');
  }

  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
