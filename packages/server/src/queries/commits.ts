// commits.ts — server queries for the `commits` table (Wave 15 Lane 3).

import type { Database } from 'better-sqlite3';

export interface CommitRow {
  id: number;
  player_id: number | null;
  player_name_raw: string;
  high_school_team_id: number | null;
  high_school_name: string | null;
  high_school_logo_url: string | null;
  college: string;
  division: string | null;
  announced_date: string | null;
  source_post_id: string | null;
  source_url: string | null;
  created_at: string;
}

export interface CollegeCount {
  college: string;
  commits: number;
}

interface ListOpts {
  /** Filter announced_date to a season (year). null/undefined = no filter. */
  season?: number | null;
  /** Optional college name match (exact, case-insensitive). */
  college?: string;
  /** Cap the number of rows returned. Default 500. */
  limit?: number;
}

export function listCommits(db: Database, opts: ListOpts = {}): CommitRow[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.season !== null && opts.season !== undefined) {
    where.push("substr(c.announced_date, 1, 4) = ?");
    params.push(String(opts.season));
  }
  if (opts.college) {
    where.push('LOWER(c.college) = LOWER(?)');
    params.push(opts.college);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      c.id,
      c.player_id,
      c.player_name_raw,
      c.high_school_team_id,
      t.name      AS high_school_name,
      t.logo_url  AS high_school_logo_url,
      c.college,
      c.division,
      c.announced_date,
      c.source_post_id,
      c.source_url,
      c.created_at
    FROM commits c
    LEFT JOIN teams t ON t.id = c.high_school_team_id
    ${whereSql}
    ORDER BY COALESCE(c.announced_date, c.created_at) DESC, c.id DESC
    LIMIT ${limit}
  `;
  return db.prepare(sql).all(...params) as CommitRow[];
}

export function countCommitsByCollege(
  db: Database,
  opts: { season?: number | null } = {},
): CollegeCount[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.season !== null && opts.season !== undefined) {
    where.push("substr(announced_date, 1, 4) = ?");
    params.push(String(opts.season));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT college, COUNT(*) AS commits
    FROM commits
    ${whereSql}
    GROUP BY college
    ORDER BY commits DESC, college ASC
  `;
  return db.prepare(sql).all(...params) as CollegeCount[];
}

export function getCommitForPlayer(
  db: Database,
  playerId: number,
): CommitRow | null {
  const row = db
    .prepare(
      `SELECT
         c.id, c.player_id, c.player_name_raw, c.high_school_team_id,
         t.name AS high_school_name, t.logo_url AS high_school_logo_url,
         c.college, c.division, c.announced_date,
         c.source_post_id, c.source_url, c.created_at
       FROM commits c
       LEFT JOIN teams t ON t.id = c.high_school_team_id
       WHERE c.player_id = ?
       ORDER BY COALESCE(c.announced_date, c.created_at) DESC
       LIMIT 1`,
    )
    .get(playerId) as CommitRow | undefined;
  return row ?? null;
}
