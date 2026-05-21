/**
 * parseSportability.ts
 *
 * Parses raw Sportability stats table text (copy-pasted from the browser)
 * and outputs TypeScript array entries for pblaData.ts.
 *
 * Usage:
 *   # Player stats
 *   pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=players < players.txt
 *
 *   # Goalie stats
 *   pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=goalies < goalies.txt
 *
 * Input format (players - tab-separated, pasted from Sportability):
 *   1\t92 - Brian Beatson\tOutlaws\t2\t2\t6\t8\t0\t0\t0
 *
 * Input format (goalies - tab-separated):
 *   1\tBryce Kash\tOutlaws\t2\t60\t8\t6.667
 *
 * Output: TypeScript object literals ready to paste into the players/goalies array.
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const typeArg = args.find(a => a.startsWith('--type='));
const type = typeArg?.split('=')[1] ?? 'players';

const input = readFileSync('/dev/stdin', 'utf-8');
const lines = input.split('\n').filter(l => l.trim().length > 0);

if (type === 'players') {
  parsePlayerStats(lines);
} else if (type === 'goalies') {
  parseGoalieStats(lines);
} else {
  console.error('Usage: --type=players or --type=goalies');
  process.exit(1);
}

function parsePlayerStats(lines: string[]) {
  const entries: string[] = [];

  for (const line of lines) {
    // Split on tabs; fall back to 2+ spaces for pasted text without tabs
    const cols = line.includes('\t')
      ? line.split('\t').map(c => c.trim())
      : line.split(/\s{2,}/).map(c => c.trim());

    if (cols.length < 10) continue;

    // Col 0: rank, Col 1: "jersey - name", Col 2: team, Col 3-9: GP G A Pts Pen PIM Susp
    const rankStr = cols[0]!;
    if (!/^\d+$/.test(rankStr)) continue; // skip headers/footers

    const playerField = cols[1]!; // e.g. "92 - Brian Beatson"
    const jerseyMatch = playerField.match(/^(\d+)\s*-\s*(.+)$/);
    if (!jerseyMatch) continue;

    const jersey = parseInt(jerseyMatch[1]!, 10);
    const name = jerseyMatch[2]!.trim();
    const team = cols[2]!;
    const gp = parseInt(cols[3]!, 10);
    const goals = parseInt(cols[4]!, 10);
    const assists = parseInt(cols[5]!, 10);
    const points = parseInt(cols[6]!, 10);
    const penalties = parseInt(cols[7]!, 10);
    const pim = parseInt(cols[8]!, 10);

    const escapedName = name.replace(/'/g, "\\'");
    entries.push(
      `      { jersey: ${jersey}, name: '${escapedName}', team: '${team}', gp: ${gp}, goals: ${goals}, assists: ${assists}, points: ${points}, penalties: ${penalties}, pim: ${pim} },`
    );
  }

  console.log(`    players: [`);
  for (const e of entries) console.log(e);
  console.log(`    ],`);
  console.log(`\n// Total: ${entries.length} players`);
}

function parseGoalieStats(lines: string[]) {
  const entries: string[] = [];

  for (const line of lines) {
    const cols = line.includes('\t')
      ? line.split('\t').map(c => c.trim())
      : line.split(/\s{2,}/).map(c => c.trim());

    if (cols.length < 7) continue;

    const rankStr = cols[0]!;
    if (!/^\d+$/.test(rankStr)) continue;

    // Col 1 might be "jersey - name" or just "name" depending on the page
    const playerField = cols[1]!;
    const jerseyMatch = playerField.match(/^(\d+)\s*-\s*(.+)$/);

    let jersey = 0;
    let name: string;
    if (jerseyMatch) {
      jersey = parseInt(jerseyMatch[1]!, 10);
      name = jerseyMatch[2]!.trim();
    } else {
      name = playerField.trim();
    }

    const team = cols[2]!;
    const gp = parseInt(cols[3]!, 10);
    const min = parseInt(cols[4]!, 10);
    const ga = parseInt(cols[5]!, 10);
    const gaa = parseFloat(cols[6]!);

    const escapedName = name.replace(/'/g, "\\'");
    entries.push(
      `      { jersey: ${jersey}, name: '${escapedName}', team: '${team}', gp: ${gp}, min: ${min}, ga: ${ga}, gaa: ${parseFloat(gaa.toFixed(2))} },`
    );
  }

  console.log(`    goalies: [`);
  for (const e of entries) console.log(e);
  console.log(`    ],`);
  console.log(`\n// Total: ${entries.length} goalies`);
}
