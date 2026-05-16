import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import {
  mapGame,
  mapGamePeriod,
  mapPlayerStat,
  mapTeam,
  type GameRow,
  type GamePeriodRow,
  type PlayerStatRow,
  type TeamRow,
} from '../queries/mappers.js';
import { synthesizeScoringEvents } from '../queries/games.js';
import { getImageForSlug } from '../queries/postImages.js';

interface ListQuery {
  date?: string;
  team_id?: string;
  team?: string;
  season?: string;
  limit?: string;
  offset?: string;
}

interface CalendarDayRow {
  date: string;
  game_count: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function getGameCalendar(db: Database, season: string | null): CalendarDayRow[] {
  const sql = season
    ? `SELECT date, COUNT(*) AS game_count
       FROM games
       WHERE postponed = 0 AND SUBSTR(date, 1, 4) = ?
       GROUP BY date
       ORDER BY date ASC`
    : `SELECT date, COUNT(*) AS game_count
       FROM games
       WHERE postponed = 0
       GROUP BY date
       ORDER BY date ASC`;
  const rows = season
    ? db.prepare(sql).all(season)
    : db.prepare(sql).all();
  return rows as CalendarDayRow[];
}

export async function gamesRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get<{ Querystring: ListQuery }>('/api/games', async (req, reply) => {
    const { date } = req.query;

    let limit = 50;
    if (req.query.limit !== undefined) {
      const n = Number(req.query.limit);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'limit must be a positive integer' };
      }
      limit = Math.min(n, 200);
    }

    let offset = 0;
    if (req.query.offset !== undefined) {
      const n = Number(req.query.offset);
      if (!Number.isInteger(n) || n < 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'offset must be a non-negative integer' };
      }
      offset = n;
    }

    if (date !== undefined && !ISO_DATE.test(date)) {
      reply.code(400);
      return { error: 'BadRequest', message: 'date must be YYYY-MM-DD' };
    }

    let teamId: number | undefined;
    // `team` is the W14 alias preferred by the new game-scrubber view; the
    // original `team_id` query param remains supported for back-compat.
    const teamRaw = req.query.team_id ?? req.query.team;
    if (teamRaw !== undefined) {
      const n = Number(teamRaw);
      if (!Number.isInteger(n) || n <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'team must be a positive integer' };
      }
      teamId = n;
    }

    let season: number | undefined;
    if (req.query.season !== undefined) {
      const n = Number(req.query.season);
      if (!Number.isInteger(n) || n < 1900 || n > 3000) {
        reply.code(400);
        return { error: 'BadRequest', message: 'season must be a 4-digit year' };
      }
      season = n;
    }

    let rows: GameRow[];
    if (date && teamId !== undefined) {
      rows = s.listGamesByDateAndTeam.all(date, teamId, teamId, limit, offset) as GameRow[];
    } else if (date) {
      rows = s.listGamesByDate.all(date, limit, offset) as GameRow[];
    } else if (teamId !== undefined) {
      rows = s.listGamesByTeam.all(teamId, teamId, limit, offset) as GameRow[];
    } else {
      rows = s.listGames.all(limit, offset) as GameRow[];
    }

    if (season !== undefined) {
      rows = rows.filter((r) => (r as GameRow & { season?: number }).season === season);
    }

    return rows.map(mapGame);
  });

  app.get<{ Querystring: { season?: string } }>('/api/games/calendar', async (req) => {
    const season = req.query.season?.trim() ?? null;
    return getGameCalendar(db, season).map((row) => ({
      date: row.date,
      gameCount: row.game_count,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const gameRow = s.getGameById.get(id) as GameRow | undefined;
    if (!gameRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Game ${id} not found` };
    }

    const periods = (s.periodsForGame.all(id) as GamePeriodRow[]).map(mapGamePeriod);

    const homeTeamRow = s.getTeamById.get(gameRow.home_team_id) as TeamRow | undefined;
    const awayTeamRow = s.getTeamById.get(gameRow.away_team_id) as TeamRow | undefined;

    type StatJoinRow = PlayerStatRow & { player_name: string; team_name: string };
    const statRows = s.playerStatsForGame.all(id) as StatJoinRow[];
    const playerStats = statRows.map((r) => ({
      ...mapPlayerStat(r),
      playerName: r.player_name,
      teamName: r.team_name,
    }));

    // Wave 14 Lane 3 (Leia) — synthesize a per-goal event sequence so the
    // game-scrubber view has something to render. We don't have real
    // timestamps; see queries/games.ts for the heuristic.
    const playerTeamIdByPlayerId = new Map<number, number>();
    for (const r of statRows) {
      // statRows have ps.player_id; their player belongs to home or away.
      // Cheapest lookup: re-derive from the existing roster query already
      // joined on team. We re-query players to get team_id, but to avoid a
      // new prepared statement we just probe the in-memory homeTeam/awayTeam
      // by checking the row's joined team_name.
      if (r.team_name === homeTeamRow?.name) playerTeamIdByPlayerId.set(r.player_id, gameRow.home_team_id);
      else if (r.team_name === awayTeamRow?.name) playerTeamIdByPlayerId.set(r.player_id, gameRow.away_team_id);
    }
    const playersForSynth = playerStats.map((ps) => ({
      ...ps,
      teamId: playerTeamIdByPlayerId.get(ps.playerId) ?? -1,
    }));
    const scoringEvents = synthesizeScoringEvents(
      periods,
      playersForSynth,
      gameRow.home_team_id,
      gameRow.away_team_id,
    );

    // Wave 17 Lane 2 (Han) -- attach featured image URL if we have one for
    // this post slug. Single-row lookup; no additional joins on the hot path.
    const imgRow = gameRow.source_post_id
      ? getImageForSlug(db, gameRow.source_post_id)
      : null;
    const game = mapGame(gameRow);
    game.imageUrl = imgRow?.image_url ?? null;

    return {
      game,
      homeTeam: homeTeamRow ? mapTeam(homeTeamRow) : null,
      awayTeam: awayTeamRow ? mapTeam(awayTeamRow) : null,
      periods,
      playerStats,
      scoringEvents,
      scoringEventsHeuristic:
        'Made from team scores by quarter (game_periods) and per-game player goal/assist totals (player_stats); no per-goal timestamps in source.',
    };
  });
}
