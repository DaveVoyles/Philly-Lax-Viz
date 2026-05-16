import type { Database } from 'better-sqlite3';

export interface PlayerListRow {
  id: number;
  name: string;
  team_id: number;
  team_name: string;
  team_slug: string;
}

export function listPlayersBySeason(
  db: Database,
  season: string | null,
  search: string | null,
  limit: number,
): PlayerListRow[] {
  const sql = `
    SELECT DISTINCT
      p.id,
      p.name,
      p.team_id,
      t.name AS team_name,
      t.slug AS team_slug
    FROM players p
    JOIN teams t ON t.id = p.team_id
    LEFT JOIN player_stats ps ON ps.player_id = p.id
    LEFT JOIN games g ON g.id = ps.game_id
    WHERE (? IS NULL OR SUBSTR(g.date, 1, 4) = ?)
      AND (? IS NULL OR p.name LIKE ? COLLATE NOCASE)
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
    LIMIT ?
  `;

  const searchPattern = search ? `%${search}%` : null;
  return db.prepare(sql).all(season, season, searchPattern, searchPattern, limit) as PlayerListRow[];
}
