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

function error(msg: string) {
  console.log(`::error::${msg}`);
}

async function main() {
  const { dbPath, year } = parseArgs();
  console.log(`[checkDataQuality] year=${year} db=${dbPath}`);

  const db = openDb(dbPath);
  let warnings = 0;
  let errors = 0;

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
    warnings++;
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
    warnings++;
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
    warnings++;
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
      warnings++;
    } else {
      const daysSince = Math.floor((Date.now() - new Date(lastGame).getTime()) / 86_400_000);
      if (daysSince > 7) {
        warn(`Stale season: last ${year} game was ${daysSince} days ago (${lastGame}) — site data may be stale`);
        warnings++;
      }
    }
    console.log(`[check] last game: ${lastGame ?? 'none'}`);
  }

  // 5. Negative scores
  const negScores = db.prepare(`
    SELECT g.id, g.date,
           t1.name AS home, g.home_score,
           t2.name AS away, g.away_score
    FROM games g
    JOIN teams t1 ON g.home_team_id = t1.id
    JOIN teams t2 ON g.away_team_id = t2.id
    WHERE (g.home_score < 0 OR g.away_score < 0)
      AND strftime('%Y', g.date) = ?
  `).all(year) as Array<{ id: number; date: string; home: string; home_score: number; away: string; away_score: number }>;

  for (const g of negScores) {
    error(`Negative score: ${g.home} ${g.home_score} vs ${g.away} ${g.away_score} on ${g.date} (game ${g.id})`);
    errors++;
  }
  console.log(`[check] negative scores: ${negScores.length}`);

  // 6. Games with NULL required fields (date, home_team_id, away_team_id)
  const nullFields = db.prepare(`
    SELECT id FROM games
    WHERE date IS NULL OR home_team_id IS NULL OR away_team_id IS NULL
  `).all() as Array<{ id: number }>;

  for (const g of nullFields) {
    error(`Game ${g.id} has NULL in a required field (date/home_team_id/away_team_id)`);
    errors++;
  }
  console.log(`[check] games with null required fields: ${nullFields.length}`);

  // 7. Duplicate players (same name + team_id)
  const dupePlayers = db.prepare(`
    SELECT name, team_id, COUNT(*) AS cnt
    FROM players
    GROUP BY LOWER(name), team_id
    HAVING cnt > 1
  `).all() as Array<{ name: string; team_id: number; cnt: number }>;

  for (const p of dupePlayers) {
    warn(`Duplicate player: "${p.name}" appears ${p.cnt} times for team_id ${p.team_id}`);
    warnings++;
  }
  console.log(`[check] duplicate players: ${dupePlayers.length}`);

  // 8. Duplicate team aliases (same alias text pointing to multiple teams)
  const dupeAliases = db.prepare(`
    SELECT alias, COUNT(DISTINCT team_id) AS teams
    FROM team_aliases
    GROUP BY LOWER(alias)
    HAVING teams > 1
  `).all() as Array<{ alias: string; teams: number }>;

  for (const a of dupeAliases) {
    warn(`Duplicate team alias: "${a.alias}" maps to ${a.teams} different teams`);
    warnings++;
  }
  console.log(`[check] duplicate team aliases: ${dupeAliases.length}`);

  // 8. Orphaned player stats (stats referencing a non-existent game)
  const orphanStats = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM player_stats ps
    WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = ps.game_id)
  `).get() as { cnt: number };

  if (orphanStats.cnt > 0) {
    error(`Orphaned player_stats: ${orphanStats.cnt} stat row(s) reference game_ids not in the games table`);
    errors++;
  }
  console.log(`[check] orphaned player stats: ${orphanStats.cnt}`);

  // 9. Duplicate player-game stat rows (same player appears twice for the same game)
  const dupeStats = db.prepare(`
    SELECT ps.player_id, p.name AS player_name, ps.game_id, COUNT(*) AS cnt
    FROM player_stats ps
    JOIN players p ON p.id = ps.player_id
    GROUP BY ps.player_id, ps.game_id
    HAVING cnt > 1
    LIMIT 20
  `).all() as Array<{ player_id: number; player_name: string; game_id: number; cnt: number }>;

  for (const d of dupeStats) {
    error(`Duplicate player stat: player "${d.player_name}" (id ${d.player_id}) has ${d.cnt} stat rows for game ${d.game_id}`);
    errors++;
  }
  console.log(`[check] duplicate player-game stat rows: ${dupeStats.length}`);

  // 10. Players with out-of-range jersey numbers
  const badJerseys = db.prepare(`
    SELECT p.id, p.name, p.jersey_number
    FROM players p
    WHERE p.jersey_number IS NOT NULL
      AND (p.jersey_number < 0 OR p.jersey_number > 99)
  `).all() as Array<{ id: number; name: string; jersey_number: number }>;

  for (const p of badJerseys) {
    warn(`Invalid jersey number: player "${p.name}" (id ${p.id}) has jersey_number=${p.jersey_number}`);
    warnings++;
  }
  console.log(`[check] players with invalid jersey numbers: ${badJerseys.length}`);

  db.close();
  console.log(`[checkDataQuality] done — ${errors} error(s) and ${warnings} warning(s) found`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[checkDataQuality] fatal:', err);
  process.exit(1);
});
