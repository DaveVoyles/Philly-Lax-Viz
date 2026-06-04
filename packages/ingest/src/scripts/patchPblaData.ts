#!/usr/bin/env tsx
// patchPblaData.ts - Auto-patch pblaData.ts game scores AND team standings from the local snapshot.
//
// Reads data/pbla-2026-snapshot.json and:
// 1. Replaces any 0-0 games in pblaData.ts where the snapshot has actual scores.
// 2. Recomputes each team's gp/wins/losses/ties/pf/pa/diff/pts/streak from ALL played games.
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaData.ts
//   pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaData.ts --dry-run

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');

const SNAPSHOT_PATH = resolve(REPO_ROOT, 'data/pbla-2026-snapshot.json');
const PBLA_DATA_PATH = resolve(REPO_ROOT, 'packages/web/src/views/pblaData.ts');

interface SnapshotGame {
  gameNum: number;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

interface Snapshot {
  leagueId: number;
  year: number;
  snapshotDate: string;
  games: SnapshotGame[];
}

interface TeamStats {
  gp: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compute per-team standings from all played games in the snapshot. */
export function computeStandings(games: SnapshotGame[]): Map<string, TeamStats> {
  const standings = new Map<string, TeamStats>();
  const played = games.filter((g) => g.homeScore > 0 || g.awayScore > 0);

  for (const g of played) {
    for (const [name, scored, allowed] of [
      [g.homeTeam, g.homeScore, g.awayScore],
      [g.awayTeam, g.awayScore, g.homeScore],
    ] as [string, number, number][]) {
      if (!standings.has(name)) {
        standings.set(name, { gp: 0, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 });
      }
      const t = standings.get(name)!;
      t.gp++;
      t.pf += scored;
      t.pa += allowed;
      if (scored > allowed) t.wins++;
      else if (scored < allowed) t.losses++;
      else t.ties++;
    }
  }
  return standings;
}

/** Compute win/loss streak from games sorted by date (ascending). */
export function computeStreak(teamName: string, games: SnapshotGame[]): string {
  const played = games
    .filter((g) => (g.homeTeam === teamName || g.awayTeam === teamName) && (g.homeScore > 0 || g.awayScore > 0))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (played.length === 0) return 'W0';

  const results = played.map((g) => {
    const isHome = g.homeTeam === teamName;
    const scored = isHome ? g.homeScore : g.awayScore;
    const allowed = isHome ? g.awayScore : g.homeScore;
    return scored > allowed ? 'W' : scored < allowed ? 'L' : 'T';
  });

  const lastResult = results[results.length - 1];
  let streak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] === lastResult) streak++;
    else break;
  }
  return `${lastResult}${streak}`;
}

export function buildGamePattern(game: SnapshotGame): RegExp {
  const datePat = escapeRegex(game.date);
  const homePat = escapeRegex(game.homeTeam);
  const awayPat = escapeRegex(game.awayTeam);
  // Match game entry with 0-0 scores. Use .*? between fields to tolerate
  // intermediate fields like `time` between `date` and `homeTeam`.
  return new RegExp(
    `(date:\\s*'${datePat}'.*?homeTeam:\\s*'${homePat}',\\s*awayTeam:\\s*'${awayPat}',\\s*homeScore:\\s*)0(,\\s*awayScore:\\s*)0`,
    'g'
  );
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  const snapshot: Snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  let content = readFileSync(PBLA_DATA_PATH, 'utf8');

  const gamesToPatch = snapshot.games.filter(
    (g) => g.homeScore > 0 || g.awayScore > 0
  );

  let patchCount = 0;
  let skipCount = 0;

  for (const game of gamesToPatch) {
    const pattern = buildGamePattern(game);
    const before = content;
    content = content.replace(
      pattern,
      `$1${game.homeScore}$2${game.awayScore}`
    );
    if (content !== before) {
      console.log(
        `  patched game ${game.gameNum}: ${game.homeTeam} ${game.homeScore} - ${game.awayScore} ${game.awayTeam} (${game.date})`
      );
      patchCount++;
    } else {
      // Either already has scores or pattern didn't match
      skipCount++;
    }
  }

  if (patchCount === 0) {
    console.log(
      `[patchPblaData] No games to patch (${gamesToPatch.length} scored game(s) already up to date in pblaData.ts)`
    );
  } else if (isDryRun) {
    console.log(`[patchPblaData] Dry run: would patch ${patchCount} game(s)`);
  } else {
    writeFileSync(PBLA_DATA_PATH, content, 'utf8');
    console.log(`[patchPblaData] Patched ${patchCount} game(s) in pblaData.ts`);
  }

  // --- Recompute and patch team standings from all played games ---
  const standings = computeStandings(snapshot.games);
  let standingsPatchCount = 0;

  for (const [teamName, stats] of standings) {
    const { gp, wins, losses, ties, pf, pa } = stats;
    const diff = pf - pa;
    const pts = wins * 3 + ties;
    const streak = computeStreak(teamName, snapshot.games);
    const escaped = escapeRegex(teamName);

    // Match the team entry line and replace numeric stats fields in-order
    const pattern = new RegExp(
      `(name:\\s*'${escaped}',\\s*gp:\\s*)-?\\d+(,\\s*wins:\\s*)\\d+(,\\s*losses:\\s*)\\d+(,\\s*ties:\\s*)\\d+(,\\s*otw:\\s*)\\d+(,\\s*otl:\\s*)\\d+(,\\s*pts:\\s*)\\d+(,\\s*pf:\\s*)\\d+(,\\s*pa:\\s*)\\d+(,\\s*diff:\\s*)-?\\d+(,\\s*streak:\\s*)'[^']*'`
    );

    const before = content;
    content = content.replace(
      pattern,
      (_match, g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11) =>
        `${g1}${gp}${g2}${wins}${g3}${losses}${g4}${ties}${g5}0${g6}0${g7}${pts}${g8}${pf}${g9}${pa}${g10}${diff}${g11}'${streak}'`
    );

    if (content !== before) {
      console.log(
        `  standings: ${teamName} → ${wins}W-${losses}L-${ties}T gp=${gp} pts=${pts} pf=${pf} pa=${pa} diff=${diff} streak=${streak}`
      );
      standingsPatchCount++;
    }
  }

  if (standingsPatchCount === 0) {
    console.log('[patchPblaData] Team standings already up to date');
  } else if (isDryRun) {
    console.log(`[patchPblaData] Dry run: would update ${standingsPatchCount} team standings`);
  } else {
    writeFileSync(PBLA_DATA_PATH, content, 'utf8');
    console.log(`[patchPblaData] Updated ${standingsPatchCount} team standings in pblaData.ts`);
  }
}

// Only run when invoked directly, not when imported by tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[patchPblaData] fatal:', err);
    process.exit(1);
  });
}
