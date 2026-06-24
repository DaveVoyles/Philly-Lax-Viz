import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getStatements } from '../queries/statements.js';
import { getPlayerLeaders } from '../queries/leaderboards.js';
import { cacheable } from '../plugins/responseCache.js';
import { computeStreaks } from '../queries/teamStreak.js';
import { mapGame, mapTeam, type GameRow, type TeamRow } from '../queries/mappers.js';
import { resolveSeason } from '../queries/seasons.js';

const RECENT_GAME_DAYS = 7;

function recentWindow(now = Date.now()): { from: string; to: string } {
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - RECENT_GAME_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

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
  const agg = new Map<number, TeamAggregate>();
  for (const row of gameRows) {
    const home = agg.get(row.home_team_id) ?? emptyAggregate();
    home.games += 1;
    home.goalsFor += row.home_score;
    home.goalsAgainst += row.away_score;
    if (!row.postponed) {
      if (row.home_score > row.away_score) home.wins += 1;
      else if (row.home_score < row.away_score) home.losses += 1;
      else home.ties += 1;
    }
    agg.set(row.home_team_id, home);

    const away = agg.get(row.away_team_id) ?? emptyAggregate();
    away.games += 1;
    away.goalsFor += row.away_score;
    away.goalsAgainst += row.home_score;
    if (!row.postponed) {
      if (row.away_score > row.home_score) away.wins += 1;
      else if (row.away_score < row.home_score) away.losses += 1;
      else away.ties += 1;
    }
    agg.set(row.away_team_id, away);
  }
  return agg;
}

export async function dashboardBundleRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: { season?: string } }>('/api/dashboard/bundle', cacheable, async (req, reply) => {
    let season: number | null;
    try {
      season = resolveSeason(db, req.query.season);
    } catch (error) {
      reply.code(400);
      return { error: 'BadRequest', message: (error as Error).message };
    }

    const s = getStatements(db);

    // Teams + win/loss records (mirrors /api/teams logic)
    const teamRows = s.listTeams.all() as TeamRow[];
    const allGameRows = db
      .prepare('SELECT * FROM games WHERE season = ? ORDER BY date DESC, id DESC')
      .all(season) as GameRow[];
    const aggregates = aggregateGames(allGameRows);
    const streaks = computeStreaks(db, teamRows.map((r) => r.id), season);

    const teams = teamRows.map((row) => {
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

    // Recent games (last 7 days)
    const { from, to } = recentWindow();
    const recentGameRows = s.listGamesByRange.all(from, to, 200, 0) as GameRow[];
    const recentGames = recentGameRows.map(mapGame);

    // Top goal scorer for the player hype card
    const leaderRows = getPlayerLeaders(db, {
      metric: 'goals',
      limit: 1,
      minGames: 3,
      minAttempts: 1,
      season: season ?? undefined,
    });
    const top = leaderRows[0] ?? null;
    const topScorer = top
      ? {
          playerId: top.player_id,
          playerName: top.player_name,
          teamId: top.team_id,
          teamName: top.team_name,
          teamLogoUrl: top.team_logo_url ?? null,
          goals: top.goals,
          assists: top.assists,
          value: top.goals,
        }
      : null;

    return { teams, recentGames, topScorer };
  });
}

