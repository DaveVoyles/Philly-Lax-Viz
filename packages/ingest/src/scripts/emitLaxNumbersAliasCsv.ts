// emitLaxNumbersAliasCsv.ts — emit a review CSV of LaxNumbers unknown-team anomalies
// with top-3 fuzzy matches against the `teams` table for human triage.
//
// Pure read; never mutates the DB. Does not auto-apply any aliases.
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/emitLaxNumbersAliasCsv.ts \
//     [--db PATH] [--out PATH]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:emitLaxNumbersAliasCsv' });
interface AnomalyRow {
  raw_line: string;
}

interface AliasRow {
  lnName: string;
  anomalyCount: number;
  matches: Array<{ name: string; confidence: number }>;
}

/** Extract the team name inside quotes from a raw_line like:
 *  `date=2026-04-15 unknown home team: "Masterman"` -> `Masterman`.
 *  Returns null if no quoted team name is found.
 */
export function extractLnName(rawLine: string): string | null {
  const m = /team:\s*"([^"]+)"/.exec(rawLine);
  return m && m[1] ? m[1].trim() : null;
}

/** Levenshtein distance (iterative, O(m*n) time, O(min(m,n)) space). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Ensure b is the shorter string to minimize memory.
  if (a.length < b.length) {
    const t = a;
    a = b;
    b = t;
  }
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/** Normalize a team name for comparison: lowercase, collapse punctuation/whitespace. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'`’]/g, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compute a 0..1 similarity score between an LN name and a candidate team name.
 *  Blends Levenshtein-based ratio with a substring-containment bonus.
 */
export function similarity(lnName: string, candidate: string): number {
  const a = normalize(lnName);
  const b = normalize(candidate);
  if (a.length === 0 || b.length === 0) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const lev = 1 - dist / maxLen; // 0..1
  let bonus = 0;
  if (a === b) bonus = 0.25;
  else if (b.includes(a) || a.includes(b)) bonus = 0.15;
  else {
    // Token-overlap bonus: shared whole words.
    const aTok = new Set(a.split(' ').filter(Boolean));
    const bTok = new Set(b.split(' ').filter(Boolean));
    let shared = 0;
    for (const t of aTok) if (bTok.has(t)) shared++;
    if (shared > 0) {
      bonus = 0.05 * Math.min(shared, 3);
    }
  }
  return Math.min(1, lev + bonus);
}

/** Find top-N fuzzy matches for an LN name against the provided candidate team names. */
export function topMatches(
  lnName: string,
  candidates: readonly string[],
  n = 3,
): Array<{ name: string; confidence: number }> {
  const scored = candidates.map((name) => ({
    name,
    confidence: similarity(lnName, name),
  }));
  scored.sort((x, y) => y.confidence - x.confidence);
  return scored.slice(0, n);
}

/** CSV-escape a single field per RFC 4180 (quotes doubled, commas/newlines safe). */
function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvField).join(',');
}

export function buildAliasRows(
  anomalies: readonly AnomalyRow[],
  teamNames: readonly string[],
): AliasRow[] {
  const counts = new Map<string, number>();
  for (const { raw_line } of anomalies) {
    const name = extractLnName(raw_line);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const rows: AliasRow[] = [];
  for (const [lnName, anomalyCount] of counts) {
    const matches = topMatches(lnName, teamNames, 3);
    rows.push({ lnName, anomalyCount, matches });
  }
  rows.sort((a, b) => b.anomalyCount - a.anomalyCount || a.lnName.localeCompare(b.lnName));
  return rows;
}

export function renderCsv(rows: readonly AliasRow[]): string {
  const header = [
    'ln_name',
    'anomaly_count',
    'proposed_match_1',
    'confidence_1',
    'proposed_match_2',
    'confidence_2',
    'proposed_match_3',
    'confidence_3',
    'reviewer_decision',
  ];
  const lines = [csvRow(header)];
  for (const r of rows) {
    const empty = { name: '', confidence: 0 };
    const m1 = r.matches[0] ?? empty;
    const m2 = r.matches[1] ?? empty;
    const m3 = r.matches[2] ?? empty;
    lines.push(
      csvRow([
        r.lnName,
        r.anomalyCount,
        m1.name,
        m1.name ? m1.confidence.toFixed(3) : '',
        m2.name,
        m2.name ? m2.confidence.toFixed(3) : '',
        m3.name,
        m3.name ? m3.confidence.toFixed(3) : '',
        '',
      ]),
    );
  }
  return lines.join('\n') + '\n';
}

function parseArgs(argv: string[]): { db?: string; out?: string } {
  const out: { db?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') out.db = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const dbPath = args.db ?? resolve(repoRoot, 'data/lacrosse.db');
  const outPath = args.out ?? resolve(repoRoot, '.github/docs/2026-04-23-laxnumbers-aliases.csv');

  const db = openDb(dbPath);
  try {
    const anomalies = db
      .prepare(
        `SELECT raw_line FROM ingest_anomalies WHERE strategy_attempted = 'laxnumbers-unknown-team'`,
      )
      .all() as AnomalyRow[];
    const teamNames = (db.prepare(`SELECT name FROM teams`).all() as { name: string }[]).map(
      (r) => r.name,
    );

    const rows = buildAliasRows(anomalies, teamNames);
    const csv = renderCsv(rows);

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, csv, 'utf8');

    log.info(
      `Wrote ${rows.length} distinct LN names (${anomalies.length} anomalies) -> ${outPath}`,
    );
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath === thisPath) {
  main().catch((err) => {
    log.error(err);
    process.exit(1);
  });
}
