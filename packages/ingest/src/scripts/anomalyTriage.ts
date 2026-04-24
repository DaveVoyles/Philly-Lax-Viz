// anomalyTriage.ts -- read-only analysis of `ingest_anomalies`.
//
// Produces `data/anomaly-triage.md` summarizing the most frequent
// (strategy_attempted, reason) groups with up to 5 sample raw_line values
// and source post URLs each, plus a fix-difficulty (S/M/L) classification
// to help prioritize parser work in W9+.
//
// Pure read; never mutates the DB.
//
// Usage:
//   pnpm --filter @pll/ingest anomaly:triage
//   pnpm --filter @pll/ingest exec tsx src/scripts/anomalyTriage.ts [--db PATH] [--out PATH] [--top N]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:anomalyTriage' });
export interface AnomalyGroup {
  strategy: string;
  reason: string;
  count: number;
  samples: AnomalySample[];
  difficulty: 'S' | 'M' | 'L';
  difficultyRationale: string;
}

export interface AnomalySample {
  rawLine: string;
  sourceUrl: string;
  sourcePostId: string;
}

export interface TriageReport {
  totalAnomalies: number;
  uniqueGroups: number;
  generatedAt: string;
  topGroups: AnomalyGroup[];
}

/** Strip em-dashes / en-dashes and other non-ASCII chars to keep output ASCII-only. */
function asciiSafe(s: string): string {
  return s
    .replace(/\u2014/g, '--') // em-dash
    .replace(/\u2013/g, '-')  // en-dash
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    // Drop any remaining non-printable / non-ASCII; preserve tab/newline.
    .replace(/[^\x09\x0A\x20-\x7E]/g, '?');
}

/**
 * Heuristic: classify fix difficulty per group from the strategy + reason text.
 * S: small, regex/lookup tweak. M: meaningful parser work. L: structural rework
 * or domain knowledge required (e.g. fuzzy alias matching, format detection).
 *
 * Pure function -- documented so future waves can audit the call.
 */
export function classifyDifficulty(
  strategy: string,
  reason: string,
): { difficulty: 'S' | 'M' | 'L'; rationale: string } {
  const key = `${strategy}|${reason}`;

  // Quarter-line team hint mismatch -- needs an alias/fuzzy resolver. Many
  // distinct hints, likely needs a per-team alias seed plus a token matcher.
  if (
    strategy === 'quarter-line' &&
    /team hint did not resolve/i.test(reason)
  ) {
    return {
      difficulty: 'M',
      rationale:
        'Team-hint resolution: extend team_aliases with the abbreviations seen here (MHS/PHX/JBHA/etc.). Mostly mechanical alias seeding, but volume (143) and per-team variance push it past trivial.',
    };
  }

  // Period sum mismatch -- already stored, soft warning. Minor: tighten parser
  // or downgrade to info-level once a cause is confirmed.
  if (strategy === 'quarter-line' && /period sum does not equal total/i.test(reason)) {
    return {
      difficulty: 'S',
      rationale:
        'Soft warning -- periods are already persisted. Likely OT/SO handling or transcription quirks. Audit a sample, then either downgrade severity or special-case OT.',
    };
  }

  // Stat tokens unrecognized -- needs vocabulary expansion in player-stat parser.
  if (strategy === 'player-stat-line' && /no stat tokens recognized/i.test(reason)) {
    return {
      difficulty: 'M',
      rationale:
        'Vocabulary gap in stat tokenizer. Inspect the 34 raw lines, group by token shape (e.g. "saves", "ground balls", abbreviations), then extend the recognized-token table.',
    };
  }

  // Score-line shape mismatch -- needs alternate regexes for "Team A N - Team B N",
  // tabular forms, etc.
  if (strategy === 'score-line' && /did not match Team A N, Team B N/i.test(reason)) {
    return {
      difficulty: 'M',
      rationale:
        'Add alternative score-line regexes (dash separator, tab separator, "vs" form). 16 cases -- tractable but requires care to avoid false-positives on quarter lines.',
    };
  }

  // Duplicate ranks -- benign per pre-flight, just data noise.
  if (strategy === 'ranking-list' && /duplicate rank \d+ in post/i.test(reason)) {
    return {
      difficulty: 'S',
      rationale:
        'Benign: same post emits the same rank multiple times (mirrored lists). Either dedupe in parser or filter from anomaly log to reduce noise.',
    };
  }

  // Aggregated-list header missing -- format/header regex
  if (strategy === 'aggregated-list' && /no .* header recognized/i.test(reason)) {
    return {
      difficulty: 'S',
      rationale:
        'Header pattern mismatch in aggregated lists. Inspect samples, expand header regex to accept the missing variants.',
    };
  }

  // Default
  return {
    difficulty: 'M',
    rationale:
      'Unclassified group; review samples to determine fix scope. Defaulting to M.',
  };
}

/** Pure: query the DB and build the report. Does not write to disk. */
export function buildReport(db: Database, topN = 10): TriageReport {
  const totalAnomalies = (
    db.prepare('SELECT COUNT(*) AS c FROM ingest_anomalies').get() as { c: number }
  ).c;

  const uniqueGroups = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM (SELECT 1 FROM ingest_anomalies GROUP BY strategy_attempted, reason)',
      )
      .get() as { c: number }
  ).c;

  const groupRows = db
    .prepare(
      `SELECT strategy_attempted AS strategy, reason, COUNT(*) AS count
         FROM ingest_anomalies
        GROUP BY strategy_attempted, reason
        ORDER BY count DESC, strategy ASC, reason ASC
        LIMIT ?`,
    )
    .all(topN) as Array<{ strategy: string; reason: string; count: number }>;

  const sampleStmt = db.prepare(
    `SELECT raw_line AS rawLine, source_url AS sourceUrl, source_post_id AS sourcePostId
       FROM ingest_anomalies
      WHERE strategy_attempted = ? AND reason = ?
      ORDER BY id ASC
      LIMIT 5`,
  );

  const topGroups: AnomalyGroup[] = groupRows.map((g) => {
    const samples = sampleStmt.all(g.strategy, g.reason) as AnomalySample[];
    const cls = classifyDifficulty(g.strategy, g.reason);
    return {
      strategy: g.strategy,
      reason: g.reason,
      count: g.count,
      samples,
      difficulty: cls.difficulty,
      difficultyRationale: cls.rationale,
    };
  });

  return {
    totalAnomalies,
    uniqueGroups,
    generatedAt: new Date().toISOString(),
    topGroups,
  };
}

/** Render a TriageReport as a markdown string. ASCII-only. */
export function renderMarkdown(report: TriageReport): string {
  const lines: string[] = [];
  lines.push('# Ingest Anomaly Triage');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(
    `Total anomalies: **${report.totalAnomalies}** across **${report.uniqueGroups}** unique (strategy, reason) groups.`,
  );
  lines.push('');
  lines.push(
    'Read-only analysis of `ingest_anomalies`. No parser changes in this pass -- this report exists to drive prioritization for W9+.',
  );
  lines.push('');
  lines.push('## Top patterns');
  lines.push('');
  lines.push('| # | Strategy | Reason | Count | Fix difficulty |');
  lines.push('|---|----------|--------|------:|:--------------:|');
  report.topGroups.forEach((g, i) => {
    lines.push(
      `| ${i + 1} | ${asciiSafe(g.strategy)} | ${asciiSafe(g.reason)} | ${g.count} | ${g.difficulty} |`,
    );
  });
  lines.push('');
  lines.push('Difficulty legend: **S** = small (regex/alias tweak), **M** = medium (parser logic), **L** = large (structural rework).');
  lines.push('');
  lines.push('## Per-pattern detail');
  lines.push('');

  report.topGroups.forEach((g, i) => {
    lines.push(`### ${i + 1}. [${g.difficulty}] ${asciiSafe(g.strategy)} -- ${asciiSafe(g.reason)}`);
    lines.push('');
    lines.push(`- Count: **${g.count}**`);
    lines.push(`- Fix difficulty: **${g.difficulty}**`);
    lines.push(`- Rationale: ${asciiSafe(g.difficultyRationale)}`);
    lines.push('');
    if (g.samples.length === 0) {
      lines.push('_No samples found._');
      lines.push('');
      return;
    }
    lines.push('Samples:');
    lines.push('');
    g.samples.forEach((s, j) => {
      lines.push(`${j + 1}. \`${asciiSafe(s.rawLine).replace(/`/g, "'")}\``);
      lines.push(`   - post: ${asciiSafe(s.sourcePostId)}`);
      lines.push(`   - url: ${asciiSafe(s.sourceUrl)}`);
    });
    lines.push('');
  });

  return lines.join('\n');
}

interface CliArgs {
  dbPath: string;
  outPath: string;
  topN: number;
}

function parseArgs(argv: string[], here: string): CliArgs {
  const repoRoot = resolve(here, '..', '..', '..', '..');
  let dbPath = resolve(repoRoot, 'data', 'lacrosse.db');
  let outPath = resolve(repoRoot, 'data', 'anomaly-triage.md');
  let topN = 10;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db' && argv[i + 1]) {
      dbPath = resolve(argv[++i]!);
    } else if (a === '--out' && argv[i + 1]) {
      outPath = resolve(argv[++i]!);
    } else if (a === '--top' && argv[i + 1]) {
      topN = Math.max(1, parseInt(argv[++i]!, 10) || 10);
    }
  }
  return { dbPath, outPath, topN };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2), here);
  log.info(`[anomalyTriage] reading ${args.dbPath}`);
  const db = openDb(args.dbPath);
  try {
    const report = buildReport(db, args.topN);
    const md = renderMarkdown(report);
    mkdirSync(dirname(args.outPath), { recursive: true });
    writeFileSync(args.outPath, md, 'utf8');
    log.info(
      `[anomalyTriage] wrote ${args.outPath} -- ${report.totalAnomalies} anomalies, ${report.topGroups.length} groups (top ${args.topN})`,
    );
  } finally {
    db.close();
  }
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();
