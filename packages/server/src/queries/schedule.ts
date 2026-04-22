// schedule.ts — Wave 16 Lane 2 (Leia). Query helpers for upcoming games
// scraped from external sources (PIAA D1 CSV, etc). Distinct from the
// `games` table (played games from PhillyLacrosse recaps).

import type { Database } from 'better-sqlite3';

export interface ScheduleGameRow {
  id: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamSlug: string | null;
  awayTeamSlug: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  gameDate: string;
  gameTime: string | null;
  location: string | null;
  source: string;
  sourceUrl: string | null;
  season: number;
}

interface RawRow {
  id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  home_team_name_raw: string;
  away_team_name_raw: string;
  home_team_name: string | null;
  away_team_name: string | null;
  home_team_slug: string | null;
  away_team_slug: string | null;
  home_logo_url: string | null;
  away_logo_url: string | null;
  game_date: string;
  game_time: string | null;
  location: string | null;
  source: string;
  source_url: string | null;
  season: number;
}

const SELECT_BASE = `
  SELECT
    s.id,
    s.home_team_id,
    s.away_team_id,
    s.home_team_name_raw,
    s.away_team_name_raw,
    ht.name AS home_team_name,
    at.name AS away_team_name,
    ht.slug AS home_team_slug,
    at.slug AS away_team_slug,
    ht.logo_url AS home_logo_url,
    at.logo_url AS away_logo_url,
    s.game_date,
    s.game_time,
    s.location,
    s.source,
    s.source_url,
    s.season
  FROM schedule_games s
  LEFT JOIN teams ht ON s.home_team_id = ht.id
  LEFT JOIN teams at ON s.away_team_id = at.id
`;

function map(r: RawRow): ScheduleGameRow {
  return {
    id: r.id,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeTeamName: r.home_team_name ?? r.home_team_name_raw,
    awayTeamName: r.away_team_name ?? r.away_team_name_raw,
    homeTeamSlug: r.home_team_slug,
    awayTeamSlug: r.away_team_slug,
    homeLogoUrl: r.home_logo_url ? `/logos/${r.home_logo_url}` : null,
    awayLogoUrl: r.away_logo_url ? `/logos/${r.away_logo_url}` : null,
    gameDate: r.game_date,
    gameTime: r.game_time,
    location: r.location,
    source: r.source,
    sourceUrl: r.source_url,
    season: r.season,
  };
}

export interface ListScheduleOpts {
  season?: number;
  from?: string;
  to?: string;
  teamId?: number;
  limit?: number;
}

export function listScheduleGames(db: Database, opts: ListScheduleOpts): ScheduleGameRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (opts.season !== undefined) {
    where.push('s.season = ?');
    params.push(opts.season);
  }
  if (opts.from !== undefined) {
    where.push('s.game_date >= ?');
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push('s.game_date <= ?');
    params.push(opts.to);
  }
  if (opts.teamId !== undefined) {
    where.push('(s.home_team_id = ? OR s.away_team_id = ?)');
    params.push(opts.teamId, opts.teamId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = opts.limit ?? 500;

  const sql = `${SELECT_BASE} ${whereSql} ORDER BY s.game_date ASC, s.id ASC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit) as RawRow[];
  return rows.map(map);
}

export interface ScheduleByDate {
  date: string;
  games: ScheduleGameRow[];
}

export function groupByDate(rows: ScheduleGameRow[]): ScheduleByDate[] {
  const buckets = new Map<string, ScheduleGameRow[]>();
  for (const r of rows) {
    let arr = buckets.get(r.gameDate);
    if (!arr) {
      arr = [];
      buckets.set(r.gameDate, arr);
    }
    arr.push(r);
  }
  const dates = Array.from(buckets.keys()).sort();
  return dates.map((d) => ({ date: d, games: buckets.get(d)! }));
}

/** Next N upcoming games for a team, on or after `from`. */
export function listUpcomingForTeam(
  db: Database,
  teamId: number,
  from: string,
  limit: number,
): ScheduleGameRow[] {
  const sql = `${SELECT_BASE}
    WHERE (s.home_team_id = ? OR s.away_team_id = ?)
      AND s.game_date >= ?
    ORDER BY s.game_date ASC, s.id ASC
    LIMIT ?`;
  const rows = db.prepare(sql).all(teamId, teamId, from, limit) as RawRow[];
  return rows.map(map);
}
