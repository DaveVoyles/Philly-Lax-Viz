// Aggregate query for /api/rivalries (W12 L2, Han).
// Builds the node + edge dataset for the WebGL rivalry network graph.
//
// - Nodes: every team surfaced by the same "ghost-team" filter the dashboard
//   uses (≥1 game OR ≥1 player OR mapped to a PIAA program).
// - Edges: one row per unordered team pair with at least one completed game
//   (postponed = 0 AND both scores present). Aggregates count + summed margin.

import type { Database } from 'better-sqlite3';

export interface RivalryNode {
  id: number;
  name: string;
  wins: number;
  losses: number;
  games: number;
  logo: string | null;
}

export interface RivalryEdge {
  source: number;
  target: number;
  games: number;
  totalMarginSum: number;
  avgMargin: number;
}

export interface RivalryGraph {
  nodes: RivalryNode[];
  edges: RivalryEdge[];
}

interface NodeRow {
  id: number;
  name: string;
  wins: number;
  losses: number;
  games: number;
  logo_url: string | null;
}

interface EdgeRow {
  source: number;
  target: number;
  games: number;
  total_margin_sum: number;
}

export function getRivalryGraph(db: Database): RivalryGraph {
  // Same surface filter as listTeams (statements.ts): hide pure parser ghosts.
  const nodeRows = db
    .prepare(
      `SELECT t.id,
              t.name,
              t.logo_url AS logo_url,
              (SELECT COUNT(*) FROM games g
                 WHERE (g.home_team_id = t.id OR g.away_team_id = t.id)
                   AND g.postponed = 0
                   AND g.home_score IS NOT NULL
                   AND g.away_score IS NOT NULL) AS games,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0
                       AND g.home_score IS NOT NULL
                       AND g.away_score IS NOT NULL
                       AND ((g.home_team_id = t.id AND g.home_score > g.away_score)
                         OR (g.away_team_id = t.id AND g.away_score > g.home_score))
                  THEN 1 ELSE 0 END), 0)
                 FROM games g
                 WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS wins,
              (SELECT COALESCE(SUM(CASE
                  WHEN g.postponed = 0
                       AND g.home_score IS NOT NULL
                       AND g.away_score IS NOT NULL
                       AND ((g.home_team_id = t.id AND g.home_score < g.away_score)
                         OR (g.away_team_id = t.id AND g.away_score < g.home_score))
                  THEN 1 ELSE 0 END), 0)
                 FROM games g
                 WHERE g.home_team_id = t.id OR g.away_team_id = t.id) AS losses
         FROM teams t
         LEFT JOIN piaa_official_teams p
           ON p.name_normalized = LOWER(t.name)
           OR p.name_normalized IN (SELECT alias FROM team_aliases WHERE team_id = t.id)
         WHERE
           (SELECT COUNT(*) FROM games
              WHERE home_team_id = t.id OR away_team_id = t.id) > 0
           OR EXISTS (SELECT 1 FROM players WHERE team_id = t.id)
           OR p.id IS NOT NULL
         ORDER BY games DESC, t.name COLLATE NOCASE ASC`,
    )
    .all() as NodeRow[];

  const edgeRows = db
    .prepare(
      `SELECT MIN(home_team_id, away_team_id) AS source,
              MAX(home_team_id, away_team_id) AS target,
              COUNT(*) AS games,
              SUM(ABS(home_score - away_score)) AS total_margin_sum
         FROM games
         WHERE postponed = 0
           AND home_score IS NOT NULL
           AND away_score IS NOT NULL
           AND home_team_id IS NOT NULL
           AND away_team_id IS NOT NULL
           AND home_team_id <> away_team_id
         GROUP BY source, target
         ORDER BY games DESC, source ASC, target ASC`,
    )
    .all() as EdgeRow[];

  // Drop edges that reference a node we filtered out (ghost teams).
  const nodeIds = new Set(nodeRows.map((n) => n.id));

  const nodes: RivalryNode[] = nodeRows
    .filter((n) => n.games > 0)
    .map((n) => ({
      id: n.id,
      name: n.name,
      wins: n.wins,
      losses: n.losses,
      games: n.games,
      logo: n.logo_url,
    }));

  const surfacedIds = new Set(nodes.map((n) => n.id));

  const edges: RivalryEdge[] = edgeRows
    .filter((e) => surfacedIds.has(e.source) && surfacedIds.has(e.target) && nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      games: e.games,
      totalMarginSum: e.total_margin_sum,
      avgMargin: e.games > 0 ? e.total_margin_sum / e.games : 0,
    }));

  return { nodes, edges };
}
