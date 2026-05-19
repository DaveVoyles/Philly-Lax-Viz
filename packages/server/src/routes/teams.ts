import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import { cacheable } from '../plugins/responseCache.js';
import { computeStreaks } from '../queries/teamStreak.js';
import {
  mapGame,
  mapTeam,
  type GameRow,
  type TeamRow,
} from '../queries/mappers.js';
import { resolveSeason } from '../queries/seasons.js';

interface TeamAggregate {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  goalsFor: number;
  goalsAgainst: number;
}

function emptyAggregate(): TeamAggregate {
  return { games: 0, wins: 0, losses: 0, ties: 0, goalsFor: 0, goalsAgainst: 0 };
}

function aggregateGames(gameRows: GameRow[]): Map<number, TeamAggregate> {
  const aggregates = new Map<number, TeamAggregate>();
  for (const row of gameRows) {
    const home = aggregates.get(row.home_team_id) ?? emptyAggregate();
    home.games += 1;
    home.goalsFor += row.home_score;
    home.goalsAgainst += row.away_score;
    if (!row.postponed) {
      if (row.home_score > row.away_score) home.wins += 1;
      else if (row.home_score < row.away_score) home.losses += 1;
      else home.ties += 1;
    }
    aggregates.set(row.home_team_id, home);

    const away = aggregates.get(row.away_team_id) ?? emptyAggregate();
    away.games += 1;
    away.goalsFor += row.away_score;
    away.goalsAgainst += row.home_score;
    if (!row.postponed) {
      if (row.away_score > row.home_score) away.wins += 1;
      else if (row.away_score < row.home_score) away.losses += 1;
      else away.ties += 1;
    }
    aggregates.set(row.away_team_id, away);
  }
  return aggregates;
}

function listGamesForSeason(db: Database, season: number | null): GameRow[] {
  if (season == null) {
    return db.prepare('SELECT * FROM games ORDER BY date DESC, id DESC').all() as GameRow[];
  }
  return db
    .prepare('SELECT * FROM games WHERE season = ? ORDER BY date DESC, id DESC')
    .all(season) as GameRow[];
}

export async function teamsRoutes(app: FastifyInstance, db: Database): Promise<void> {
  const s = getStatements(db);

  app.get<{ Querystring: { season?: string } }>('/api/teams', cacheable, async (req, reply) => {
    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (error) {
      reply.code(400);
      return { error: 'BadRequest', message: (error as Error).message };
    }

    const teamRows = s.listTeams.all() as TeamRow[];
    const gameRows = listGamesForSeason(db, season);
    const aggregates = aggregateGames(gameRows);
    const streaks = computeStreaks(db, teamRows.map((row) => row.id), season);

    return teamRows.map((row) => {
      const aggregate = aggregates.get(row.id) ?? emptyAggregate();
      const team = mapTeam({
        ...row,
        our_games_count: aggregate.games,
        derived_wins: aggregate.wins,
        derived_losses: aggregate.losses,
        derived_ties: aggregate.ties,
      });
      return {
        ...team,
        wins: team.piaa?.wins ?? aggregate.wins,
        losses: team.piaa?.losses ?? aggregate.losses,
        goalsFor: aggregate.goalsFor,
        goalsAgainst: aggregate.goalsAgainst,
        streak: streaks.get(team.id) ?? null,
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/teams/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { error: 'BadRequest', message: 'id must be a positive integer' };
    }
    const teamRow = s.getTeamById.get(id) as TeamRow | undefined;
    if (!teamRow) {
      reply.code(404);
      return { error: 'NotFound', message: `Team ${id} not found` };
    }
    const team = mapTeam(teamRow);

    const gameRows = s.gamesForTeam.all(id, id) as GameRow[];
    const games = gameRows.map(mapGame);

    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const g of games) {
      if (g.postponed) continue;
      const isHome = g.homeTeamId === id;
      const myScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      if (myScore > oppScore) wins += 1;
      else if (myScore < oppScore) losses += 1;
      else ties += 1;
    }

    const rankRow = s.latestRankingForTeam.get(id) as { rank: number } | undefined;

    const derivedRecord = { wins, losses, ties };
    const record = team.piaa
      ? { wins: team.piaa.wins, losses: team.piaa.losses, ties: team.piaa.ties }
      : derivedRecord;

    return {
      team,
      games,
      record,
      derivedRecord,
      recordSource: team.piaa ? 'piaa' : 'phillylacrosse',
      recentRanking: rankRow?.rank ?? null,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/teams/:id/topScorers',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400);
        return { error: 'BadRequest', message: 'id must be a positive integer' };
      }
      const teamRow = s.getTeamById.get(id) as TeamRow | undefined;
      if (!teamRow) {
        reply.code(404);
        return { error: 'NotFound', message: `Team ${id} not found` };
      }
      const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : 5;
      const limit = Number.isFinite(rawLimit)
        ? Math.min(50, Math.max(1, Math.trunc(rawLimit)))
        : 5;

      const rows = s.topScorersForTeam.all(id, limit) as Array<{
        player_id: number;
        player_name: string;
        goals: number;
        assists: number;
      }>;
      return rows.map((r) => ({
        playerId: r.player_id,
        playerName: r.player_name,
        goals: r.goals,
        assists: r.assists,
      }));
    },
  );
}
