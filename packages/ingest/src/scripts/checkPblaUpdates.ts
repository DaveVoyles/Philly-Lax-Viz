/**
 * checkPblaUpdates.ts
 *
 * Fetches the live PBLA 2026 schedule from Sportability and diffs it against
 * the local snapshot at data/pbla-2026-snapshot.json.
 *
 * Usage:
 *   pnpm pbla:check              # print diff only
 *   pnpm pbla:check -- --save    # print diff AND overwrite snapshot with live data
 *
 * Outputs:
 *   - NEW RESULT for any game that had 0-0 in snapshot but now has scores
 *   - SCORE CHANGE for any game where scores changed
 *   - TEAMS CHANGED for any game where home/away teams changed
 *   - "Up to date" when no changes detected
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { scheduleUrl, parseScheduleHtml } from '../sources/sportability.js';
import type { SportabilityGame } from '../sources/sportability.js';

const LEAGUE_ID = 50731;
const SNAPSHOT_PATH = resolve(process.cwd(), 'data/pbla-2026-snapshot.json');

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

async function main() {
  const save = process.argv.includes('--save');

  // Load local snapshot
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  } catch {
    console.error(`Could not read snapshot at ${SNAPSHOT_PATH}`);
    process.exit(1);
  }

  console.log(`Snapshot: ${snapshot.snapshotDate} (${snapshot.games.length} games)`);
  console.log(`Fetching live schedule from Sportability (LgID=${LEAGUE_ID})...`);

  const url = scheduleUrl(LEAGUE_ID);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA update check',
      'Accept': 'text/html,application/xhtml+xml',
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

  for (const live of liveGames) {
    const snap = snapByNum.get(live.gameNum);

    if (!snap) {
      // Game exists on Sportability but not in snapshot
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
    } else if (scoreChanged) {
      scoreChanges.push(
        `  Game ${live.gameNum} (${live.date}): was ${snap.awayScore}-${snap.homeScore}, now ${live.awayScore}-${live.homeScore} (${live.awayTeam} at ${live.homeTeam})`
      );
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
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
