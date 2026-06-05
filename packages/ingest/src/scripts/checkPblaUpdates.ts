/**
 * checkPblaUpdates.ts
 *
 * Fetches the live PBLA 2026 schedule from Sportability and diffs it against
 * the local snapshot at data/pbla-2026-snapshot.json.
 *
 * Usage:
 *   pnpm pbla:check                   # print diff only
 *   pnpm pbla:check -- --save         # print diff AND overwrite snapshot with live data
 *   pnpm pbla:check -- --generate     # also fetch standings; output ready-to-paste TS snippets for pblaData.ts
 *   pnpm pbla:check -- --verify       # compare snapshot played games against pblaData.ts (no network call)
 *   pnpm pbla:check -- --roster       # fetch live rosters and diff against pblaData.ts; prints missing players
 *
 * Outputs:
 *   - NEW RESULT for any game that had 0-0 in snapshot but now has scores
 *   - SCORE CHANGE for any game where scores changed
 *   - TEAMS CHANGED for any game where home/away teams changed
 *   - "Up to date" when no changes detected
 *
 * Exit codes:
 *   0 - up to date (or --verify passed with no drift)
 *   1 - new results / changes detected (CI uses this to emit a warning)
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  scheduleUrl,
  parseScheduleHtml,
  standingsUrl,
  parseStandingsHtml,
  fetchTeamRoster,
} from '../sources/sportability.js';
import type { SportabilityGame, SportabilityTeam } from '../sources/sportability.js';

const LEAGUE_ID = 50731;
const __here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__here, '../../../..');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'data/pbla-2026-snapshot.json');
const PBLA_DATA_PATH = resolve(REPO_ROOT, 'packages/web/src/views/pblaData.ts');

interface Snapshot {
  leagueId: number;
  year: number;
  snapshotDate: string;
  note: string;
  games: SnapshotGame[];
}

interface SnapshotGame {
  gameNum: number;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  location: string;
  isPlayoff: boolean;
}

function formatGame(g: SnapshotGame | SportabilityGame): string {
  const scored = g.homeScore > 0 || g.awayScore > 0;
  const score = scored ? ` ${g.awayScore}-${g.homeScore}` : '';
  return `${g.awayTeam} at ${g.homeTeam}${score}`;
}

/**
 * --verify: Parse pblaData.ts as text and extract all game scores.
 * Returns a map keyed by "date|homeTeam|awayTeam".
 */
function parsePblaDataGames(): Map<string, { homeScore: number; awayScore: number }> {
  let text: string;
  try {
    text = readFileSync(PBLA_DATA_PATH, 'utf8');
  } catch {
    console.error(`Could not read ${PBLA_DATA_PATH}`);
    return new Map();
  }

  // Match game objects on single or multi-line entries.
  // Captures: date, homeTeam, awayTeam, homeScore, awayScore
  const pattern =
    /date:\s*'([^']+)'[^}]*?homeTeam:\s*'([^']+)'[^}]*?awayTeam:\s*'([^']+)'[^}]*?homeScore:\s*(\d+),\s*awayScore:\s*(\d+)/gs;

  const map = new Map<string, { homeScore: number; awayScore: number }>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const [, date, homeTeam, awayTeam, homeScore, awayScore] = m;
    const key = `${date}|${homeTeam}|${awayTeam}`;
    map.set(key, { homeScore: parseInt(homeScore!, 10), awayScore: parseInt(awayScore!, 10) });
  }
  return map;
}

/**
 * --roster: Parse pblaData.ts and extract all rosters.
 * Returns a map of teamName -> Set of normalized player names.
 */
function parsePblaDataRosters(): Map<string, { players: Array<{ name: string; jersey: string }> }> {
  let text: string;
  try {
    text = readFileSync(PBLA_DATA_PATH, 'utf8');
  } catch {
    console.error(`Could not read ${PBLA_DATA_PATH}`);
    return new Map();
  }

  const result = new Map<string, { players: Array<{ name: string; jersey: string }> }>();

  // Match roster team keys — both quoted ('Beer Wolves': [) and unquoted (Thunder: [)
  // We capture from the rosters: { block to avoid false matches elsewhere in the file
  const rostersBlockMatch = /rosters:\s*\{([\s\S]*?)^\s*\}/m.exec(text);
  const block = rostersBlockMatch ? rostersBlockMatch[1]! : text;

  // Match both 'Quoted Name': [ and UnquotedName: [ as team keys
  const teamKeyPattern = /^\s+(?:'([^']+)'|([A-Za-z]\w*)):\s*\[/gm;
  // Match both single and double quoted name values (double quotes used when name contains apostrophe)
  const playerPattern = /\{\s*name:\s*(?:'([^']+)'|"([^"]+)")[^}]*?jersey:\s*'([^']*)'/g;

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

    const players: Array<{ name: string; jersey: string }> = [];
    playerPattern.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = playerPattern.exec(teamBlock)) !== null) {
      players.push({ name: (pm[1] ?? pm[2])!, jersey: pm[3]! });
    }
    if (players.length > 0) {
      result.set(name, { players });
    }
  }
  return result;
}

/**
 * --roster: Fetch each team's live roster from Sportability, diff against pblaData.ts.
 * Prints missing players and paste-ready TS snippets.
 */
async function runRosterCheck(teams: SportabilityTeam[]): Promise<boolean> {
  console.log('=== ROSTER CHECK: Fetching live rosters from Sportability ===\n');

  const staticRosters = parsePblaDataRosters();
  if (staticRosters.size === 0) {
    console.error('Could not parse any rosters from pblaData.ts');
    return true;
  }

  const UA_HEADERS = {
    'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA roster check',
    Accept: 'text/html,application/xhtml+xml',
  };

  let driftFound = false;

  for (const team of teams) {
    if (!team.id) {
      console.log(`  SKIP  ${team.name} — no team ID from standings`);
      continue;
    }

    process.stdout.write(`Checking ${team.name} (TmID=${team.id})... `);

    let liveRoster;
    try {
      liveRoster = await fetchTeamRoster(LEAGUE_ID, team, {
        fetchFn: (url) =>
          fetch(url, { headers: UA_HEADERS }) as Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
      });
    } catch (err) {
      console.log(`FAILED (${err instanceof Error ? err.message : err})`);
      continue;
    }

    console.log(`${liveRoster.players.length} players`);

    const staticEntry = staticRosters.get(team.name);
    const staticNames = new Set(
      (staticEntry?.players ?? []).map(p => p.name.toLowerCase().replace(/\s+/g, ' ').trim()),
    );
    const liveNames = new Set(liveRoster.players.map(p => p.name.toLowerCase().replace(/\s+/g, ' ').trim()));

    const missingFromStatic = liveRoster.players.filter(
      p => !staticNames.has(p.name.toLowerCase().replace(/\s+/g, ' ').trim()),
    );
    const onlyInStatic = (staticEntry?.players ?? []).filter(
      p => !liveNames.has(p.name.toLowerCase().replace(/\s+/g, ' ').trim()),
    );

    if (missingFromStatic.length === 0 && onlyInStatic.length === 0) {
      console.log(`  OK    ${team.name} — ${liveRoster.players.length} players match\n`);
      continue;
    }

    driftFound = true;

    if (missingFromStatic.length > 0) {
      console.log(`  MISSING from pblaData.ts (${missingFromStatic.length}):`);
      for (const p of missingFromStatic) {
        console.log(`    + ${p.name} (jersey: '${p.jersey}')`);
      }
    }

    if (onlyInStatic.length > 0) {
      console.log(`  ONLY in pblaData.ts / not on Sportability (${onlyInStatic.length}):`);
      for (const p of onlyInStatic) {
        console.log(`    - ${p.name} (jersey: '${p.jersey}')`);
      }
    }

    if (!staticEntry) {
      console.log(`  *** Team '${team.name}' has NO roster block in pblaData.ts at all! ***`);
    }

    // Print paste-ready TS snippet for missing players
    if (missingFromStatic.length > 0) {
      console.log(`\n  Paste into pblaData.ts under '${team.name}':`);
      for (const p of missingFromStatic) {
        const safeName = p.name.replace(/\s+/g, ' ').trim().replace(/'/g, "\\'");
        console.log(
          `        { name: '${safeName}', jersey: '${p.jersey}', position: '', notes: '' },`,
        );
      }
    }
    console.log();
  }

  if (driftFound) {
    console.log('Action needed: update pblaData.ts with the entries above.');
  } else {
    console.log('All team rosters match pblaData.ts — no action needed.');
  }
  return driftFound;
}


function runVerify(snapshot: Snapshot): boolean {
  console.log('=== VERIFY: Checking snapshot vs pblaData.ts ===\n');
  const pblaGames = parsePblaDataGames();
  if (pblaGames.size === 0) {
    console.error('Could not parse any games from pblaData.ts');
    return true;
  }

  const played = snapshot.games.filter(g => g.homeScore > 0 || g.awayScore > 0);
  if (played.length === 0) {
    console.log('No played games in snapshot yet — nothing to verify.');
    return false;
  }

  let driftFound = false;
  for (const snapGame of played) {
    const key = `${snapGame.date}|${snapGame.homeTeam}|${snapGame.awayTeam}`;
    const pblaGame = pblaGames.get(key);
    if (!pblaGame) {
      console.log(
        `  MISSING  Game ${snapGame.gameNum} (${snapGame.date}): ` +
        `${snapGame.awayTeam} at ${snapGame.homeTeam} — not found in pblaData.ts`
      );
      driftFound = true;
    } else if (pblaGame.homeScore !== snapGame.homeScore || pblaGame.awayScore !== snapGame.awayScore) {
      console.log(
        `  DRIFT    Game ${snapGame.gameNum} (${snapGame.date}): ` +
        `${snapGame.awayTeam} at ${snapGame.homeTeam} — ` +
        `snapshot=${snapGame.awayScore}-${snapGame.homeScore}, ` +
        `pblaData.ts=${pblaGame.awayScore}-${pblaGame.homeScore}`
      );
      driftFound = true;
    } else {
      console.log(
        `  OK       Game ${snapGame.gameNum} (${snapGame.date}): ` +
        `${snapGame.awayTeam} ${snapGame.awayScore} at ${snapGame.homeTeam} ${snapGame.homeScore}`
      );
    }
  }

  console.log();
  if (driftFound) {
    console.log('Drift detected — pblaData.ts needs updating for the games marked MISSING or DRIFT above.');
  } else {
    console.log(`All ${played.length} played game(s) match pblaData.ts.`);
  }
  return driftFound;
}

/**
 * --generate: Fetch live standings and print ready-to-paste TS snippets for pblaData.ts.
 * Also prints updated game object lines for any games with new/changed scores.
 */
async function runGenerate(
  changedGames: SnapshotGame[],
  liveGames: SportabilityGame[],
): Promise<void> {
  console.log('\n=== GENERATE: Copy these updates into pblaData.ts ===\n');

  // Game lines
  if (changedGames.length > 0) {
    console.log('--- Updated game entries (paste over existing lines in the games array) ---');
    for (const g of changedGames) {
      const loc = liveGames.find(l => l.gameNum === g.gameNum)?.location ?? g.location;
      const line =
        `      { gameNum: ${g.gameNum}, date: '${g.date}', time: '${g.time}', ` +
        `homeTeam: '${g.homeTeam}', awayTeam: '${g.awayTeam}', ` +
        `homeScore: ${g.homeScore}, awayScore: ${g.awayScore}, ` +
        `location: '${loc}', isPlayoff: ${g.isPlayoff}, note: '' },`;
      console.log(line);
    }
    console.log();
  }

  // Fetch live standings
  console.log('Fetching live standings from Sportability...');
  const sUrl = standingsUrl(LEAGUE_ID);
  const res = await fetch(sUrl, {
    headers: {
      'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA generate',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${sUrl}`);
    return;
  }
  const html = await res.text();
  const teams = parseStandingsHtml(html);
  if (teams.length === 0) {
    console.error('No standings parsed — possible HTML change on Sportability');
    return;
  }

  console.log('\n--- Updated team stats (update matching team objects in the teams array) ---');
  for (const t of teams) {
    console.log(
      `  // ${t.name}: gp=${t.gp}, wins=${t.wins}, losses=${t.losses}, ties=${t.ties}, ` +
      `otw=${t.otw}, otl=${t.otl}, pts=${t.pts}, pf=${t.pf}, pa=${t.pa}, ` +
      `diff=${t.diff}, streak='${t.streak}'`
    );
  }
  console.log('\nNote: color, captain, jerseyImg, and roster fields must be updated manually.');
}

async function main() {
  const save = process.argv.includes('--save');
  const generate = process.argv.includes('--generate');
  const verify = process.argv.includes('--verify');
  const roster = process.argv.includes('--roster');

  // Load local snapshot
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  } catch {
    console.error(`Could not read snapshot at ${SNAPSHOT_PATH}`);
    process.exit(1);
  }

  console.log(`Snapshot: ${snapshot.snapshotDate} (${snapshot.games.length} games)`);

  // --verify mode: compare snapshot against pblaData.ts without fetching live data
  if (verify) {
    const driftFound = runVerify(snapshot);
    process.exit(driftFound ? 1 : 0);
  }

  // --roster mode: fetch live rosters and diff against pblaData.ts
  if (roster) {
    console.log(`Fetching standings to get team IDs (LgID=${LEAGUE_ID})...`);
    const sRes = await fetch(standingsUrl(LEAGUE_ID), {
      headers: {
        'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA roster check',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!sRes.ok) {
      console.error(`Fetch failed: ${sRes.status}`);
      process.exit(1);
    }
    const teams = parseStandingsHtml(await sRes.text());
    if (teams.length === 0) {
      console.error('No teams found in standings — possible HTML change on Sportability');
      process.exit(1);
    }
    const driftFound = await runRosterCheck(teams);
    process.exit(driftFound ? 1 : 0);
  }

  console.log(`Fetching live schedule from Sportability (LgID=${LEAGUE_ID})...`);

  const url = scheduleUrl(LEAGUE_ID);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA update check',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    console.error(`Fetch failed: ${res.status} ${url}`);
    process.exit(1);
  }
  const html = await res.text();
  const liveGames = parseScheduleHtml(html);

  if (liveGames.length === 0) {
    console.error('No games parsed from live page — possible HTML structure change');
    process.exit(1);
  }

  console.log(`Live schedule: ${liveGames.length} games parsed\n`);

  // Index snapshot by gameNum
  const snapByNum = new Map<number, SnapshotGame>(snapshot.games.map(g => [g.gameNum, g]));
  const liveByNum = new Map<number, SportabilityGame>(liveGames.map(g => [g.gameNum, g]));

  const newResults: string[] = [];
  const scoreChanges: string[] = [];
  const teamChanges: string[] = [];
  const newGames: SportabilityGame[] = [];
  // Games that have new or changed scores — used by --generate
  const changedSnapshotGames: SnapshotGame[] = [];

  for (const live of liveGames) {
    const snap = snapByNum.get(live.gameNum);

    if (!snap) {
      newGames.push(live);
      continue;
    }

    const teamsChanged =
      snap.homeTeam !== live.homeTeam || snap.awayTeam !== live.awayTeam;
    const scoreChanged =
      snap.homeScore !== live.homeScore || snap.awayScore !== live.awayScore;
    const wasUnplayed = snap.homeScore === 0 && snap.awayScore === 0;
    const nowHasScore = live.homeScore > 0 || live.awayScore > 0;

    if (teamsChanged) {
      teamChanges.push(
        `  Game ${live.gameNum} (${live.date}): ${formatGame(snap)} -> ${formatGame(live)}`
      );
    } else if (wasUnplayed && nowHasScore) {
      newResults.push(
        `  Game ${live.gameNum} (${live.date}): ${live.awayTeam} ${live.awayScore} at ${live.homeTeam} ${live.homeScore}`
      );
      // Merge live score into snapshot game for --generate output
      changedSnapshotGames.push({ ...snap, homeScore: live.homeScore, awayScore: live.awayScore });
    } else if (scoreChanged) {
      scoreChanges.push(
        `  Game ${live.gameNum} (${live.date}): was ${snap.awayScore}-${snap.homeScore}, now ${live.awayScore}-${live.homeScore} (${live.awayTeam} at ${live.homeTeam})`
      );
      changedSnapshotGames.push({ ...snap, homeScore: live.homeScore, awayScore: live.awayScore });
    }
  }

  // Check for games in snapshot not in live (removed/renumbered)
  const removedGames: SnapshotGame[] = [];
  for (const snap of snapshot.games) {
    if (!liveByNum.has(snap.gameNum)) {
      removedGames.push(snap);
    }
  }

  // Print diff
  let hasChanges = false;

  if (newResults.length > 0) {
    hasChanges = true;
    console.log(`NEW RESULTS (${newResults.length}):`);
    newResults.forEach(l => console.log(l));
    console.log();
  }

  if (scoreChanges.length > 0) {
    hasChanges = true;
    console.log(`SCORE CHANGES (${scoreChanges.length}):`);
    scoreChanges.forEach(l => console.log(l));
    console.log();
  }

  if (teamChanges.length > 0) {
    hasChanges = true;
    console.log(`TEAMS CHANGED (${teamChanges.length}):`);
    teamChanges.forEach(l => console.log(l));
    console.log();
  }

  if (newGames.length > 0) {
    hasChanges = true;
    console.log(`NEW GAMES ON SPORTABILITY (${newGames.length}):`);
    newGames.forEach(g =>
      console.log(`  Game ${g.gameNum} (${g.date}): ${formatGame(g)}`)
    );
    console.log();
  }

  if (removedGames.length > 0) {
    hasChanges = true;
    console.log(`GAMES REMOVED FROM SPORTABILITY (${removedGames.length}):`);
    removedGames.forEach(g =>
      console.log(`  Game ${g.gameNum} (${g.date}): ${formatGame(g)}`)
    );
    console.log();
  }

  if (!hasChanges) {
    console.log('Up to date - no changes detected since last snapshot');
  } else {
    console.log('Action needed: update pblaData.ts with the new results above, then run with --save to update the snapshot.');
  }

  // --generate: fetch standings and output ready-to-paste TS snippets
  if (generate) {
    await runGenerate(changedSnapshotGames, liveGames);
  }

  if (save) {
    // Merge live scores into snapshot structure (preserving isPlayoff from snapshot)
    const mergedGames: SnapshotGame[] = liveGames.map(live => {
      const snap = snapByNum.get(live.gameNum);
      return {
        gameNum: live.gameNum,
        date: live.date,
        time: live.time,
        homeTeam: live.homeTeam,
        awayTeam: live.awayTeam,
        homeScore: live.homeScore,
        awayScore: live.awayScore,
        location: live.location,
        isPlayoff: snap?.isPlayoff ?? live.isPlayoff,
      };
    });

    const updated: Snapshot = {
      ...snapshot,
      snapshotDate: new Date().toISOString().split('T')[0]!,
      games: mergedGames,
    };

    writeFileSync(SNAPSHOT_PATH, JSON.stringify(updated, null, 2) + '\n');
    console.log(`\nSnapshot saved to ${SNAPSHOT_PATH} (date: ${updated.snapshotDate})`);
  }

  // Exit 1 when changes are detected so CI can use this as a warning signal.
  // When --save was requested the save itself is the goal, so exit 0 on success.
  if (hasChanges && !save) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
