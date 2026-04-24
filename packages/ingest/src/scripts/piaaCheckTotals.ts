/**
 * piaaCheckTotals.ts — read-only cross-check of PIAA-published season totals
 * against what the local DB computes from per-game results.
 *
 * Source-authority context (Wave H9, see .github/docs/2026-04-24-wave-h9-plan.md):
 *   PIAA publishes season W/L/total-points only (no per-game scores). The
 *   server already overrides the displayed team record with PIAA when one
 *   exists; this script flags the inverse — places where our locally-computed
 *   totals disagree with PIAA — so a human can reconcile.
 *
 * For each team in piaa_official_teams that maps to an internal team via
 * getPiaaForTeam (direct name match or team_aliases hop), compute from the
 * games table:
 *   - wins/losses/ties (postponed=0, comparing home_score vs away_score)
 *   - goals scored (sum of this team's score across home + away appearances)
 * and emit one row whenever any of (wins, losses, total_points) disagrees
 * with the PIAA snapshot.
 *
 * Output:
 *   .github/docs/2026-04-24-piaa-totals-mismatch.json
 *
 * Usage:
 *   DB_PATH=./data/lacrosse.db pnpm --filter @pll/ingest piaa:check-totals
 *
 * Read-only: never writes to the DB.
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { getPiaaForTeam } from '../queries/piaa.js';

import { createLogger } from '@pll/shared';
const log = createLogger({ name: 'ingest:piaaCheckTotals' });
export interface MismatchRow {
  teamId: number;
  teamName: string;
  piaaWins: number;
  piaaLosses: number;
  piaaTotalPoints: number;
  computedWins: number;
  computedLosses: number;
  computedGoalsScored: number;
  deltaWins: number;
  deltaLosses: number;
  deltaPoints: number;
}

interface ComputedTotals {
  wins: number;
  losses: number;
  ties: number;
  goalsScored: number;
}

const COMPUTE_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN g.home_team_id = @id AND g.home_score > g.away_score THEN 1
                      WHEN g.away_team_id = @id AND g.away_score > g.home_score THEN 1
                      ELSE 0 END), 0) AS wins,
    COALESCE(SUM(CASE WHEN g.home_team_id = @id AND g.home_score < g.away_score THEN 1
                      WHEN g.away_team_id = @id AND g.away_score < g.home_score THEN 1
                      ELSE 0 END), 0) AS losses,
    COALESCE(SUM(CASE WHEN g.home_score = g.away_score THEN 1 ELSE 0 END), 0) AS ties,
    COALESCE(SUM(CASE WHEN g.home_team_id = @id THEN g.home_score
                      WHEN g.away_team_id = @id THEN g.away_score
                      ELSE 0 END), 0) AS goals_scored
  FROM games g
  WHERE g.postponed = 0
    AND (g.home_team_id = @id OR g.away_team_id = @id)
`;

/**
 * Compute season W/L/T and goals-scored for one team from the games table.
 * Excludes postponed games. Exported for tests.
 */
export function computeTotalsForTeam(db: DatabaseType, teamId: number): ComputedTotals {
  const row = db.prepare(COMPUTE_SQL).get({ id: teamId }) as {
    wins: number;
    losses: number;
    ties: number;
    goals_scored: number;
  };
  return {
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    goalsScored: row.goals_scored,
  };
}

interface TeamRow {
  id: number;
  name: string;
}

/**
 * Walk every team in `teams` and emit a MismatchRow when (a) the team has a
 * PIAA snapshot row and (b) at least one of wins/losses/total_points
 * disagrees with the locally-computed totals.
 *
 * Ties are ignored as a mismatch trigger per the H9 plan (PIAA tie data is
 * brittle and lacrosse rarely ties), but per-team computed values still
 * include them in the W/L counts as published.
 *
 * Sort: |deltaWins|+|deltaLosses| desc, then |deltaPoints| desc, then teamId.
 */
export function findTotalsMismatches(db: DatabaseType): MismatchRow[] {
  const teams = db.prepare(`SELECT id, name FROM teams ORDER BY id`).all() as TeamRow[];
  const out: MismatchRow[] = [];

  for (const team of teams) {
    const piaa = getPiaaForTeam(db, team.id);
    if (!piaa) continue;

    const computed = computeTotalsForTeam(db, team.id);
    const piaaTotalPoints = Number(piaa.total_points);
    const deltaWins = computed.wins - piaa.wins;
    const deltaLosses = computed.losses - piaa.losses;
    const deltaPoints = computed.goalsScored - piaaTotalPoints;

    if (deltaWins === 0 && deltaLosses === 0 && deltaPoints === 0) continue;

    out.push({
      teamId: team.id,
      teamName: team.name,
      piaaWins: piaa.wins,
      piaaLosses: piaa.losses,
      piaaTotalPoints,
      computedWins: computed.wins,
      computedLosses: computed.losses,
      computedGoalsScored: computed.goalsScored,
      deltaWins,
      deltaLosses,
      deltaPoints,
    });
  }

  out.sort((a, b) => {
    const recordSeverity =
      Math.abs(b.deltaWins) + Math.abs(b.deltaLosses)
      - (Math.abs(a.deltaWins) + Math.abs(a.deltaLosses));
    if (recordSeverity !== 0) return recordSeverity;
    const pointSeverity = Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints);
    if (pointSeverity !== 0) return pointSeverity;
    return a.teamId - b.teamId;
  });

  return out;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ingest/src/scripts → repo root is ../../../..
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const DEFAULT_OUT = resolve(
  REPO_ROOT,
  '.github/docs/2026-04-24-piaa-totals-mismatch.json',
);

function formatTopTable(rows: MismatchRow[], limit = 10): string {
  if (rows.length === 0) return '(no mismatches)';
  const top = rows.slice(0, limit);
  const header = ['team', 'piaa W-L', 'comp W-L', 'piaa pts', 'comp pts', 'ΔW', 'ΔL', 'Δpts'];
  const widths = header.map((h) => h.length);
  const cells = top.map((r) => [
    `${r.teamName} (#${r.teamId})`,
    `${r.piaaWins}-${r.piaaLosses}`,
    `${r.computedWins}-${r.computedLosses}`,
    String(r.piaaTotalPoints),
    String(r.computedGoalsScored),
    String(r.deltaWins),
    String(r.deltaLosses),
    String(r.deltaPoints),
  ]);
  for (const row of cells) {
    row.forEach((c, i) => {
      if (c.length > widths[i]!) widths[i] = c.length;
    });
  }
  const fmt = (row: string[]): string =>
    row.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [fmt(header), fmt(widths.map((w) => '-'.repeat(w))), ...cells.map(fmt)].join('\n');
}

function main(): void {
  const dbPath = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? './data/lacrosse.db';
  const outPath = process.env.PIAA_TOTALS_OUT ?? DEFAULT_OUT;

  const db = openDb(resolve(dbPath));
  try {
    const mismatches = findTotalsMismatches(db);

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(mismatches, null, 2)}\n`, 'utf8');

    log.info(`piaa:check-totals — ${mismatches.length} mismatches`);
    log.info(formatTopTable(mismatches));
    log.info(`piaa:check-totals — wrote ${outPath}`);
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
