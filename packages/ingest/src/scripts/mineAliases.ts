// mineAliases.ts — RFC 01 phase A (Yoda 👽✨).
//
// Read-only scan of `ingest_anomalies` that promotes the two highest-yield
// failure modes into a TSV of candidate `team_aliases` rows for human review:
//
//   1. `reason LIKE 'sub-header%'` — the parser saw a stat block headed by a
//      short token (e.g. "Bucs", "Big Red") that didn't match either side of
//      the score line. raw_line carries `[unresolved sub-header: "<token>"]`.
//   2. `reason LIKE 'team hint%'`  — quarter-line teamHint did not resolve.
//      raw_line carries `quarter line teamHint="<token>" did not match …`.
//
// For each anomaly we extract the unresolved token, look up the parent
// game's home/away team_ids, and aggregate by (normalized_token, team_id).
// Confidence is derived from frequency + co-occurrence purity (see
// scoreCandidate).
//
// Output columns (TSV, header row, sorted by confidence desc, occurrences desc):
//   alias  team_id  team_name  occurrences  confidence  rejected  reason  sample_post_id
//
// `rejected` is non-empty when a heuristic disqualifies the row even though
// it scored — kept in the TSV so a reviewer sees what was filtered and why.
//
// Usage:
//   pnpm --filter @pll/ingest mine:aliases                   # writes data/aliases-candidates.tsv
//   pnpm --filter @pll/ingest mine:aliases -- --out path.tsv

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizeTeamName } from '../normalize/teamName.js';

export const MINER_SOURCE = 'anomaly-mined';

/** Per-row aggregation produced by the miner. */
export interface AliasCandidate {
  alias: string;          // normalized token (lowercase, whitespace collapsed)
  teamId: number;
  teamName: string;
  occurrences: number;    // number of distinct anomaly rows backing this pair
  postIds: Set<string>;   // distinct source_post_id values
  samplePostId: string;
  sampleRawLine: string;
  /** Of all anomalies for this token, fraction that voted for THIS team_id. */
  purity: number;
  confidence: number;
  rejected: string;       // empty string if accepted; reason otherwise
}

interface AnomalyRow {
  id: number;
  raw_line: string;
  reason: string;
  source_post_id: string;
  parent_game_id: number;
  home_team_id: number;
  away_team_id: number;
  home_name: string;
  away_name: string;
}

const SUBHEADER_RE = /\[unresolved sub-header:\s*"([^"]+)"\]/i;
const TEAMHINT_RE = /teamHint="([^"]+)"/i;

/** Pull the unresolved token out of a raw_line. Returns null if no match. */
export function extractToken(rawLine: string): string | null {
  const sub = SUBHEADER_RE.exec(rawLine);
  if (sub && sub[1]) return sub[1];
  const hint = TEAMHINT_RE.exec(rawLine);
  if (hint && hint[1]) return hint[1];
  return null;
}

/** Lowercase + whitespace-collapse, no other normalization (preserves digits). */
export function normalizeToken(token: string): string {
  return token.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Heuristic guard against player-name false positives like
 * "Logan Bruette GWG" being promoted as a team alias. Mirrors the RFC's
 * "Risk" table.
 */
export function looksLikePlayerName(token: string): boolean {
  if (/\d/.test(token)) return true;
  const words = token.split(/\s+/).filter(Boolean);
  if (words.length > 3) return true;
  return false;
}

/**
 * Confidence rules from the RFC:
 *   - ≥ 3 distinct posts AND purity = 1.0 → 0.95
 *   - ≥ 2 distinct posts AND purity = 1.0 → 0.80
 *   - otherwise → below floor (returned as 0.50, will be rejected)
 *
 * Substring/initials boosts are intentionally NOT applied here — they're
 * additive and would inflate scores past the curated PIAA aliases. The
 * pure frequency + purity signal already discriminates well in practice.
 */
export function scoreCandidate(distinctPosts: number, purity: number): number {
  if (purity >= 1.0 && distinctPosts >= 3) return 0.95;
  if (purity >= 1.0 && distinctPosts >= 2) return 0.80;
  return 0.5;
}

/** Run the miner and return candidates sorted (confidence desc, occurrences desc). */
export function mineCandidates(db: DatabaseType): AliasCandidate[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.raw_line, a.reason, a.source_post_id, a.parent_game_id,
              g.home_team_id, g.away_team_id,
              th.name AS home_name, ta.name AS away_name
         FROM ingest_anomalies a
         JOIN games g ON g.id = a.parent_game_id
         JOIN teams th ON th.id = g.home_team_id
         JOIN teams ta ON ta.id = g.away_team_id
        WHERE (a.reason LIKE 'sub-header%' OR a.reason LIKE 'team hint%')
          AND a.parent_game_id IS NOT NULL`,
    )
    .all() as AnomalyRow[];

  // Pre-compute existing team_aliases + canonical team names so we can pre-empt
  // collisions (an aliased token is already resolved — don't propose it).
  const existingAliases = new Set<string>(
    (db.prepare('SELECT alias FROM team_aliases').all() as Array<{ alias: string }>).map(
      (r) => r.alias,
    ),
  );
  const existingTeamNames = new Set<string>(
    (db.prepare('SELECT name FROM teams').all() as Array<{ name: string }>).map((r) =>
      normalizeToken(r.name),
    ),
  );
  const knownPlayerNames = new Set<string>(
    (db.prepare('SELECT DISTINCT name_normalized FROM players').all() as Array<{
      name_normalized: string;
    }>).map((r) => normalizeToken(r.name_normalized)),
  );

  // (token, team_id) -> aggregation bucket
  type Bucket = {
    teamId: number;
    teamName: string;
    postIds: Set<string>;
    occurrences: number;
    samplePostId: string;
    sampleRawLine: string;
  };
  const byToken = new Map<string, Map<number, Bucket>>();

  for (const row of rows) {
    const raw = extractToken(row.raw_line);
    if (!raw) continue;
    const token = normalizeToken(raw);
    if (!token) continue;

    // Each anomaly row is evidence of BOTH home and away as candidates,
    // because the parser couldn't tell which side the token belongs to.
    // Aggregating by both lets purity surface the true mapping when a token
    // co-occurs across multiple games — only the right team_id sees the token
    // in every game it appears in.
    for (const side of [
      { id: row.home_team_id, name: row.home_name },
      { id: row.away_team_id, name: row.away_name },
    ]) {
      let perTeam = byToken.get(token);
      if (!perTeam) {
        perTeam = new Map();
        byToken.set(token, perTeam);
      }
      let bucket = perTeam.get(side.id);
      if (!bucket) {
        bucket = {
          teamId: side.id,
          teamName: side.name,
          postIds: new Set(),
          occurrences: 0,
          samplePostId: row.source_post_id,
          sampleRawLine: row.raw_line,
        };
        perTeam.set(side.id, bucket);
      }
      bucket.occurrences += 1;
      bucket.postIds.add(row.source_post_id);
    }
  }

  const candidates: AliasCandidate[] = [];
  for (const [token, perTeam] of byToken) {
    // Total post-occurrences for this token across ALL candidate teams.
    // Each anomaly row contributes to BOTH home and away — so to compute
    // purity per the "fraction of anomalies that vote for this team" model,
    // we measure distinct anomalies (== max(postIds) across candidates is
    // a lower bound; sum of postIds.size is double-count). Use distinct
    // post count per token instead.
    const allPosts = new Set<string>();
    for (const b of perTeam.values()) for (const p of b.postIds) allPosts.add(p);
    const totalDistinctPosts = allPosts.size;

    // Detect tie ambiguity up front: if more than one candidate team would
    // hit purity ≥ 1.0 (i.e. the token co-occurs in every game with both
    // sides — classic "MT" → Perkiomen Valley vs Methacton case) we cannot
    // safely auto-seed. Mark them all rejected as ambiguous.
    let purePassCount = 0;
    for (const b of perTeam.values()) {
      const p = totalDistinctPosts === 0 ? 0 : b.postIds.size / totalDistinctPosts;
      if (p >= 1.0) purePassCount += 1;
    }

    for (const bucket of perTeam.values()) {
      const distinctPosts = bucket.postIds.size;
      const purity = totalDistinctPosts === 0 ? 0 : distinctPosts / totalDistinctPosts;
      const confidence = scoreCandidate(distinctPosts, purity);

      let rejected = '';
      if (existingAliases.has(token)) rejected = 'already aliased';
      else if (existingTeamNames.has(token)) rejected = 'matches existing team name';
      else if (knownPlayerNames.has(token)) rejected = 'matches existing player name';
      else if (looksLikePlayerName(token)) rejected = 'looks like player name';
      else if (purePassCount > 1 && purity >= 1.0) rejected = 'ambiguous between candidate teams';
      else if (confidence < 0.8) rejected = 'below confidence floor';

      candidates.push({
        alias: token,
        teamId: bucket.teamId,
        teamName: bucket.teamName,
        occurrences: bucket.occurrences,
        postIds: bucket.postIds,
        samplePostId: bucket.samplePostId,
        sampleRawLine: bucket.sampleRawLine,
        purity,
        confidence,
        rejected,
      });
    }
  }

  candidates.sort((a, b) => {
    // Accepted rows first, then by confidence desc, then by occurrences desc.
    const aRej = a.rejected ? 1 : 0;
    const bRej = b.rejected ? 1 : 0;
    if (aRej !== bRej) return aRej - bRej;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.occurrences - a.occurrences;
  });
  return candidates;
}

const TSV_HEADER = [
  'alias',
  'team_id',
  'team_name',
  'occurrences',
  'distinct_posts',
  'purity',
  'confidence',
  'rejected',
  'sample_post_id',
  'sample_raw_line',
].join('\t');

function escapeTsvCell(value: string): string {
  // TSV cannot carry literal tabs/newlines; replace with single space.
  return value.replace(/[\t\r\n]+/g, ' ');
}

export function candidatesToTsv(candidates: AliasCandidate[]): string {
  const lines = [TSV_HEADER];
  for (const c of candidates) {
    lines.push(
      [
        c.alias,
        String(c.teamId),
        c.teamName,
        String(c.occurrences),
        String(c.postIds.size),
        c.purity.toFixed(3),
        c.confidence.toFixed(2),
        c.rejected,
        c.samplePostId,
        c.sampleRawLine,
      ]
        .map(escapeTsvCell)
        .join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}

export interface MinerSummary {
  totalCandidates: number;
  accepted: number;
  acceptedAt95: number;
  acceptedAt80: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
}

export function summarize(candidates: AliasCandidate[]): MinerSummary {
  const summary: MinerSummary = {
    totalCandidates: candidates.length,
    accepted: 0,
    acceptedAt95: 0,
    acceptedAt80: 0,
    rejected: 0,
    rejectedByReason: {},
  };
  for (const c of candidates) {
    if (c.rejected) {
      summary.rejected += 1;
      summary.rejectedByReason[c.rejected] = (summary.rejectedByReason[c.rejected] ?? 0) + 1;
    } else {
      summary.accepted += 1;
      if (c.confidence >= 0.95) summary.acceptedAt95 += 1;
      else if (c.confidence >= 0.80) summary.acceptedAt80 += 1;
    }
  }
  return summary;
}

function printSummary(summary: MinerSummary, outPath: string): void {
  console.log('-------- mineAliases summary --------');
  console.log(`output:                  ${outPath}`);
  console.log(`total candidates:        ${summary.totalCandidates}`);
  console.log(`  accepted (≥0.80):      ${summary.accepted}`);
  console.log(`    at 0.95:             ${summary.acceptedAt95}`);
  console.log(`    at 0.80:             ${summary.acceptedAt80}`);
  console.log(`  rejected:              ${summary.rejected}`);
  for (const [reason, n] of Object.entries(summary.rejectedByReason)) {
    console.log(`    ${reason}: ${n}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..', '..');
  const defaultOut = resolve(repoRoot, 'data', 'aliases-candidates.tsv');
  const outPath = outIdx >= 0 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]!) : defaultOut;
  const dbPath = process.env.DB_PATH ?? resolve(repoRoot, 'data', 'lacrosse.db');

  console.log(`[mineAliases] reading ${dbPath}`);
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const candidates = mineCandidates(db);
  const tsv = candidatesToTsv(candidates);
  writeFileSync(outPath, tsv, 'utf8');

  printSummary(summarize(candidates), outPath);
  db.close();
}

// `normalizeTeamName` is referenced by tests/extension points; keep the
// import alive so tree-shaking doesn't surprise downstream callers.
void normalizeTeamName;

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
