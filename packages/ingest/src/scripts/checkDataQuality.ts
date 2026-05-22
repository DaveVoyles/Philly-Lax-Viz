#!/usr/bin/env tsx
// checkDataQuality.ts - Post-ingest sanity checks on the SQLite DB.
//
// Emits ::warning:: annotations for GitHub Actions and exits 1 if issues found.
//
// Usage:
//   pnpm --filter @pll/ingest exec tsx src/scripts/checkDataQuality.ts
//   pnpm --filter @pll/ingest exec tsx src/scripts/checkDataQuality.ts --db=data/lacrosse.db
//   pnpm --filter @pll/ingest exec tsx src/scripts/checkDataQuality.ts --year=2026

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';

const __here = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = resolve(__here, '..', '..', '..', '..', 'data', 'lacrosse.db');
  let year = new Date().getFullYear().toString();

  for (const arg of args) {
    if (arg.startsWith('--db=')) dbPath = resolve(arg.slice(5));
    else if (arg.startsWith('--year=')) year = arg.slice(7);
  }

  return { dbPath, year };
}

function warn(msg: string) {
  console.log(`::warning::${msg}`);
}

async function main() {
  const { dbPath, year } = parseArgs();
  console.log(`[checkDataQuality] year=${year} db=${dbPath}`);

  const db = openDb(dbPath);
  let issues = 0;

  // 1. Suspicious scores (> 30)
  const highScores = db.prepare(`
    SELECT g.id, g.date,
           t1.name AS home, g.home_score,
           t2.name AS away, g.away_score
    FROM games g
    JOIN teams t1 ON g.home_team_id = t1.id
    JOIN teams t2 ON g.away_team_id = t2.id
    WHERE (g.home_score > 30 OR g.away_score > 30)
      AND strftime('%Y', g.date) = ?
  `).all(year) as Array<{ id: number; date: string; home: string; home_score: number; away: string; away_score: number }>;

  for (const g of highScores) {
    warn(`Suspicious score: ${g.home} ${g.home_score} vs ${g.away} ${g.away_score} on ${g.date} (game ${g.id})`);
    issues++;
  }
  console.log(`[check] suspicious scores: ${highScores.length}`);

  // 2. Duplicate games (same date + home_team_id + away_team_id)
  const dupes = db.prepare(`
    SELECT g.date, t1.name AS home, t2.name AS away, COUNT(*) AS cnt
    FROM games g
    JOIN teams t1 ON g.home_team_id = t1.id
    JOIN teams t2 ON g.away_team_id = t2.id
    WHERE strftime('%Y', g.date) = ?
    GROUP BY g.date, g.home_team_id, g.away_team_id
    HAVING cnt > 1
  `).all(year) as Array<{ date: string; home: string; away: string; cnt: number }>;

  for (const d of dupes) {
    warn(`Duplicate game: ${d.home} vs ${d.away} on ${d.date} appears ${d.cnt} times`);
    issues++;
  }
  console.log(`[check] duplicate games: ${dupes.length}`);

  // 3. Teams with 0 games this season
  const noGames = db.prepare(`
    SELECT t.name
    FROM teams t
    WHERE NOT EXISTS (
      SELECT 1 FROM games g
      WHERE (g.home_team_id = t.id OR g.away_team_id = t.id)
        AND strftime('%Y', g.date) = ?
    )
    ORDER BY t.name
  `).all(year) as Array<{ name: string }>;

  if (noGames.length > 0) {
    warn(`Teams with 0 games in ${year}: ${noGames.map((t) => t.name).join(', ')}`);
    issues++;
  }
  console.log(`[check] teams with 0 games: ${noGames.length}`);

  // 4. Stale season detection (March through June only)
  const month = new Date().getMonth() + 1; // 1-based
  if (month >= 3 && month <= 6) {
    const row = db.prepare(`
      SELECT MAX(date) AS last_game FROM games WHERE strftime('%Y', date) = ?
    `).get(year) as { last_game: string | null };

    const lastGame = row?.last_game;
    if (!lastGame) {
      warn(`Stale season: no games found for ${year} — site data may be outdated`);
      issues++;
    } else {
      const daysSince = Math.floor((Date.now() - new Date(lastGame).getTime()) / 86_400_000);
      if (daysSince > 7) {
        warn(`Stale season: last ${year} game was ${daysSince} days ago (${lastGame}) — site data may be stale`);
        issues++;
      }
    }
    console.log(`[check] last game: ${lastGame ?? 'none'}`);
  }

  db.close();
  console.log(`[checkDataQuality] done — ${issues} issue(s) found`);
  process.exit(issues > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[checkDataQuality] fatal:', err);
  process.exit(1);
});
