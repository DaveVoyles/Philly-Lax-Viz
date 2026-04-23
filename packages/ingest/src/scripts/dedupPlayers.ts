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

// ════════════════════════════════════════════════════════════════════════════
// Wave 12 — Fuzzy / Levenshtein-based candidate finder + safe merge.
// ════════════════════════════════════════════════════════════════════════════
//
// Motivation: the existing buildPlan/applyPlan only catches duplicates whose
// names normalize to byte-identical keys (Patterns 1/2/3) plus single-token
// last-name partials (Pattern 7). Real-world spelling variants like
//   "Pierce Merill"  vs  "Peirce Merrill"
//   "Yusef Abbas"    vs  "Yusuf Abbas"
//   "Colin Ward"     vs  "Collin Ward"
// fall through because their normalized keys differ by 1-2 characters.
//
// This module adds Levenshtein-based candidate detection scoped to the same
// team_id, plus a safe merge path that records every drop in
// `player_aliases` for audit. Cross-team merges are NEVER suggested.

/** O(n*m) Levenshtein distance with two-row buffer. Pure. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/**
 * Restricted Damerau-Levenshtein (Optimal String Alignment) distance.
 * Same as Levenshtein but adjacent-character transpositions are counted as
 * a single edit instead of two. Pure, O(n*m).
 *
 * Pattern 8 uses this per name-part to catch pairs like:
 *   "peirce" ↔ "pierce"   (transposition ei→ie, DL=1 vs Lev=2)
 *   "merrill" ↔ "merill"  (one deletion,          DL=1 = Lev=1)
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  // d[i][j] = distance between a[0..i-1] and b[0..j-1].
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,        // deletion
        d[i]![j - 1]! + 1,        // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );
      // Adjacent transposition: a[i-2..i-1] === b[j-1..j-2] swapped.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + cost);
      }
    }
  }
  return d[m]![n]!;
}

/**
 * Aggressive normalization for fuzzy match. Distinct from the indexable
 * `normalizePlayerName` because we additionally:
 *   - strip jersey numbers (`#12`, `12`) and parenthetical groups
 *   - drop position annotations (goalie/attack/midfield/defense)
 *   - drop name suffixes (jr/sr/ii/iii/iv)
 *   - collapse hyphens to spaces
 */
export function normalizeForFuzzy(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014-]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/#?\b\d+\b/g, ' ')
    .replace(/[^a-z\s']/g, ' ');
  const tokens = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !/^(goalie|attack|midfield|defense|jr|sr|ii|iii|iv)$/.test(t));
  return tokens.join(' ').trim();
}

export interface Candidate {
  teamId: number;
  teamName: string;
  leftId: number;
  leftName: string;
  leftStatCount: number;
  rightId: number;
  rightName: string;
  rightStatCount: number;
  editDistance: number;
  /** 'high' = edit ≤ threshold, 'medium' = first-name + last-initial heuristic. */
  confidence: 'high' | 'medium';
}

interface CandidateRow {
  id: number;
  team_id: number;
  team_name: string;
  name: string;
  stat_count: number;
}

export interface CandidateOptions {
  /** Max Levenshtein distance for a "high"-confidence match (default 2). */
  threshold?: number;
  /** Minimum length of the shorter normalized name (default 5; avoids Tim/Tom). */
  minLength?: number;
}

/**
 * Find near-duplicate player pairs WITHIN the same team. Returns one
 * Candidate per unordered pair, deduplicated, sorted by team then by
 * descending combined stat count (juiciest merges first).
 */
export function findDuplicateCandidates(
  db: Database,
  opts: CandidateOptions = {},
): Candidate[] {
  const threshold = opts.threshold ?? 2;
  const minLength = opts.minLength ?? 5;

  const rows = db
    .prepare(
      `SELECT p.id, p.team_id, t.name AS team_name, p.name,
              (SELECT COUNT(*) FROM player_stats ps WHERE ps.player_id = p.id) AS stat_count
       FROM players p
       JOIN teams t ON t.id = p.team_id
       ORDER BY p.team_id, p.id`,
    )
    .all() as CandidateRow[];

  // Group by team.
  const byTeam = new Map<number, CandidateRow[]>();
  for (const r of rows) {
    const list = byTeam.get(r.team_id) ?? [];
    list.push(r);
    byTeam.set(r.team_id, list);
  }

  const out: Candidate[] = [];
  for (const [, players] of byTeam) {
    // Pre-compute normalized form once per row.
    const norm = players.map((p) => normalizeForFuzzy(p.name));
    for (let i = 0; i < players.length; i++) {
      const a = players[i]!;
      const na = norm[i]!;
      if (!na) continue;
      for (let j = i + 1; j < players.length; j++) {
        const b = players[j]!;
        const nb = norm[j]!;
        if (!nb) continue;
        if (na === nb) continue; // exact-normalize handled by buildPlan
        const minLen = Math.min(na.length, nb.length);
        // Cheap length-prefilter: distance is bounded below by len-diff.
        if (Math.abs(na.length - nb.length) > Math.max(threshold, 2)) {
          // still consider for the medium-confidence first+last-initial path
        }

        const dist = levenshtein(na, nb);

        let confidence: 'high' | 'medium' | null = null;
        if (dist <= threshold && minLen >= minLength) {
          // Reject when the divergence falls within a SHORT token. e.g.
          // "tim smith" vs "tom smith" has dist=1, total length 9, but
          // the only differing token is 3 chars — almost certainly two
          // different people. Compare token-by-token when token counts
          // match; otherwise fall back to the total-length check.
          const aTokensH = na.split(/\s+/);
          const bTokensH = nb.split(/\s+/);
          let differingTokenOk = true;
          if (aTokensH.length === bTokensH.length) {
            for (let k = 0; k < aTokensH.length; k++) {
              if (aTokensH[k] === bTokensH[k]) continue;
              const shorter = Math.min(aTokensH[k]!.length, bTokensH[k]!.length);
              if (shorter < minLength) {
                differingTokenOk = false;
                break;
              }
            }
          }
          if (differingTokenOk) confidence = 'high';
        }
        if (!confidence) {
          // First-name + last-name initial heuristic (transposition catcher).
          const aTokens = na.split(/\s+/);
          const bTokens = nb.split(/\s+/);
          if (aTokens.length >= 2 && bTokens.length >= 2) {
            const aFirst = aTokens[0]!;
            const bFirst = bTokens[0]!;
            const aLastInit = aTokens[aTokens.length - 1]![0]!;
            const bLastInit = bTokens[bTokens.length - 1]![0]!;
            const firstDist = levenshtein(aFirst, bFirst);
            if (
              aLastInit === bLastInit &&
              aFirst.length >= 4 &&
              bFirst.length >= 4 &&
              firstDist <= 2
            ) {
              confidence = 'medium';
            }
          }
        }
        // ── Pattern 8 — adjacent transposition tolerance (DL per name part) ──
        // Catches pairs where BOTH first-name and last-name have Damerau-
        // Levenshtein distance ≤ 1 (e.g. Peirce/Pierce + Merrill/Merill).
        // Guard: at least ONE part must show an actual transposition (DL < Lev)
        // to avoid widening the net to plain insertions/deletions that the
        // medium-confidence heuristic already handles (e.g. James/Jaymes).
        // Requires each part to be ≥ 4 / ≥ 3 chars to avoid short-name noise.
        if (confidence !== 'high') {
          const aTokensP8 = na.split(/\s+/);
          const bTokensP8 = nb.split(/\s+/);
          if (aTokensP8.length === 2 && bTokensP8.length === 2) {
            const levFirstP8 = levenshtein(aTokensP8[0]!, bTokensP8[0]!);
            const levLastP8  = levenshtein(aTokensP8[1]!, bTokensP8[1]!);
            const dlFirst = damerauLevenshtein(aTokensP8[0]!, bTokensP8[0]!);
            const dlLast  = damerauLevenshtein(aTokensP8[1]!, bTokensP8[1]!);
            const firstLen = Math.min(aTokensP8[0]!.length, bTokensP8[0]!.length);
            const lastLen  = Math.min(aTokensP8[1]!.length, bTokensP8[1]!.length);
            // At least one part must show a transposition (DL strictly < Lev).
            const hasTransposition = dlFirst < levFirstP8 || dlLast < levLastP8;
            if (
              dlFirst <= 1 && dlLast <= 1 &&
              firstLen >= 4 && lastLen >= 3 &&
              (dlFirst + dlLast) > 0 &&
              hasTransposition
            ) {
              confidence = 'high';
            }
          }
        }
        if (!confidence) continue;

        out.push({
          teamId: a.team_id,
          teamName: a.team_name,
          leftId: a.id,
          leftName: a.name,
          leftStatCount: a.stat_count,
          rightId: b.id,
          rightName: b.name,
          rightStatCount: b.stat_count,
          editDistance: dist,
          confidence,
        });
      }
    }
  }

  out.sort((x, y) => {
    if (x.teamId !== y.teamId) return x.teamId - y.teamId;
    const xs = x.leftStatCount + x.rightStatCount;
    const ys = y.leftStatCount + y.rightStatCount;
    return ys - xs;
  });
  return out;
}

export interface MergeResult {
  keptId: number;
  droppedId: number;
  statRowsReassigned: number;
  duplicateStatsDropped: number;
  aliasesRepointed: number;
}

/**
 * Merge `dropId` into `keepId` within a single transaction:
 *   1. UPDATE OR IGNORE player_stats to keepId (UNIQUE collisions get IGNORE'd
 *      then DELETEd as per-game duplicates, matching applyPlan semantics).
 *   2. Repoint any existing player_aliases.player_id rows from drop → keep.
 *   3. INSERT (or IGNORE) the dropped player's name as an alias on keepId.
 *   4. DELETE the dropped player row.
 *
 * Idempotent: a second call with the same args is a no-op (the player is
 * already gone). The UNIQUE(alias, player_id) constraint prevents
 * double-inserting the same alias.
 */
export function mergePlayers(
  db: Database,
  keepId: number,
  dropId: number,
  source = 'auto-dedup-w12',
  confidence = 1.0,
): MergeResult {
  if (keepId === dropId) {
    throw new Error(`mergePlayers: keepId === dropId (${keepId})`);
  }
  let statRowsReassigned = 0;
  let duplicateStatsDropped = 0;
  let aliasesRepointed = 0;

  const tx = db.transaction(() => {
    const dropped = db
      .prepare('SELECT id, name FROM players WHERE id = ?')
      .get(dropId) as { id: number; name: string } | undefined;
    const kept = db
      .prepare('SELECT id, name FROM players WHERE id = ?')
      .get(keepId) as { id: number; name: string } | undefined;
    if (!dropped || !kept) {
      // Already merged or doesn't exist — no-op.
      return;
    }

    const beforeKeep = (
      db
        .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
        .get(keepId) as { c: number }
    ).c;
    db.prepare(
      'UPDATE OR IGNORE player_stats SET player_id = ? WHERE player_id = ?',
    ).run(keepId, dropId);
    const afterKeep = (
      db
        .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
        .get(keepId) as { c: number }
    ).c;
    statRowsReassigned = afterKeep - beforeKeep;

    const stillOnDrop = (
      db
        .prepare('SELECT COUNT(*) AS c FROM player_stats WHERE player_id = ?')
        .get(dropId) as { c: number }
    ).c;
    if (stillOnDrop > 0) {
      db.prepare('DELETE FROM player_stats WHERE player_id = ?').run(dropId);
      duplicateStatsDropped = stillOnDrop;
    }

    // Repoint aliases from drop → keep (UNIQUE(alias, player_id) handles dups).
    const repoint = db
      .prepare(
        'UPDATE OR IGNORE player_aliases SET player_id = ? WHERE player_id = ?',
      )
      .run(keepId, dropId);
    aliasesRepointed = repoint.changes;
    // Anything that collided is dropped along with the player row by
    // ON DELETE CASCADE — prune now to keep the audit table clean.
    db.prepare('DELETE FROM player_aliases WHERE player_id = ?').run(dropId);

    // Record the dropped name as an alias of the kept player.
    db.prepare(
      `INSERT OR IGNORE INTO player_aliases (alias, player_id, source, confidence)
       VALUES (?, ?, ?, ?)`,
    ).run(dropped.name, keepId, source, confidence);

    db.prepare('DELETE FROM players WHERE id = ?').run(dropId);
  });

  tx();
  return { keptId: keepId, droppedId: dropId, statRowsReassigned, duplicateStatsDropped, aliasesRepointed };
}

/** Decide which side of a candidate to keep: more stats wins; tie-break lower id. */
export function pickKeepFromCandidate(c: Candidate): { keepId: number; dropId: number } {
  if (c.leftStatCount !== c.rightStatCount) {
    return c.leftStatCount > c.rightStatCount
      ? { keepId: c.leftId, dropId: c.rightId }
      : { keepId: c.rightId, dropId: c.leftId };
  }
  return c.leftId <= c.rightId
    ? { keepId: c.leftId, dropId: c.rightId }
    : { keepId: c.rightId, dropId: c.leftId };
}

function printCandidates(cands: Candidate[]): void {
  console.log(`\n──────── Fuzzy candidates (${cands.length}) ────────`);
  const byConf = { high: 0, medium: 0 };
  for (const c of cands) byConf[c.confidence]++;
  console.log(`  high: ${byConf.high}   medium: ${byConf.medium}`);
  for (const c of cands) {
    const tag = c.confidence === 'high' ? '[H]' : '[M]';
    const { keepId, dropId } = pickKeepFromCandidate(c);
    const keepName = keepId === c.leftId ? c.leftName : c.rightName;
    const dropName = dropId === c.leftId ? c.leftName : c.rightName;
    const keepStats = keepId === c.leftId ? c.leftStatCount : c.rightStatCount;
    const dropStats = dropId === c.leftId ? c.leftStatCount : c.rightStatCount;
    console.log(
      `  ${tag} d=${c.editDistance} team=${c.teamId} "${c.teamName}"  ` +
        `KEEP #${keepId} "${keepName}" (${keepStats} stats)  ←  ` +
        `DROP #${dropId} "${dropName}" (${dropStats} stats)`,
    );
  }
}

function parseArgs(argv: string[]): {
  apply: boolean;
  fuzzy: boolean;
  threshold: number;
  minConfidence: 'high' | 'medium';
} {
  const apply = argv.includes('--apply');
  // Fuzzy is the default for this command (Wave 12 contract). Use
  // `--no-fuzzy` to skip the fuzzy pass and only run the legacy
  // normalize/pattern7 plan.
  const fuzzy = !argv.includes('--no-fuzzy');
  let threshold = 2;
  let minConfidence: 'high' | 'medium' = 'high';
  for (const a of argv) {
    const m = /^--threshold=(\d+)$/.exec(a);
    if (m) threshold = Number(m[1]);
    if (a === '--include-medium') minConfidence = 'medium';
  }
  return { apply, fuzzy, threshold, minConfidence };
}

function main(): void {
  const args = parseArgs(process.argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath = resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  console.log(`[dedupPlayers] opening ${dbPath} (${args.apply ? 'APPLY' : 'dry-run'})`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  // Pass 1 — legacy normalize / pattern-7 plan (unchanged).
  const plan = buildPlan(db);
  printPlan(plan, args.apply);

  // Pass 2 — fuzzy candidates.
  let fuzzyCands: Candidate[] = [];
  if (args.fuzzy) {
    fuzzyCands = findDuplicateCandidates(db, { threshold: args.threshold });
    printCandidates(fuzzyCands);
  }

  if (!args.apply) {
    console.log('\n(Dry-run only. Re-run with --apply to write.)');
    db.close();
    return;
  }

  const result = applyPlan(db, plan);
  printResult(result);

  if (args.fuzzy && fuzzyCands.length > 0) {
    let merged = 0;
    let skipped = 0;
    for (const c of fuzzyCands) {
      if (c.confidence !== 'high' && args.minConfidence === 'high') {
        skipped++;
        continue;
      }
      const { keepId, dropId } = pickKeepFromCandidate(c);
      // Either side may have been merged out by the legacy plan above.
      const stillThere = (
        db
          .prepare('SELECT COUNT(*) AS c FROM players WHERE id IN (?, ?)')
          .get(keepId, dropId) as { c: number }
      ).c;
      if (stillThere < 2) {
        skipped++;
        continue;
      }
      mergePlayers(db, keepId, dropId);
      merged++;
    }
    console.log(`\n──────── Fuzzy merges ────────`);
    console.log(`merged : ${merged}`);
    console.log(`skipped: ${skipped} (already merged or below confidence cutoff)`);
  }

  // FK integrity sanity. Only fail on issues in tables this script touches
  // (players, player_stats, player_aliases) — pre-existing orphan rows in
  // unrelated tables (e.g. rankings → deleted teams) are out of scope and
  // logged at warning level only.
  const fkIssues = db.pragma('foreign_key_check') as Array<{ table: string }>;
  const ourTables = new Set(['players', 'player_stats', 'player_aliases']);
  const ours = fkIssues.filter((i) => ourTables.has(i.table));
  if (ours.length > 0) {
    console.error('FOREIGN KEY CHECK reported issues in tables this script touches:');
    console.error(ours);
    process.exitCode = 1;
  } else {
    console.log('foreign_key_check: clean ✓ (for players/player_stats/player_aliases)');
    if (fkIssues.length > 0) {
      console.log(
        `  (${fkIssues.length} pre-existing FK issues in unrelated tables — ignored)`,
      );
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
