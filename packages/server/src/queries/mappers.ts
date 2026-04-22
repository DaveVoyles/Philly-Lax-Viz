// Row -> domain object mappers. DB columns are snake_case (per migration);
// API responses are camelCase (per shared types).

import type {
  Game,
  GamePeriod,
  IngestAnomaly,
  Player,
  PlayerStat,
  Ranking,
  Team,
} from '@pll/shared';

export interface TeamRow {
  id: number;
  name: string;
  slug: string;
  division: string;
  logo_url: string | null;
  maxpreps_slug: string | null;
  piaa_name_official?: string | null;
  piaa_classification?: string | null;
  piaa_seed?: number | null;
  piaa_wins?: number | null;
  piaa_losses?: number | null;
  piaa_ties?: number | null;
  piaa_total_points?: number | null;
  piaa_ranking?: number | null;
  our_games_count?: number | null;
}

export interface GameRow {
  id: number;
  date: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  ot_periods: number;
  postponed: number;
  source_post_id: string;
  recap_url: string | null;
  parsed_at: string;
}

export interface GamePeriodRow {
  id: number;
  game_id: number;
  team_id: number;
  period_number: number;
  goals: number;
}

export interface PlayerRow {
  id: number;
  name: string;
  name_normalized: string;
  team_id: number;
  name_resolution: string;
}

export interface PlayerStatRow {
  id: number;
  game_id: number;
  player_id: number;
  goals: number;
  assists: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
  fo_won: number;
  fo_taken: number;
  source: string;
  parser_version: string;
  confidence: number;
}

export interface RankingRow {
  id: number;
  week_start: string;
  ranking_source: string;
  team_id: number;
  rank: number;
  source_post_id: string;
  captured_at: string;
}

export interface AnomalyRow {
  id: number;
  source_post_id: string;
  source_url: string;
  raw_line: string;
  parent_game_id: number | null;
  strategy_attempted: string;
  reason: string;
  created_at: string;
}

export function mapTeam(r: TeamRow): Team {
  const hasPiaa =
    r.piaa_name_official != null &&
    r.piaa_classification != null &&
    r.piaa_wins != null &&
    r.piaa_losses != null &&
    r.piaa_ties != null &&
    r.piaa_total_points != null &&
    r.piaa_ranking != null;
  const ourGames = r.our_games_count ?? 0;
  const piaaGames = hasPiaa
    ? (r.piaa_wins as number) + (r.piaa_losses as number) + (r.piaa_ties as number)
    : null;
  const gap = piaaGames === null ? null : piaaGames - ourGames;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    division: r.division as Team['division'],
    logoUrl: r.logo_url ? `/logos/${r.logo_url}` : null,
    piaa: hasPiaa
      ? {
          wins: r.piaa_wins as number,
          losses: r.piaa_losses as number,
          ties: r.piaa_ties as number,
          seed: r.piaa_seed ?? null,
          classification: r.piaa_classification as string,
          ranking: r.piaa_ranking as number,
          totalPoints: r.piaa_total_points as number,
          nameOfficial: r.piaa_name_official as string,
        }
      : null,
    coverage: {
      ourGames,
      piaaGames,
      gap,
    },
  };
}

export function mapGame(r: GameRow): Game {
  return {
    id: r.id,
    date: r.date,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    otPeriods: r.ot_periods,
    postponed: r.postponed === 1,
    sourcePostId: r.source_post_id,
    recapUrl: r.recap_url,
    parsedAt: r.parsed_at,
  };
}

export function mapGamePeriod(r: GamePeriodRow): GamePeriod {
  return {
    id: r.id,
    gameId: r.game_id,
    teamId: r.team_id,
    periodNumber: r.period_number,
    goals: r.goals,
  };
}

export function mapPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    name: r.name,
    nameNormalized: r.name_normalized,
    teamId: r.team_id,
    nameResolution: r.name_resolution as Player['nameResolution'],
  };
}

export function mapPlayerStat(r: PlayerStatRow): PlayerStat {
  return {
    id: r.id,
    gameId: r.game_id,
    playerId: r.player_id,
    goals: r.goals,
    assists: r.assists,
    groundBalls: r.ground_balls,
    causedTurnovers: r.caused_turnovers,
    saves: r.saves,
    foWon: r.fo_won,
    foTaken: r.fo_taken,
    source: r.source as PlayerStat['source'],
    parserVersion: r.parser_version,
    confidence: r.confidence,
  };
}

export function mapRanking(r: RankingRow): Ranking {
  return {
    id: r.id,
    weekStart: r.week_start,
    rankingSource: r.ranking_source as Ranking['rankingSource'],
    teamId: r.team_id,
    rank: r.rank,
    sourcePostId: r.source_post_id,
    capturedAt: r.captured_at,
  };
}

export function mapAnomaly(r: AnomalyRow): IngestAnomaly {
  return {
    id: r.id,
    sourcePostId: r.source_post_id,
    sourceUrl: r.source_url,
    rawLine: r.raw_line,
    parentGameId: r.parent_game_id,
    strategyAttempted: r.strategy_attempted as IngestAnomaly['strategyAttempted'],
    reason: r.reason,
    createdAt: r.created_at,
  };
}
