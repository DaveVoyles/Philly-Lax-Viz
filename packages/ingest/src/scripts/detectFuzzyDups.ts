import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { createLogger } from '@pll/shared';
import { openDb } from '../db.js';
import { checkServerProcs } from './lib/checkServerProcs.js';

const log = createLogger({ name: 'ingest:detectFuzzyDups' });
const DEFAULT_THRESHOLD = 0.85;
const ALGO = 'levenshtein';

export interface PlayerRecord {
  id: number;
  name: string;
  name_normalized: string;
  team_id: number;
  team_name: string;
  stat_count: number;
}

export interface ExistingCandidatePair {
  player_a_id: number;
  player_b_id: number;
}

export interface FuzzyCandidate {
  playerA: PlayerRecord;
  playerB: PlayerRecord;
  similarity: number;
  existing: boolean;
}

export interface ScriptArgs {
  apply: boolean;
  force: boolean;
  threshold: number;
}

function candidateKey(playerAId: number, playerBId: number): string {
  return `${playerAId}:${playerBId}`;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export function parseArgs(argv: string[]): ScriptArgs {
  let threshold = DEFAULT_THRESHOLD;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--threshold') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new Error('Missing value for --threshold');
      }
      threshold = Number(raw);
      i += 1;
      continue;
    }
    if (arg?.startsWith('--threshold=')) {
      threshold = Number(arg.slice('--threshold='.length));
    }
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`Invalid --threshold value: ${threshold}`);
  }

  return {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
    threshold,
  };
}

export function loadPlayers(db: Database): PlayerRecord[] {
  return db
    .prepare<[], PlayerRecord>(
      `SELECT p.id,
              p.name,
              p.name_normalized,
              p.team_id,
              t.name AS team_name,
              COUNT(ps.id) AS stat_count
       FROM players p
       JOIN teams t ON t.id = p.team_id
       LEFT JOIN player_stats ps ON ps.player_id = p.id
       GROUP BY p.id, p.name, p.name_normalized, p.team_id, t.name
       ORDER BY p.id`,
    )
    .all();
}

export function loadExistingCandidateKeys(db: Database): Set<string> {
  const rows = db
    .prepare<[], ExistingCandidatePair>(
      'SELECT player_a_id, player_b_id FROM dedup_candidates',
    )
    .all();
  return new Set(rows.map((row) => candidateKey(row.player_a_id, row.player_b_id)));
}

function isEligiblePlayer(player: PlayerRecord): boolean {
  const normalized = player.name_normalized.trim();
  if (normalized.length < 4) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && normalized.length < 6) return false;
  return true;
}

function bucketKey(nameNormalized: string): string {
  return (nameNormalized.trim()[0] ?? '').toLowerCase();
}

function canMeetThreshold(a: string, b: string, threshold: number): boolean {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return false;
  const minDistance = Math.abs(a.length - b.length);
  const bestPossibleSimilarity = 1 - minDistance / maxLen;
  return bestPossibleSimilarity >= threshold;
}

function toOrderedPair(a: PlayerRecord, b: PlayerRecord): [PlayerRecord, PlayerRecord] {
  return a.id < b.id ? [a, b] : [b, a];
}

export function findFuzzyCandidates(
  players: PlayerRecord[],
  existingKeys: Set<string>,
  threshold: number,
): FuzzyCandidate[] {
  const eligiblePlayers = players.filter(isEligiblePlayer);
  const buckets = new Map<string, PlayerRecord[]>();

  for (const player of eligiblePlayers) {
    const key = bucketKey(player.name_normalized);
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(player);
    buckets.set(key, bucket);
  }

  const matches: FuzzyCandidate[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const left = bucket[i]!;
      for (let j = i + 1; j < bucket.length; j += 1) {
        const right = bucket[j]!;
        if (left.team_id === right.team_id) continue;
        if (!canMeetThreshold(left.name_normalized, right.name_normalized, threshold)) {
          continue;
        }

        const distance = levenshtein(left.name_normalized, right.name_normalized);
        const maxLen = Math.max(left.name_normalized.length, right.name_normalized.length);
        const similarity = 1 - distance / maxLen;
        if (similarity < threshold) continue;

        const [playerA, playerB] = toOrderedPair(left, right);
        matches.push({
          playerA,
          playerB,
          similarity,
          existing: existingKeys.has(candidateKey(playerA.id, playerB.id)),
        });
      }
    }
  }

  return matches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (a.playerA.name !== b.playerA.name) return a.playerA.name.localeCompare(b.playerA.name);
    return a.playerB.name.localeCompare(b.playerB.name);
  });
}

export function insertCandidates(db: Database, candidates: FuzzyCandidate[]): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO dedup_candidates (
      player_a_id,
      player_b_id,
      similarity,
      algo
    ) VALUES (?, ?, ?, ?)`,
  );

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      if (candidate.existing) continue;
      const result = insert.run(
        candidate.playerA.id,
        candidate.playerB.id,
        candidate.similarity,
        ALGO,
      );
      inserted += result.changes;
    }
  });
  tx();
  return inserted;
}

function printCandidates(candidates: FuzzyCandidate[]): void {
  if (candidates.length === 0) {
    log.info('No fuzzy candidate pairs found.');
    return;
  }

  for (const candidate of candidates) {
    const suffix = candidate.existing ? ' [already in DB]' : '';
    log.info(
      `${candidate.playerA.name} (${candidate.playerA.team_name}) <-> ` +
        `${candidate.playerB.name} (${candidate.playerB.team_name}) ` +
        `[similarity: ${candidate.similarity.toFixed(2)}]${suffix}`,
    );
  }
}

function printSummary(candidates: FuzzyCandidate[], inserted: number, apply: boolean): void {
  const existing = candidates.filter((candidate) => candidate.existing).length;
  const fresh = candidates.length - existing;
  log.info(`Found ${candidates.length} candidate pairs (${fresh} new, ${existing} already in DB)`);
  if (apply) {
    log.info(`Inserted ${inserted} new candidate pairs into dedup_candidates`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply) {
    checkServerProcs({ force: args.force });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const dbPath =
    process.env.DB_PATH ??
    process.env.PLL_DB_PATH ??
    resolve(here, '..', '..', '..', '..', 'data', 'lacrosse.db');

  log.info(
    `[detectFuzzyDups] opening ${dbPath} (${args.apply ? 'APPLY' : 'dry-run'}) threshold=${args.threshold}`,
  );
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const players = loadPlayers(db);
  const existingKeys = loadExistingCandidateKeys(db);
  const candidates = findFuzzyCandidates(players, existingKeys, args.threshold);
  printCandidates(candidates);

  let inserted = 0;
  if (args.apply) {
    inserted = insertCandidates(db, candidates);
  }

  printSummary(candidates, inserted, args.apply);
  if (!args.apply) {
    log.info('(Dry-run only. Re-run with --apply to write.)');
  }
  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
