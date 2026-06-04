// syncPbla.ts — Fetch PBLA league data from Sportability and upsert into SQLite.
//
// Run: pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts
// Options:
//   --league=50731     Override league ID (default: current season)
//   --dry-run          Print parsed data without writing to DB
//   --cookies="..."    Pass session cookies for authenticated access

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '../db.js';
import {
  scrapePblaLeague,
  type SportabilityLeagueData,
  type SportabilityTeam,
  type SportabilityPlayer,
  type SportabilityGoalie,
  type SportabilityGame,
} from '../sources/sportability.js';
import { createLogger } from '@pll/shared';

const log = createLogger({ name: 'ingest:syncPbla' });
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DB_PATH = process.env.DB_PATH ?? process.env.PLL_DB_PATH ?? path.join(REPO_ROOT, 'data', 'lacrosse.db');

// Default league IDs per season — add new entries each season rather than changing the fallback.
const LEAGUE_IDS: Record<number, number> = {
  2025: 50247,
  2026: 50731,
};

function getCurrentLeagueId(): number {
  // Allow explicit override via env var (set in CI or local .env).
  const envId = process.env.PBLA_LEAGUE_ID ? parseInt(process.env.PBLA_LEAGUE_ID, 10) : NaN;
  if (!isNaN(envId) && envId > 0) return envId;

  const year = new Date().getFullYear();
  if (year in LEAGUE_IDS) return LEAGUE_IDS[year] as number;

  // Fall back to the most recently known league ID and warn so operators notice.
  const latestYear = Math.max(...Object.keys(LEAGUE_IDS).map(Number));
  const fallback = LEAGUE_IDS[latestYear]!;
  console.warn(
    `[syncPbla] No league ID configured for year ${year}. ` +
      `Falling back to ${latestYear} ID (${fallback}). ` +
      `Add ${year} to LEAGUE_IDS in syncPbla.ts or set PBLA_LEAGUE_ID env var.`,
  );
  return fallback;
}

function parseArgs(): { leagueId: number; dryRun: boolean; cookies?: string } {
  const args = process.argv.slice(2);
  let leagueId = getCurrentLeagueId();
  let dryRun = false;
  let cookies: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--league=')) {
      leagueId = parseInt(arg.split('=')[1] ?? '', 10) || leagueId;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--cookies=')) {
      cookies = arg.slice('--cookies='.length);
    }
  }

  return { leagueId, dryRun, cookies };
}

function upsertTeams(db: ReturnType<typeof openDb>, leagueId: number, teams: SportabilityTeam[], scrapedAt: string): void {
  const upsert = db.prepare(`
    INSERT INTO pbla_teams (league_id, name, gp, wins, losses, ties, otw, otl, pts, pf, pa, diff, streak, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(league_id, name) DO UPDATE SET
      gp=excluded.gp, wins=excluded.wins, losses=excluded.losses, ties=excluded.ties,
      otw=excluded.otw, otl=excluded.otl, pts=excluded.pts, pf=excluded.pf, pa=excluded.pa,
      diff=excluded.diff, streak=excluded.streak, scraped_at=excluded.scraped_at
  `);
  for (const t of teams) {
    upsert.run(leagueId, t.name, t.gp, t.wins, t.losses, t.ties, t.otw, t.otl, t.pts, t.pf, t.pa, t.diff, t.streak, scrapedAt);
  }
}

function upsertPlayers(db: ReturnType<typeof openDb>, leagueId: number, players: SportabilityPlayer[], scrapedAt: string): void {
  const upsert = db.prepare(`
    INSERT INTO pbla_players (league_id, jersey, name, team, gp, goals, assists, points, penalties, pim, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(league_id, name, team) DO UPDATE SET
      jersey=excluded.jersey, gp=excluded.gp, goals=excluded.goals, assists=excluded.assists,
      points=excluded.points, penalties=excluded.penalties, pim=excluded.pim, scraped_at=excluded.scraped_at
  `);
  for (const p of players) {
    upsert.run(leagueId, p.jersey, p.name, p.team, p.gp, p.goals, p.assists, p.points, p.penalties, p.pim, scrapedAt);
  }
}

function upsertGoalies(db: ReturnType<typeof openDb>, leagueId: number, goalies: SportabilityGoalie[], scrapedAt: string): void {
  const upsert = db.prepare(`
    INSERT INTO pbla_goalies (league_id, jersey, name, team, gp, min, ga, gaa, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(league_id, name, team) DO UPDATE SET
      jersey=excluded.jersey, gp=excluded.gp, min=excluded.min, ga=excluded.ga,
      gaa=excluded.gaa, scraped_at=excluded.scraped_at
  `);
  for (const g of goalies) {
    upsert.run(leagueId, g.jersey, g.name, g.team, g.gp, g.min, g.ga, g.gaa, scrapedAt);
  }
}

function upsertGames(db: ReturnType<typeof openDb>, leagueId: number, games: SportabilityGame[], scrapedAt: string): void {
  const upsert = db.prepare(`
    INSERT INTO pbla_games (league_id, game_num, date, time, home_team, away_team, home_score, away_score, location, is_playoff, note, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(league_id, game_num) DO UPDATE SET
      date=excluded.date, time=excluded.time, home_team=excluded.home_team, away_team=excluded.away_team,
      home_score=excluded.home_score, away_score=excluded.away_score, location=excluded.location,
      is_playoff=excluded.is_playoff, note=excluded.note, scraped_at=excluded.scraped_at
  `);
  for (const g of games) {
    upsert.run(leagueId, g.gameNum, g.date, g.time, g.homeTeam, g.awayTeam, g.homeScore, g.awayScore, g.location, g.isPlayoff ? 1 : 0, g.note, scrapedAt);
  }
}

function logScrapeResult(
  db: ReturnType<typeof openDb>,
  leagueId: number,
  data: SportabilityLeagueData,
  status: string,
  error?: string,
): void {
  db.prepare(`
    INSERT INTO pbla_scrape_log (league_id, scraped_at, teams_count, players_count, goalies_count, games_count, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(leagueId, data.scrapedAt, data.teams.length, data.players.length, data.goalies.length, data.games.length, status, error ?? null);
}

export async function syncPbla(opts: { leagueId: number; dryRun: boolean; cookies?: string; dbPath?: string }): Promise<SportabilityLeagueData | null> {
  const dbPath = opts.dbPath ?? DB_PATH;
  log.info(`[syncPbla] league=${opts.leagueId} dryRun=${opts.dryRun} db=${dbPath}`);

  let data: SportabilityLeagueData;
  try {
    data = await scrapePblaLeague({ leagueId: opts.leagueId, cookies: opts.cookies });
  } catch (err) {
    log.error(`[syncPbla] scrape failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!opts.dryRun) {
      const db = openDb(dbPath);
      db.prepare(`
        INSERT INTO pbla_scrape_log (league_id, scraped_at, teams_count, players_count, goalies_count, games_count, status, error_message)
        VALUES (?, ?, 0, 0, 0, 0, 'error', ?)
      `).run(opts.leagueId, new Date().toISOString(), err instanceof Error ? err.message : String(err));
      db.close();
    }
    return null;
  }

  log.info(`[syncPbla] scraped: ${data.teams.length} teams, ${data.players.length} players, ${data.goalies.length} goalies, ${data.games.length} games`);

  if (opts.dryRun) {
    console.log(JSON.stringify(data, null, 2));
    return data;
  }

  if (data.teams.length === 0 && data.players.length === 0) {
    log.warn('[syncPbla] empty scrape result - may need cookies/session. Logging error.');
    const db = openDb(dbPath);
    logScrapeResult(db, opts.leagueId, data, 'empty', 'No data returned - possible auth issue');
    db.close();
    return data;
  }

  const db = openDb(dbPath);
  const tx = db.transaction(() => {
    upsertTeams(db, opts.leagueId, data.teams, data.scrapedAt);
    upsertPlayers(db, opts.leagueId, data.players, data.scrapedAt);
    upsertGoalies(db, opts.leagueId, data.goalies, data.scrapedAt);
    upsertGames(db, opts.leagueId, data.games, data.scrapedAt);
    logScrapeResult(db, opts.leagueId, data, 'success');
  });
  tx();
  db.close();

  log.info('[syncPbla] done - data written to DB');
  return data;
}

// CLI entrypoint
async function main(): Promise<void> {
  const opts = parseArgs();
  await syncPbla(opts);
}

main().catch((err) => {
  log.error(err, '[syncPbla] fatal error');
  process.exitCode = 1;
});
