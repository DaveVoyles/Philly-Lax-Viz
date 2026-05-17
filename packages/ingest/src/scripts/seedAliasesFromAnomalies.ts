import { existsSync } from 'node:fs';
import path, { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { openDb } from '../db.js';
import { normalizeTeamName, normalizeTeamToken } from '../pipelines/teamResolver.js';

export interface RawAliasCandidate {
  rawValue: string;
  occurrences: number;
  sources: string[];
}

export interface TeamMatch {
  teamId: number;
  teamName: string;
  score: number;
}

export interface AliasSeedingSummary {
  candidatesFound: number;
  autoSeeded: number;
  alreadyPresent: number;
  manualReview: number;
}

interface TeamRow {
  id: number;
  name: string;
}

interface IngestAnomalyRow {
  raw_line: string;
  strategy_attempted: string;
}

const AUTO_SEED_SOURCE = 'anomaly-auto-seed';
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const REVIEW_THRESHOLD = 0.6;
const LAXNUMBERS_TEAM_RE = /unknown (?:home|visitor) team:\s*"([^"]+)"/i;

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
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

export function normalizeAlias(raw: string): string {
  return normalizeTeamName(normalizeTeamToken(raw));
}

function normalizeForSimilarity(raw: string): string {
  return normalizeAlias(raw)
    .replace(/[.'’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export function similarity(a: string, b: string): number {
  const normA = normalizeForSimilarity(a);
  const normB = normalizeForSimilarity(b);
  if (normA === normB) return 1;
  const maxLen = Math.max(normA.length, normB.length);
  const lev = maxLen === 0 ? 1 : 1 - levenshtein(normA, normB) / maxLen;
  const token = tokenSimilarity(normA, normB);
  const substring =
    normA && normB && (normA.includes(normB) || normB.includes(normA))
      ? Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length)
      : 0;
  return Math.max(lev, token, substring);
}

export function extractRawValueFromIngestAnomaly(row: IngestAnomalyRow): string | null {
  if (row.strategy_attempted === 'schedule-team-resolve') {
    const raw = row.raw_line.trim();
    return raw.length > 0 ? raw : null;
  }
  if (row.strategy_attempted === 'laxnumbers-unknown-team') {
    const match = LAXNUMBERS_TEAM_RE.exec(row.raw_line);
    if (!match?.[1]) return null;
    return match[1].trim();
  }
  return null;
}

function tableExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { present?: number } | undefined;
  return row?.present === 1;
}

function tableColumns(db: DatabaseType, name: string): string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function collectFromAnomaliesTable(db: DatabaseType): RawAliasCandidate[] {
  const columns = new Set(tableColumns(db, 'anomalies'));
  if (!columns.has('category') || !columns.has('raw_value')) return [];

  const filters = ["category = 'team-match'"];
  if (columns.has('resolved_at')) filters.push('resolved_at IS NULL');
  else if (columns.has('resolved')) filters.push('COALESCE(resolved, 0) = 0');
  else if (columns.has('status')) filters.push("LOWER(status) != 'resolved'");

  const rows = db
    .prepare(
      `SELECT raw_value AS rawValue, COUNT(*) AS occurrences
         FROM anomalies
        WHERE ${filters.join(' AND ')}
        GROUP BY raw_value
        ORDER BY occurrences DESC, raw_value ASC`,
    )
    .all() as Array<{ rawValue: string; occurrences: number }>;

  return rows
    .map((row) => ({
      rawValue: row.rawValue.trim(),
      occurrences: row.occurrences,
      sources: ['anomalies'],
    }))
    .filter((row) => row.rawValue.length > 0);
}

function collectFromIngestAnomaliesTable(db: DatabaseType): RawAliasCandidate[] {
  const rows = db
    .prepare(
      `SELECT raw_line, strategy_attempted
         FROM ingest_anomalies
        WHERE strategy_attempted IN ('schedule-team-resolve', 'laxnumbers-unknown-team')`,
    )
    .all() as IngestAnomalyRow[];

  const byValue = new Map<string, { occurrences: number; sources: Set<string> }>();
  for (const row of rows) {
    const rawValue = extractRawValueFromIngestAnomaly(row);
    if (!rawValue) continue;
    const key = rawValue.trim();
    if (!key) continue;
    const entry = byValue.get(key) ?? { occurrences: 0, sources: new Set<string>() };
    entry.occurrences += 1;
    entry.sources.add(row.strategy_attempted);
    byValue.set(key, entry);
  }

  return [...byValue.entries()]
    .map(([rawValue, entry]) => ({
      rawValue,
      occurrences: entry.occurrences,
      sources: [...entry.sources].sort(),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.rawValue.localeCompare(b.rawValue));
}

export function collectRawAliasCandidates(db: DatabaseType): RawAliasCandidate[] {
  if (tableExists(db, 'anomalies')) {
    const rows = collectFromAnomaliesTable(db);
    if (rows.length > 0) return rows;
  }
  if (tableExists(db, 'ingest_anomalies')) {
    return collectFromIngestAnomaliesTable(db);
  }
  return [];
}

export function findBestTeamMatch(rawValue: string, teams: readonly TeamRow[]): TeamMatch | null {
  let best: TeamMatch | null = null;
  for (const team of teams) {
    const score = similarity(rawValue, team.name);
    if (!best || score > best.score) {
      best = { teamId: team.id, teamName: team.name, score };
    }
  }
  return best;
}

export function seedAliasesFromAnomalies(
  db: DatabaseType,
  options: { dryRun?: boolean } = {},
): AliasSeedingSummary {
  const dryRun = options.dryRun ?? false;
  const candidates = collectRawAliasCandidates(db);
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY name').all() as TeamRow[];
  const aliasExists = db.prepare('SELECT 1 FROM team_aliases WHERE alias = ?');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence, created_at, notes)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`,
  );

  const summary: AliasSeedingSummary = {
    candidatesFound: candidates.length,
    autoSeeded: 0,
    alreadyPresent: 0,
    manualReview: 0,
  };

  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      const alias = normalizeAlias(candidate.rawValue);
      if (!alias) continue;
      if (aliasExists.get(alias)) {
        summary.alreadyPresent += 1;
        console.log(`[skip] alias already present: "${candidate.rawValue}" -> alias="${alias}"`);
        continue;
      }

      const best = findBestTeamMatch(candidate.rawValue, teams);
      if (!best) {
        summary.manualReview += 1;
        console.log(`[no-match] "${candidate.rawValue}" -> no team rows available`);
        continue;
      }

      const pct = (best.score * 100).toFixed(0);
      if (best.score >= HIGH_CONFIDENCE_THRESHOLD) {
        const note = [
          `raw_value=${candidate.rawValue}`,
          `occurrences=${candidate.occurrences}`,
          `sources=${candidate.sources.join(',')}`,
        ].join('; ');
        if (dryRun) {
          summary.autoSeeded += 1;
          console.log(`[dry-run] auto-seed "${candidate.rawValue}" -> "${best.teamName}" (${pct}%)`);
        } else {
          const info = insert.run(alias, best.teamId, AUTO_SEED_SOURCE, best.score, note);
          if (info.changes === 1) {
            summary.autoSeeded += 1;
            console.log(`[seeded] "${candidate.rawValue}" -> "${best.teamName}" (${pct}%)`);
          } else {
            summary.alreadyPresent += 1;
            console.log(`[skip] alias already present: "${candidate.rawValue}" -> alias="${alias}"`);
          }
        }
      } else {
        summary.manualReview += 1;
        const level = best.score >= REVIEW_THRESHOLD ? 'review' : 'no-match';
        console.log(`[${level}] "${candidate.rawValue}" -> "${best.teamName}" (${pct}%)`);
      }
    }
  });
  tx();

  return summary;
}

function printSummary(summary: AliasSeedingSummary, dryRun: boolean): void {
  console.log('-------- seedAliasesFromAnomalies --------');
  console.log(`mode:               ${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`candidates found:   ${summary.candidatesFound}`);
  console.log(`${dryRun ? 'would auto-seed' : 'auto-seeded'}:     ${summary.autoSeeded}`);
  console.log(`already present:    ${summary.alreadyPresent}`);
  console.log(`manual review:      ${summary.manualReview}`);
}

function parseArgs(argv: string[]): { dbPath: string; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run');
  const dbPathArg = argv.find((arg) => !arg.startsWith('--'));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const dbPath = dbPathArg ?? path.join(repoRoot, 'data', 'lacrosse.db');
  return { dbPath, dryRun };
}

function resolveDbPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const repoRelative = resolve(repoRoot, inputPath);
  if (existsSync(repoRelative)) return repoRelative;
  return resolve(inputPath);
}

function main(): void {
  const { dbPath, dryRun } = parseArgs(process.argv.slice(2));
  const resolvedDbPath = resolveDbPath(dbPath);
  if (!existsSync(resolvedDbPath)) {
    throw new Error(`Database not found: ${resolvedDbPath}`);
  }

  const db = openDb(resolvedDbPath);
  try {
    console.log(`[seedAliasesFromAnomalies] db=${resolvedDbPath} mode=${dryRun ? 'dry-run' : 'apply'}`);
    const summary = seedAliasesFromAnomalies(db, { dryRun });
    printSummary(summary, dryRun);
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath === thisPath) {
  main();
}
