// seedAliasesFromMine.ts — RFC 01 phase B (Yoda 👽✨).
//
// Reads a candidate TSV produced by mineAliases.ts and inserts the accepted
// (non-rejected) rows into team_aliases with `source='anomaly-mined'` plus a
// `notes` payload that records the supporting evidence. Uses INSERT OR IGNORE
// so manually-curated aliases always win.
//
// Default mode is dry-run; pass --apply to actually write.
//
// Usage:
//   pnpm --filter @pll/ingest seed:aliases:mined                   # dry-run from data/aliases-candidates.tsv
//   pnpm --filter @pll/ingest seed:aliases:mined -- --apply
//   pnpm --filter @pll/ingest seed:aliases:mined -- --tsv path.tsv --min-confidence 0.80

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { createLogger } from '@pll/shared';
import { openDb } from '../db.js';
import { MINER_SOURCE } from './mineAliases.js';

const log = createLogger({ name: 'ingest:seedAliasesFromMine' });

export interface SeedRow {
  alias: string;
  teamId: number;
  teamName: string;
  occurrences: number;
  distinctPosts: number;
  purity: number;
  confidence: number;
  rejected: string;
  samplePostId: string;
  sampleRawLine: string;
}

const TSV_COLUMNS = [
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
] as const;

export function parseTsv(contents: string): SeedRow[] {
  const lines = contents.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0]!.split('\t');
  for (let i = 0; i < TSV_COLUMNS.length; i += 1) {
    if (header[i] !== TSV_COLUMNS[i]) {
      throw new Error(
        `seedAliasesFromMine: TSV header mismatch at column ${i}: expected "${TSV_COLUMNS[i]}", got "${header[i]}"`,
      );
    }
  }
  const rows: SeedRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i]!.split('\t');
    rows.push({
      alias: cells[0] ?? '',
      teamId: Number(cells[1]),
      teamName: cells[2] ?? '',
      occurrences: Number(cells[3]),
      distinctPosts: Number(cells[4]),
      purity: Number(cells[5]),
      confidence: Number(cells[6]),
      rejected: cells[7] ?? '',
      samplePostId: cells[8] ?? '',
      sampleRawLine: cells[9] ?? '',
    });
  }
  return rows;
}

export interface SeedResult {
  considered: number;
  filteredOut: number;
  inserted: number;
  alreadyPresent: number;
  missingTeam: SeedRow[];
}

/** Build the `notes` provenance string written into team_aliases.notes. */
export function buildNotes(row: SeedRow): string {
  return [
    `source=${MINER_SOURCE}`,
    `occurrences=${row.occurrences}`,
    `distinct_posts=${row.distinctPosts}`,
    `purity=${row.purity.toFixed(3)}`,
    `sample_post=${row.samplePostId}`,
    `sample="${row.sampleRawLine.replace(/"/g, "'")}"`,
  ].join('; ');
}

/**
 * Insert accepted rows into team_aliases. Caller controls minConfidence to
 * support `--aggressive`-style flags later. Idempotent via INSERT OR IGNORE.
 */
export function seedFromCandidates(
  db: DatabaseType,
  rows: readonly SeedRow[],
  options: { minConfidence: number; apply: boolean } = { minConfidence: 0.8, apply: false },
): SeedResult {
  const teamExists = db.prepare('SELECT 1 FROM teams WHERE id = ?');
  const aliasExists = db.prepare('SELECT 1 FROM team_aliases WHERE alias = ?');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO team_aliases (alias, team_id, source, confidence, notes, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );

  const result: SeedResult = {
    considered: 0,
    filteredOut: 0,
    inserted: 0,
    alreadyPresent: 0,
    missingTeam: [],
  };

  const tx = db.transaction(() => {
    for (const row of rows) {
      result.considered += 1;
      if (row.rejected || row.confidence < options.minConfidence || !row.alias) {
        result.filteredOut += 1;
        continue;
      }
      if (!teamExists.get(row.teamId)) {
        result.missingTeam.push(row);
        continue;
      }
      if (aliasExists.get(row.alias)) {
        result.alreadyPresent += 1;
        continue;
      }
      if (options.apply) {
        const info = insert.run(row.alias, row.teamId, MINER_SOURCE, row.confidence, buildNotes(row));
        if (info.changes === 1) result.inserted += 1;
        else result.alreadyPresent += 1;
      } else {
        // Dry-run: count as if we'd insert.
        result.inserted += 1;
      }
    }
  });
  tx();

  return result;
}

function printResult(result: SeedResult, apply: boolean, minConf: number): void {
  log.info(
    {
      apply,
      minConfidence: minConf,
      considered: result.considered,
      filteredOut: result.filteredOut,
      alreadyPresent: result.alreadyPresent,
      inserted: result.inserted,
      missingTeamCount: result.missingTeam.length,
    },
    'seedAliasesFromMine summary',
  );
  for (const row of result.missingTeam.slice(0, 10)) {
    log.warn({ alias: row.alias, teamId: row.teamId, teamName: row.teamName }, 'missing team row skipped');
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const tsvIdx = argv.indexOf('--tsv');
  const minIdx = argv.indexOf('--min-confidence');
  const minConfidence = minIdx >= 0 && argv[minIdx + 1] ? Number(argv[minIdx + 1]) : 0.8;

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..', '..');
  const tsvPath =
    tsvIdx >= 0 && argv[tsvIdx + 1]
      ? resolve(argv[tsvIdx + 1]!)
      : resolve(repoRoot, 'data', 'aliases-candidates.tsv');
  const dbPath = process.env.DB_PATH ?? resolve(repoRoot, 'data', 'lacrosse.db');

  log.info({ tsvPath, dbPath, apply }, 'seedAliasesFromMine starting');

  const tsv = readFileSync(tsvPath, 'utf8');
  const rows = parseTsv(tsv);

  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');

  const result = seedFromCandidates(db, rows, { minConfidence, apply });
  printResult(result, apply, minConfidence);

  if (apply) {
    const total = (db.prepare('SELECT COUNT(*) AS n FROM team_aliases').get() as { n: number }).n;
    const mined = (db
      .prepare('SELECT COUNT(*) AS n FROM team_aliases WHERE source = ?')
      .get(MINER_SOURCE) as { n: number }).n;
    log.info({ total, mined }, 'team_aliases totals after apply');
  } else {
    log.info('dry-run only; re-run with --apply to write');
  }

  db.close();
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
