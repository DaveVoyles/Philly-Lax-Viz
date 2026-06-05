#!/usr/bin/env tsx
// patchPblaRosters.ts - Auto-patch pblaData.ts with missing players from Sportability.
//
// Fetches each team's roster from the Sportability team page and inserts any players
// that are missing from pblaData.ts. Existing entries are never modified or removed.
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts            # apply
//   pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts --dry-run  # preview only

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  standingsUrl,
  parseStandingsHtml,
  fetchTeamRoster,
} from '../sources/sportability.js';
import type { SportabilityTeam } from '../sources/sportability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const PBLA_DATA_PATH = resolve(REPO_ROOT, 'packages/web/src/views/pblaData.ts');
const LEAGUE_ID = 50731;

const UA_HEADERS = {
  'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA roster patch',
  Accept: 'text/html,application/xhtml+xml',
};

const isDryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Parse existing rosters from pblaData.ts
// Returns a map of teamName -> Set of lowercased+normalized names already present
// ---------------------------------------------------------------------------
function parseExistingRosters(text: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  const rostersBlockMatch = /rosters:\s*\{([\s\S]*?)^\s*\}/m.exec(text);
  const block = rostersBlockMatch ? rostersBlockMatch[1]! : text;

  // Match both 'Quoted Name': [ and UnquotedName: [
  const teamKeyPattern = /^\s+(?:'([^']+)'|([A-Za-z]\w*)):\s*\[/gm;
  // Match single and double quoted name values
  const playerPattern = /\{\s*name:\s*(?:'([^']+)'|"([^"]+)")/g;

  const teamStarts: Array<{ name: string; start: number }> = [];
  let tm: RegExpExecArray | null;
  while ((tm = teamKeyPattern.exec(block)) !== null) {
    const name = tm[1] ?? tm[2] ?? '';
    if (name) teamStarts.push({ name, start: tm.index });
  }

  for (let i = 0; i < teamStarts.length; i++) {
    const { name, start } = teamStarts[i]!;
    const end = i + 1 < teamStarts.length ? teamStarts[i + 1]!.start : block.length;
    const teamBlock = block.slice(start, end);

    const names = new Set<string>();
    playerPattern.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = playerPattern.exec(teamBlock)) !== null) {
      const playerName = pm[1] ?? pm[2] ?? '';
      if (playerName) names.add(playerName.toLowerCase().replace(/\s+/g, ' ').trim());
    }
    if (names.size > 0) result.set(name, names);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Find the closing `],` line of a team's roster block so we can insert before it
// ---------------------------------------------------------------------------
function findRosterInsertionPoint(text: string, teamName: string): number {
  // Match both quoted and unquoted team key followed by [
  const escapedName = teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const teamKeyRe = new RegExp(
    `(?:'${escapedName}'|${escapedName}):\\s*\\[`,
  );
  const keyMatch = teamKeyRe.exec(text);
  if (!keyMatch) return -1;

  // Find the matching closing `],` by scanning forward and tracking bracket depth
  let depth = 0;
  let i = keyMatch.index + keyMatch[0].length - 1; // position of the `[`
  while (i < text.length) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        // Insert before this `]`
        return i;
      }
    }
    i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Format a player entry as a TS object line
// Escape single quotes in names (use double-quoted string when needed)
// ---------------------------------------------------------------------------
function formatPlayerEntry(name: string, jersey: string): string {
  const needsDoubleQuote = name.includes("'");
  const nameStr = needsDoubleQuote ? `"${name}"` : `'${name}'`;
  return `        { name: ${nameStr}, jersey: '${jersey}', position: '', notes: '' },`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Fetching standings to get team IDs (LgID=${LEAGUE_ID})...`);
  const sRes = await fetch(standingsUrl(LEAGUE_ID), { headers: UA_HEADERS });
  if (!sRes.ok) {
    console.error(`Standings fetch failed: ${sRes.status}`);
    process.exit(1);
  }
  const teams: SportabilityTeam[] = parseStandingsHtml(await sRes.text());
  if (teams.length === 0) {
    console.error('No teams parsed from standings page');
    process.exit(1);
  }

  let text = readFileSync(PBLA_DATA_PATH, 'utf8');
  const existingRosters = parseExistingRosters(text);
  let totalAdded = 0;

  for (const team of teams) {
    if (!team.id) continue;

    process.stdout.write(`${team.name} (TmID=${team.id})... `);
    let liveRoster;
    try {
      liveRoster = await fetchTeamRoster(LEAGUE_ID, team, {
        fetchFn: (url) =>
          fetch(url, { headers: UA_HEADERS }) as Promise<{
            ok: boolean;
            status: number;
            text(): Promise<string>;
          }>,
      });
    } catch (err) {
      console.log(`FAILED (${err instanceof Error ? err.message : err})`);
      continue;
    }

    const existing = existingRosters.get(team.name) ?? new Set<string>();
    const missing = liveRoster.players.filter(
      (p) => !existing.has(p.name.toLowerCase().replace(/\s+/g, ' ').trim()),
    );

    if (missing.length === 0) {
      console.log(`OK (${liveRoster.players.length} players, none missing)`);
      continue;
    }

    if (existing.size === 0) {
      // Team has no roster block at all — this shouldn't happen once pblaData.ts is set up,
      // but log it clearly so a human knows they need to add the full block with the right key.
      console.log(`SKIP -- no roster block found for '${team.name}' in pblaData.ts; add it manually first`);
      continue;
    }

    const insertionPoint = findRosterInsertionPoint(text, team.name);
    if (insertionPoint === -1) {
      console.log(`SKIP -- could not locate roster block end for '${team.name}'`);
      continue;
    }

    const newLines = missing.map((p) => formatPlayerEntry(p.name, p.jersey)).join('\n');
    const insertion = '\n' + newLines;

    if (isDryRun) {
      console.log(`DRY-RUN -- would add ${missing.length} player(s):`);
      for (const p of missing) console.log(`  + ${p.name} (jersey: '${p.jersey}')`);
    } else {
      text = text.slice(0, insertionPoint) + insertion + text.slice(insertionPoint);
      // Re-parse after each mutation so insertion points remain accurate
      existingRosters.set(
        team.name,
        new Set([...existing, ...missing.map((p) => p.name.toLowerCase().replace(/\s+/g, ' ').trim())]),
      );
      console.log(`PATCHED -- added ${missing.length} player(s):`);
      for (const p of missing) console.log(`  + ${p.name} (jersey: '${p.jersey}')`);
      totalAdded += missing.length;
    }
  }

  if (!isDryRun && totalAdded > 0) {
    writeFileSync(PBLA_DATA_PATH, text, 'utf8');
    console.log(`\nWrote ${totalAdded} new player(s) to pblaData.ts`);
  } else if (isDryRun) {
    console.log('\n(dry-run -- no files written)');
  } else {
    console.log('\nAll rosters up to date -- no changes needed');
  }
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
