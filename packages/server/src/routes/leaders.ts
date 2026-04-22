import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  PLAYER_METRICS,
  TEAM_METRICS,
  getPlayerLeaders,
  getTeamLeaders,
  type PlayerMetric,
  type TeamMetric,
} from '../queries/leaderboards.js';
import { resolveSeason } from '../queries/seasons.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const DEFAULT_MIN_GAMES = 1;
const DEFAULT_MIN_GAMES_PPG = 2;
// Goalies / GB-heavy long-poles: require a small sample so the leaderboard
// isn't dominated by a single hot game. Used when caller doesn't override.
const DEFAULT_MIN_GAMES_SAVES = 3;
const DEFAULT_MIN_GAMES_GROUND_BALLS = 3;
// Faceoff %: noisy on small samples; default to 20 attempts to suppress
// 1-game wonders. Caller can lower via ?minAttempts=N.
const DEFAULT_MIN_ATTEMPTS = 20;

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

function round2(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 100) / 100;
}

export async function leadersRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{
    Querystring: {
      metric?: string;
      limit?: string;
      minGames?: string;
      minAttempts?: string;
      teamId?: string;
      season?: string;
    };
  }>('/api/leaders/players', async (req, reply) => {
    const metricRaw = req.query.metric ?? 'points';
    if (!(PLAYER_METRICS as readonly string[]).includes(metricRaw)) {
      reply.code(400);
      return {
        error: `Invalid metric '${metricRaw}'. Allowed: ${PLAYER_METRICS.join(', ')}`,
      };
    }
    const metric = metricRaw as PlayerMetric;

    const limit = clampLimit(req.query.limit);

    const minGamesParsed = parsePosInt(req.query.minGames);
    const minGames =
      minGamesParsed !== null
        ? Math.max(1, minGamesParsed)
        : metric === 'points_per_game'
          ? DEFAULT_MIN_GAMES_PPG
          : metric === 'saves'
            ? DEFAULT_MIN_GAMES_SAVES
            : metric === 'ground_balls'
              ? DEFAULT_MIN_GAMES_GROUND_BALLS
              : DEFAULT_MIN_GAMES;

    const minAttemptsParsed = parsePosInt(req.query.minAttempts);
    const minAttempts =
      minAttemptsParsed !== null ? Math.max(1, minAttemptsParsed) : DEFAULT_MIN_ATTEMPTS;

    const teamIdParsed = parsePosInt(req.query.teamId);
    const teamId = teamIdParsed !== null && teamIdParsed > 0 ? teamIdParsed : undefined;

    let season: number | undefined;
    try {
      const s = resolveSeason(db, req.query.season);
      season = s ?? undefined;
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }

    const rows = getPlayerLeaders(db, { metric, limit, minGames, minAttempts, teamId, season });

    const shaped = rows.map((r, idx) => {
      const ppg = r.points_per_game === null ? null : round2(r.points_per_game);
      const foPct = r.fo_pct === null ? null : round2(r.fo_pct);
      let value: number | null;
      switch (metric) {
        case 'points':            value = r.points; break;
        case 'goals':             value = r.goals; break;
        case 'assists':           value = r.assists; break;
        case 'ground_balls':      value = r.ground_balls; break;
        case 'caused_turnovers':  value = r.caused_turnovers; break;
        case 'saves':             value = r.saves; break;
        case 'fo_pct':            value = foPct; break;
        case 'points_per_game':   value = ppg; break;
      }
      return {
        rank: idx + 1,
        playerId: r.player_id,
        playerName: r.player_name,
        teamId: r.team_id,
        teamName: r.team_name,
        teamLogoUrl: r.team_logo_url ? `/logos/${r.team_logo_url}` : null,
        gamesPlayed: r.games_played,
        goals: r.goals,
        assists: r.assists,
        points: r.points,
        groundBalls: r.ground_balls,
        causedTurnovers: r.caused_turnovers,
        saves: r.saves,
        foWon: r.fo_won,
        foTaken: r.fo_taken,
        foPct: foPct,
        pointsPerGame: ppg,
        onFire: r.on_fire === 1,
        value,
      };
    });

    return { metric, minGames, season: season ?? null, rows: shaped };
  });

  app.get<{
    Querystring: { metric?: string; limit?: string; season?: string };
  }>('/api/leaders/teams', async (req, reply) => {
    const metricRaw = req.query.metric ?? 'wins';
    if (!(TEAM_METRICS as readonly string[]).includes(metricRaw)) {
      reply.code(400);
      return {
        error: `Invalid metric '${metricRaw}'. Allowed: ${TEAM_METRICS.join(', ')}`,
      };
    }
    const metric = metricRaw as TeamMetric;
    const limit = clampLimit(req.query.limit);

    let season: number | undefined;
    try {
      const s = resolveSeason(db, req.query.season);
      season = s ?? undefined;
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message };
    }

    const rows = getTeamLeaders(db, { metric, limit, season });

    const shaped = rows.map((r, idx) => {
      const goalDiff = r.goals_for - r.goals_against;
      const winPct =
        r.wins + r.losses > 0 ? round2(r.wins / (r.wins + r.losses)) : null;
      const gpg = r.games_played > 0 ? round2(r.goals_for / r.games_played) : null;
      const gapg = r.games_played > 0 ? round2(r.goals_against / r.games_played) : null;
      let value: number | null;
      switch (metric) {
        case 'wins':           value = r.wins; break;
        case 'losses':         value = r.losses; break;
        case 'win_pct':        value = winPct; break;
        case 'goals_for':      value = r.goals_for; break;
        case 'goals_against':  value = r.goals_against; break;
        case 'goal_diff':      value = goalDiff; break;
        case 'gpg':            value = gpg; break;
        case 'gapg':           value = gapg; break;
      }
      return {
        rank: idx + 1,
        teamId: r.team_id,
        teamName: r.team_name,
        logoUrl: r.team_logo_url ? `/logos/${r.team_logo_url}` : null,
        gamesPlayed: r.games_played,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        winPct,
        goalsFor: r.goals_for,
        goalsAgainst: r.goals_against,
        goalDiff,
        gpg,
        gapg,
        value,
      };
    });

    return { metric, season: season ?? null, rows: shaped };
  });
}
