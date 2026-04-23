/**
 * Short-name player audit (Wave H0 Lane 4, hygiene 2026-04-23).
 *
 * Read-only detection script: surfaces players whose name is a single token
 * <= --max-len characters long. These are typically parser fragments
 * (e.g. "Doll", "Cobb") but some are legit surnames (e.g. "Kane"). Output is
 * a stdout table plus a JSON report under `.github/docs/` for manual triage.
 *
 * This script does NOT mutate the DB. The `--apply` flag is accepted for
 * symmetry with sibling audit scripts but is an explicit no-op.
 *
 * Usage:
 *   pnpm --filter @pll/ingest exec tsx src/scripts/auditShortNames.ts \
 *     [--max-len N] [--apply]
 */
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MAX_LEN = 4;

export interface ShortNameRow {
  id: number;
  name: string;
  team: string | null;
  games: number;
  goals: number;
  assists: number;
  sample_recap: string | null;
}

export interface ShortNameReportEntry extends ShortNameRow {
  triage_decision: null;
}

interface RawRow {
  id: number;
  name: string;
  team: string | null;
  games: number | null;
  goals: number | null;
  assists: number | null;
  sample_recap: string | null;
}

/**
 * Find players whose name has no whitespace and length <= maxLen.
 * Joins team name, count of distinct games played, lifetime goals/assists,
 * and the recap_url of the most recent game (by games.date) the player
 * appears in via player_stats. Returns rows sorted by games DESC, name ASC.
 */
export function findShortNamePlayers(db: DatabaseType, maxLen: number): ShortNameRow[] {
  const rows = db
    .prepare(
      `SELECT p.id,
              p.name,
              t.name AS team,
              (SELECT COUNT(DISTINCT ps.game_id)
                 FROM player_stats ps
                WHERE ps.player_id = p.id) AS games,
              COALESCE((SELECT SUM(ps.goals)   FROM player_stats ps WHERE ps.player_id = p.id), 0) AS goals,
              COALESCE((SELECT SUM(ps.assists) FROM player_stats ps WHERE ps.player_id = p.id), 0) AS assists,
              (SELECT g.recap_url
                 FROM player_stats ps
                 JOIN games g ON g.id = ps.game_id
                WHERE ps.player_id = p.id
                ORDER BY g.date DESC, g.id DESC
                LIMIT 1) AS sample_recap
         FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
        WHERE instr(p.name, ' ') = 0
          AND instr(p.name, char(9)) = 0
          AND length(p.name) <= ?
        ORDER BY games DESC, p.name ASC`,
    )
    .all(maxLen) as RawRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    team: r.team,
    games: r.games ?? 0,
    goals: r.goals ?? 0,
    assists: r.assists ?? 0,
    sample_recap: r.sample_recap,
  }));
}

export function formatTable(rows: ShortNameRow[]): string {
  const header = ['id', 'name', 'team', 'games', 'g', 'a', 'sample_recap'];
  const data = rows.map((r) => [
    String(r.id),
    r.name,
    r.team ?? '',
    String(r.games),
    String(r.goals),
    String(r.assists),
    r.sample_recap ?? '',
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i]!.length)),
  );
  const fmt = (cols: string[]): string =>
    cols.map((c, i) => c.padEnd(widths[i]!)).join(' | ');
  return [fmt(header), widths.map((w) => '-'.repeat(w)).join('-+-'), ...data.map(fmt)].join('\n');
}

export function buildReport(rows: ShortNameRow[]): ShortNameReportEntry[] {
  return rows.map((r) => ({ ...r, triage_decision: null }));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseMaxLen(argv: string[]): number {
  const idx = argv.indexOf('--max-len');
  if (idx === -1) return DEFAULT_MAX_LEN;
  const raw = argv[idx + 1];
  const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-len requires a positive integer, got: ${raw ?? '(missing)'}`);
  }
  return n;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const maxLen = parseMaxLen(process.argv);
  const dbPath = process.env.DB_PATH ?? './data/lacrosse.db';
  const db = new Database(resolve(dbPath), { readonly: true });
  db.pragma('foreign_keys = ON');

  if (apply) {
    console.log('auditShortNames is read-only; --apply has no effect');
  }

  const rows = findShortNamePlayers(db, maxLen);
  console.log(`[audit-short-names] flagged ${rows.length} players (max-len=${maxLen})`);
  console.log(formatTable(rows));

  const report = buildReport(rows);
  // Script lives at packages/ingest/src/scripts/auditShortNames.ts; repo root is 4 dirs up.
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '..', '..', '..', '..');
  const reportPath = resolve(repoRoot, '.github', 'docs', `${todayIsoDate()}-short-names-report.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`[audit-short-names] wrote ${reportPath}`);
}

const isDirectInvocation =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /auditShortNames\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (isDirectInvocation) main();
