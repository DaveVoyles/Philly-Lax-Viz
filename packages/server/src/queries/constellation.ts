// Player constellation — flat list of every player with aggregated season
// stats for the WebGL scatter-plot view (W15 L2, R2). Filters to a season
// when supplied (default = newest). Players with 0 games played are dropped
// so the chart isn't littered with roster-only entries.

import type { Database } from 'better-sqlite3';

export interface ConstellationPlayer {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
  /** No team-color column in the schema yet; always null today. Web view
   *  hashes the team name to a hue when this is null. */
  teamColor: string | null;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  goalsPerGame: number;
  assistsPerGame: number;
}

export interface ConstellationOpts {
  /** Season filter. `undefined` = no filter, `number` = exact match. */
  season?: number;
}

interface Row {
  id: number;
  name: string;
  team_id: number;
  team_name: string;
  games_played: number;
  goals: number;
  assists: number;
}

export function getConstellation(
  db: Database,
  opts: ConstellationOpts = {},
): ConstellationPlayer[] {
  const seasonFilter = opts.season !== undefined ? 'AND ps.season = @season' : '';
  const sql = `
    SELECT p.id                              AS id,
           p.name                            AS name,
           p.team_id                         AS team_id,
           t.name                            AS team_name,
           COUNT(DISTINCT ps.game_id)        AS games_played,
           COALESCE(SUM(ps.goals), 0)        AS goals,
           COALESCE(SUM(ps.assists), 0)      AS assists
      FROM players p
      JOIN teams t        ON t.id = p.team_id
      JOIN player_stats ps ON ps.player_id = p.id
      JOIN games g         ON g.id = ps.game_id AND g.postponed = 0
     WHERE 1=1
       ${seasonFilter}
     GROUP BY p.id, p.name, p.team_id, t.name
     HAVING games_played >= 1
     ORDER BY (goals + assists) DESC, p.name COLLATE NOCASE ASC
  `;
  const params: Record<string, number> = {};
  if (opts.season !== undefined) params.season = opts.season;
  const rows = db.prepare(sql).all(params) as Row[];
  return rows.map((r) => {
    const points = r.goals + r.assists;
    const gpg = r.games_played > 0 ? r.goals / r.games_played : 0;
    const apg = r.games_played > 0 ? r.assists / r.games_played : 0;
    return {
      id: r.id,
      name: r.name,
      teamId: r.team_id,
      teamName: r.team_name,
      teamColor: null,
      gamesPlayed: r.games_played,
      goals: r.goals,
      assists: r.assists,
      points,
      goalsPerGame: Math.round(gpg * 1000) / 1000,
      assistsPerGame: Math.round(apg * 1000) / 1000,
    };
  });
}
