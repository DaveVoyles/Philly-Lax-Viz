#!/usr/bin/env tsx
// patchPblaData.ts - Auto-patch pblaData.ts game scores from the local snapshot.
//
// Reads data/pbla-2026-snapshot.json and replaces any 0-0 games in
// packages/web/src/views/pblaData.ts where the snapshot has actual scores.
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

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
}

// Only run when invoked directly, not when imported by tests
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[patchPblaData] fatal:', err);
    process.exit(1);
  });
}
