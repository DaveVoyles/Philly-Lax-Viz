// Wave H7 L2 (Yoda) — sparkline data for the leaders table.
// GET /api/leaders/players/sparklines?metric=goals&limit=10
//
// Returns top-N players for the requested metric along with that player's
// per-game value of that metric, ordered chronologically by game date.
// Whitelisted metric set mirrors the simple-sum metrics from leaders.ts.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { resolveSeason } from '../queries/seasons.js';

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

// Map public metric name -> SQL expression over a player_stats row.
// `points` is the synthetic goals+assists; everything else is a column.
// `faceoffWins` mirrors the player_stats.fo_won column.
const METRIC_SQL: Record<string, string> = {
  points: '(ps.goals + ps.assists)',
  goals: 'ps.goals',
  assists: 'ps.assists',
  groundBalls: 'ps.ground_balls',
  causedTurnovers: 'ps.caused_turnovers',
  saves: 'ps.saves',
  faceoffWins: 'ps.fo_won',
};

export const ALLOWED_SPARKLINE_METRICS = Object.keys(METRIC_SQL);

function parsePosInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  if (t < 0) return null;
  return t;
}

function clampLimit(raw: string | undefined): number {
  const n = parsePosInt(raw);
  if (n === null || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

interface TopRow {
  player_id: number;
  player_name: string;
}

interface PerGameRow {
  player_id: number;
  value: number;
}

export async function leaderSparklinesRoutes(
  app: FastifyInstance,
  db: Database,
): Promise<void> {
  app.get<{
    Querystring: { metric?: string; limit?: string; season?: string };
  }>('/api/leaders/players/sparklines', async (req, reply) => {
    const metricRaw = req.query.metric ?? 'points';
    if (!Object.prototype.hasOwnProperty.call(METRIC_SQL, metricRaw)) {
      reply.code(400);
      return {
        error: `Invalid metric '${metricRaw}'. Allowed: ${ALLOWED_SPARKLINE_METRICS.join(', ')}`,
      };
    }
    const metricExpr = METRIC_SQL[metricRaw]!;
    const limit = clampLimit(req.query.limit);

    let season: number | undefined;
    try {
      const s = resolveSeason(db, req.query.season);
      season = s ?? undefined;
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }

    const seasonFilter = season !== undefined ? 'AND ps.season = @season' : '';

    // Pick the top-N players by SUM(metric). Tiebreak by name.
    const topSql = `
      SELECT p.id   AS player_id,
             p.name AS player_name
      FROM players p
      JOIN player_stats ps ON ps.player_id = p.id
      JOIN games g         ON g.id = ps.game_id
      WHERE g.postponed = 0 ${seasonFilter}
      GROUP BY p.id, p.name
      HAVING SUM(${metricExpr}) > 0
      ORDER BY SUM(${metricExpr}) DESC, p.name COLLATE NOCASE ASC
      LIMIT @limit
    `;
    const topParams: Record<string, number> = { limit };
    if (season !== undefined) topParams.season = season;
    const topRows = db.prepare(topSql).all(topParams) as TopRow[];

    if (topRows.length === 0) {
      return { metric: metricRaw, season: season ?? null, players: [] };
    }

    // Fetch per-game values for those players in one query.
    const ids = topRows.map((r) => r.player_id);
    const placeholders = ids.map((_, i) => `@id${i}`).join(',');
    const perGameSql = `
      SELECT ps.player_id                 AS player_id,
             SUM(${metricExpr})           AS value,
             g.date                       AS game_date,
             g.id                         AS game_id
      FROM player_stats ps
      JOIN games g ON g.id = ps.game_id
      WHERE g.postponed = 0
        AND ps.player_id IN (${placeholders})
        ${seasonFilter}
      GROUP BY ps.player_id, ps.game_id, g.date, g.id
      ORDER BY g.date ASC, g.id ASC
    `;
    const perGameParams: Record<string, number> = {};
    ids.forEach((id, i) => {
      perGameParams[`id${i}`] = id;
    });
    if (season !== undefined) perGameParams.season = season;
    const perGameRows = db
      .prepare(perGameSql)
      .all(perGameParams) as (PerGameRow & { game_date: string; game_id: number })[];

    const byPlayer = new Map<number, number[]>();
    for (const row of perGameRows) {
      const arr = byPlayer.get(row.player_id) ?? [];
      arr.push(Number(row.value) || 0);
      byPlayer.set(row.player_id, arr);
    }

    const players = topRows.map((r) => ({
      player_id: r.player_id,
      name: r.player_name,
      perGame: byPlayer.get(r.player_id) ?? [],
    }));

    return { metric: metricRaw, season: season ?? null, players };
  });
}
