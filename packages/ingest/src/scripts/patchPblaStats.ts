#!/usr/bin/env tsx
// patchPblaStats.ts - Auto-patch pblaData.ts player and goalie stats from Sportability.
//
// Fetches per-team skater and goalie stats from Sportability and replaces the
// `players` and `goalies` arrays in pblaData.ts for the current season (2026).
// Per-team queries are required because the global stats page only shows top scorers.
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts            # apply
//   pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts --dry-run  # preview only

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  standingsUrl,
  scorersTeamUrl,
  goaliesTeamUrl,
  parseStandingsHtml,
  parseScorersHtml,
  parseGoaliesHtml,
} from '../sources/sportability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const PBLA_DATA_PATH = resolve(REPO_ROOT, 'packages/web/src/views/pblaData.ts');
const LEAGUE_ID = 50731;

const DRY_RUN = process.argv.includes('--dry-run');

const UA_HEADERS = {
  'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA stats patch',
  Accept: 'text/html,application/xhtml+xml',
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder('latin1').decode(buf);
}

function escapeForTs(name: string): string {
  if (name.includes("'")) return `"${name}"`;
  return `'${name}'`;
}

function formatPlayerEntry(p: { jersey: number; name: string; team: string; gp: number; goals: number; assists: number; points: number; penalties: number; pim: number }): string {
  return `      { jersey: ${p.jersey}, name: ${escapeForTs(p.name)}, team: ${escapeForTs(p.team)}, gp: ${p.gp}, goals: ${p.goals}, assists: ${p.assists}, points: ${p.points}, penalties: ${p.penalties}, pim: ${p.pim} },`;
}

function formatGoalieEntry(g: { jersey: number; name: string; team: string; gp: number; min: number; ga: number; gaa: number }): string {
  return `      { jersey: ${g.jersey}, name: ${escapeForTs(g.name)}, team: ${escapeForTs(g.team)}, gp: ${g.gp}, min: ${g.min}, ga: ${g.ga}, gaa: ${g.gaa.toFixed(2)} },`;
}

function replacePlayers(src: string, lines: string[]): string {
  const blockRe = /([ \t]*players:\s*\[)[^\]]*(\],)/;
  const inner = lines.length > 0 ? '\n' + lines.join('\n') + '\n    ' : '';
  return src.replace(blockRe, `$1${inner}$2`);
}

function replaceGoalies(src: string, lines: string[]): string {
  const blockRe = /([ \t]*goalies:\s*\[)[^\]]*(\],)/;
  const inner = lines.length > 0 ? '\n' + lines.join('\n') + '\n    ' : '';
  return src.replace(blockRe, `$1${inner}$2`);
}

async function main(): Promise<void> {
  console.log(`[patchPblaStats] Fetching standings to get team IDs (league ${LEAGUE_ID})...`);
  const standingsHtml = await fetchHtml(standingsUrl(LEAGUE_ID));
  const teams = parseStandingsHtml(standingsHtml).filter((t) => t.id > 0);
  console.log(`[patchPblaStats] Found ${teams.length} teams: ${teams.map((t) => t.name).join(', ')}`);

  console.log('[patchPblaStats] Fetching per-team player and goalie stats...');
  const results = await Promise.all(
    teams.map(async (team) => {
      const [scorersHtml, goaliesHtml] = await Promise.all([
        fetchHtml(scorersTeamUrl(LEAGUE_ID, team.id)),
        fetchHtml(goaliesTeamUrl(LEAGUE_ID, team.id)),
      ]);
      const players = parseScorersHtml(scorersHtml).filter(
        (p) => !p.name.toLowerCase().startsWith('bench'),
      );
      const goalies = parseGoaliesHtml(goaliesHtml).filter(
        (g) => !g.name.toLowerCase().startsWith('bench'),
      );
      console.log(`  ${team.name}: ${players.length} players, ${goalies.length} goalies`);
      return { team, players, goalies };
    }),
  );

  const allPlayers = results.flatMap((r) => r.players);
  const allGoalies = results.flatMap((r) => r.goalies);

  if (allPlayers.length === 0) {
    console.error('[patchPblaStats] No players returned — aborting to avoid data loss.');
    process.exit(1);
  }

  const sortedPlayers = [...allPlayers].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goals !== a.goals) return b.goals - a.goals;
    return a.name.localeCompare(b.name);
  });

  const sortedGoalies = [...allGoalies].sort((a, b) => {
    if (a.gaa !== b.gaa) return a.gaa - b.gaa;
    return b.min - a.min;
  });

  console.log(`[patchPblaStats] Total: ${sortedPlayers.length} players, ${sortedGoalies.length} goalies`);

  const playerLines = sortedPlayers.map(formatPlayerEntry);
  const goalieLines = sortedGoalies.map(formatGoalieEntry);

  const src = readFileSync(PBLA_DATA_PATH, 'utf-8');
  let updated = replacePlayers(src, playerLines);
  updated = replaceGoalies(updated, goalieLines);

  if (updated === src) {
    console.log('[patchPblaStats] No changes — pblaData.ts already up to date.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[patchPblaStats] DRY RUN — would write players (first 5):');
    playerLines.slice(0, 5).forEach((l) => console.log(l));
    if (playerLines.length > 5) console.log(`  ... (${playerLines.length} total)`);
    console.log('\n[patchPblaStats] Goalies (first 3):');
    goalieLines.slice(0, 3).forEach((l) => console.log(l));
    if (goalieLines.length > 3) console.log(`  ... (${goalieLines.length} total)`);
    return;
  }

  writeFileSync(PBLA_DATA_PATH, updated, 'utf-8');
  console.log(`[patchPblaStats] Wrote ${playerLines.length} players and ${sortedGoalies.length} goalies to pblaData.ts`);
}

main().catch((err) => {
  console.error('[patchPblaStats] Error:', err);
  process.exit(1);
});
