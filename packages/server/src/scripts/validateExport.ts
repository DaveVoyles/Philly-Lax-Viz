import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const EXPORT_DIR = join(REPO_ROOT, 'packages', 'web', 'public', 'data');
const SEASON = process.env.SEASON ?? '2026';
const SEASON_DIR = join(EXPORT_DIR, SEASON);

interface Check {
  path: string;
  minBytes: number;
  description: string;
}

const CRITICAL_CHECKS: Check[] = [
  { path: join(EXPORT_DIR, 'health.json'), minBytes: 50, description: 'health snapshot' },
  { path: join(EXPORT_DIR, 'seasons.json'), minBytes: 20, description: 'seasons manifest' },
  { path: join(SEASON_DIR, 'teams.json'), minBytes: 1000, description: 'teams list' },
  { path: join(SEASON_DIR, 'games.json'), minBytes: 1000, description: 'games list' },
  {
    path: join(SEASON_DIR, 'leaders', 'players', 'goals.json'),
    minBytes: 200,
    description: 'goals leaders',
  },
  {
    path: join(SEASON_DIR, 'leaders', 'players', 'assists.json'),
    minBytes: 200,
    description: 'assists leaders',
  },
  { path: join(SEASON_DIR, 'rankings.json'), minBytes: 200, description: 'rankings' },
  { path: join(SEASON_DIR, 'schedule.json'), minBytes: 200, description: 'schedule export' },
];

let failures = 0;

for (const check of CRITICAL_CHECKS) {
  if (!existsSync(check.path)) {
    console.error(`MISSING: ${check.description} (${check.path})`);
    failures += 1;
    continue;
  }

  const { size } = statSync(check.path);
  if (size < check.minBytes) {
    console.error(
      `TOO SMALL (${size}B < ${check.minBytes}B): ${check.description} (${check.path})`,
    );
    failures += 1;
    continue;
  }

  console.log(`OK (${size}B): ${check.description}`);
}

const teamsDir = join(SEASON_DIR, 'teams');
if (!existsSync(teamsDir)) {
  console.error(`MISSING: team detail directory (${teamsDir})`);
  failures += 1;
} else {
  const teamFiles = readdirSync(teamsDir).filter((file) => file.endsWith('.json'));
  if (teamFiles.length < 20) {
    console.error(`TOO FEW TEAM FILES: found ${teamFiles.length}, expected >= 20`);
    failures += 1;
  } else {
    console.log(`OK: ${teamFiles.length} team detail files`);
  }
}

console.log(`\nValidation: ${failures === 0 ? 'PASSED' : `${failures} check(s) FAILED`}`);
process.exit(failures > 0 ? 1 : 0);
