import type { Database } from 'better-sqlite3';

interface RecentGameRow {
  team_id: number;
  date: string;
  outcome: number;
  seq: number;
}

/**
 * Compute current win/loss streak for every team ID in `teamIds`.
 * Returns a Map<teamId, streak> where:
 *   streak > 0 = consecutive wins
 *   streak < 0 = consecutive losses
 *   streak = 0 = last game was a tie
 *   null = no games played
 */
export function computeStreaks(db: Database, teamIds: number[]): Map<number, number | null> {
  if (teamIds.length === 0) return new Map();

  const placeholders = teamIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    WITH team_games AS (
      SELECT
        id AS game_id,
        date,
        home_team_id AS team_id,
        CASE
          WHEN home_score > away_score THEN 1
          WHEN home_score < away_score THEN -1
          ELSE 0
        END AS outcome
      FROM games
      WHERE home_team_id IN (${placeholders})
        AND postponed = 0

      UNION ALL

      SELECT
        id AS game_id,
        date,
        away_team_id AS team_id,
        CASE
          WHEN away_score > home_score THEN 1
          WHEN away_score < home_score THEN -1
          ELSE 0
        END AS outcome
      FROM games
      WHERE away_team_id IN (${placeholders})
        AND postponed = 0
    ),
    ranked AS (
      SELECT
        team_id,
        date,
        outcome,
        ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY date DESC, game_id DESC) AS seq
      FROM team_games
    )
    SELECT team_id, date, outcome, seq
    FROM ranked
    WHERE seq <= 10
    ORDER BY team_id ASC, seq ASC
  `).all(...teamIds, ...teamIds) as RecentGameRow[];

  const byTeam = new Map<number, number[]>();
  for (const row of rows) {
    const outcomes = byTeam.get(row.team_id) ?? [];
    outcomes.push(row.outcome);
    byTeam.set(row.team_id, outcomes);
  }

  const result = new Map<number, number | null>();
  for (const teamId of teamIds) {
    const outcomes = byTeam.get(teamId);
    if (!outcomes || outcomes.length === 0) {
      result.set(teamId, null);
      continue;
    }

    const first = outcomes[0] ?? null;
    if (first === null) {
      result.set(teamId, null);
      continue;
    }
    if (first === 0) {
      result.set(teamId, 0);
      continue;
    }

    let streak = 0;
    for (const outcome of outcomes) {
      if (outcome !== first) break;
      streak += first;
    }
    result.set(teamId, streak);
  }

  return result;
}
