// Typed fetch wrapper for the Philly Lacrosse API.
// All requests hit /api/* (proxied to Leia's server in dev).

import type {
  Game,
  GamePeriod,
  IngestAnomaly,
  PiaaRecord,
  Player,
  PlayerStat,
  Ranking,
  RankingSource,
  Team,
} from '@pll/shared';

export type { PiaaRecord };

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network error';
    throw new ApiError(`Network error: ${reason}`, 0, url);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      res.status,
      url,
    );
  }
  return (await res.json()) as T;
}

type QueryValue = string | number | undefined;

function buildQuery(params?: Record<string, QueryValue> | object): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, QueryValue>)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// ---- Domain shapes augmenting bare DB rows ----

export interface HealthResponse {
  ok: boolean;
  uptimeMs: number;
  counts: {
    teams: number;
    games: number;
    players: number;
    playerStats: number;
    rankings: number;
    anomalies: number;
  };
  lastIngestAt: string | null;
}

export interface TeamSeasonRecord extends Team {
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface TeamDetailResponse {
  team: Team;
  record: { wins: number; losses: number; goalsFor: number; goalsAgainst: number };
  games: Game[];
  roster: Player[];
}

export interface GameDetailResponse {
  game: Game;
  homeTeam: Team;
  awayTeam: Team;
  playerStats: PlayerStat[];
}

export interface PlayerDetailResponse {
  player: Player;
  team: Team;
  totals: {
    games: number;
    goals: number;
    assists: number;
    groundBalls: number;
    causedTurnovers: number;
    saves: number;
    foWon: number;
    foTaken: number;
  };
  perGame: PlayerStat[];
}

export interface GamesQuery {
  from?: string;
  to?: string;
  team?: string | number;
}

export interface RankingsQuery {
  source?: RankingSource;
  weekStart?: string;
}

// ---- Endpoints ----

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export function getTeams(): Promise<TeamSeasonRecord[]> {
  return request<TeamSeasonRecord[]>('/teams');
}

export function getTeam(id: string | number): Promise<TeamDetailResponse> {
  return request<TeamDetailResponse>(`/teams/${encodeURIComponent(String(id))}`);
}

export function getGames(params?: GamesQuery): Promise<Game[]> {
  return request<Game[]>(`/games${buildQuery(params)}`);
}

export function getGame(id: string | number): Promise<GameDetailResponse> {
  return request<GameDetailResponse>(`/games/${encodeURIComponent(String(id))}`);
}

export function getPlayer(id: string | number): Promise<PlayerDetailResponse> {
  return request<PlayerDetailResponse>(`/players/${encodeURIComponent(String(id))}`);
}

export function getRankings(params?: RankingsQuery): Promise<Ranking[]> {
  return request<Ranking[]>(`/rankings${buildQuery(params)}`);
}

export function getAnomalies(): Promise<IngestAnomaly[]> {
  return request<IngestAnomaly[]>('/anomalies');
}

// Maintainer browser endpoint (W11 L3, Luke). Aggregate response used by
// the /anomalies web page; the legacy list endpoint above is unchanged.
export interface AnomalySummaryResponse {
  totalCount: number;
  byReason: { reason: string; count: number }[];
  topRawLines: {
    rawLine: string;
    reason: string;
    count: number;
    exampleSourceUrl: string | null;
  }[];
}

export function getAnomalySummary(opts?: { limit?: number; reason?: string }): Promise<AnomalySummaryResponse> {
  const params: Record<string, string | number> = {};
  if (opts?.limit !== undefined) params['limit'] = opts.limit;
  if (opts?.reason !== undefined) params['reason'] = opts.reason;
  return request<AnomalySummaryResponse>(`/anomalies/summary${buildQuery(params)}`);
}

// ---- Rivalries graph (W12 L2, Han) ----

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

export interface RivalryGraphResponse {
  nodes: RivalryNode[];
  edges: RivalryEdge[];
}

export function getRivalries(): Promise<RivalryGraphResponse> {
  return request<RivalryGraphResponse>('/rivalries');
}

// ---- PIAA cross-check (Leia, W2 lane 3) ----

export interface PiaaMismatchSummary {
  ourTeamCount: number;
  piaaTeamCount: number;
  matched: number;
  missingInOurDb: number;
  extraInOurDb: number;
  recordMismatches: number;
}

export interface PiaaMismatchResponse {
  fetchedAt: string;
  summary: PiaaMismatchSummary;
  missingInOurDb: { classification: string; nameOfficial: string; ranking: number }[];
  extraInOurDb: { teamId: number; teamName: string; gamesInDb: number }[];
  recordMismatches: {
    teamId: number;
    teamName: string;
    ours: { wins: number; losses: number };
    piaa: { wins: number; losses: number; classification: string };
  }[];
}

export function getPiaaMismatches(): Promise<PiaaMismatchResponse> {
  return request<PiaaMismatchResponse>('/data-quality/piaa-mismatches');
}

// ---- W3L1 (Luke) additive types/helpers matching real server shapes ----
// Han's original TeamDetailResponse / GameDetailResponse / HealthResponse were
// drafted before Leia's server landed and don't match the wire. Added new
// exports below; existing exports left untouched to avoid breaking Han/Darth.

export interface ServerHealthResponse {
  ok: boolean;
  dbRows: {
    teams: number;
    games: number;
    players: number;
    playerStats: number;
    rankings: number;
    anomalies: number;
  };
}

// `PiaaRecord` now lives in @pll/shared (Yoda, Wave 6 Lane 2) and is imported
// at the top of this file. Re-exported there for downstream callers.

// Local mirror of the team coverage record (Yoda, Wave 7 Lane 2). Kept local
// until the shape is published to @pll/shared so the web build doesn't block.
// `gap = piaaGames - ourGames` (null when piaaGames is unknown).
export interface CoverageRecord {
  ourGames: number;
  piaaGames: number | null;
  gap: number | null;
}

export type TeamWithPiaa = Team & {
  piaa?: PiaaRecord | null;
  coverage?: CoverageRecord | null;
};

export interface TeamDetail {
  team: TeamWithPiaa;
  games: Game[];
  record: { wins: number; losses: number; ties: number };
  recentRanking: number | null;
}

export interface GamePlayerStat extends PlayerStat {
  playerName: string;
  teamName: string;
}

export interface GameDetail {
  game: Game;
  periods: GamePeriod[];
  playerStats: GamePlayerStat[];
}

export function getServerHealth(): Promise<ServerHealthResponse> {
  return request<ServerHealthResponse>('/health');
}

export function getTeamDetail(id: string | number): Promise<TeamDetail> {
  return request<TeamDetail>(`/teams/${encodeURIComponent(String(id))}`);
}

export function getGameDetail(id: string | number): Promise<GameDetail> {
  return request<GameDetail>(`/games/${encodeURIComponent(String(id))}`);
}

export function getRecentGames(limit: number): Promise<Game[]> {
  return request<Game[]>(`/games?limit=${encodeURIComponent(String(limit))}`);
}

// ---- W4 (Luke+Han) additive types matching real /api/players and /api/teams/:id/topScorers ----

export interface PlayerSeasonStats {
  games: number;
  goals: number;
  assists: number;
  points: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
}

export interface PlayerPerGameStat extends PlayerStat {
  date: string; // YYYY-MM-DD of the game
}

export interface PlayerDetail {
  player: Player;
  team: Team | null;
  seasonStats: PlayerSeasonStats;
  perGame: PlayerPerGameStat[];
}

export interface TopScorerEntry {
  playerId: number;
  playerName: string;
  goals: number;
  assists: number;
}

export function getPlayerDetail(id: string | number): Promise<PlayerDetail> {
  return request<PlayerDetail>(`/players/${encodeURIComponent(String(id))}`);
}

export function getTeamTopScorers(
  teamId: string | number,
  limit = 5,
): Promise<TopScorerEntry[]> {
  return request<TopScorerEntry[]>(
    `/teams/${encodeURIComponent(String(teamId))}/topScorers?limit=${encodeURIComponent(String(limit))}`,
  );
}

// ---- League Leaders (W?L2 Yoda) — frozen contract from plan ----

export type PlayerLeaderMetric =
  | 'points'
  | 'goals'
  | 'assists'
  | 'ground_balls'
  | 'caused_turnovers'
  | 'saves'
  | 'fo_pct'
  | 'points_per_game';

export type TeamLeaderMetric =
  | 'wins'
  | 'losses'
  | 'win_pct'
  | 'goals_for'
  | 'goals_against'
  | 'goal_diff'
  | 'gpg'
  | 'gapg';

export interface PlayerLeaderRow {
  rank: number;
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  teamLogoUrl: string | null;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
  foPct: number | null;
  value: number;
  onFire?: boolean;
}

export interface PlayerLeadersResponse {
  metric: PlayerLeaderMetric | string;
  minGames: number;
  rows: PlayerLeaderRow[];
}

export interface TeamLeaderRow {
  rank: number;
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winPct: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  gpg: number;
  gapg: number;
  value: number;
}

export interface TeamLeadersResponse {
  metric: TeamLeaderMetric | string;
  rows: TeamLeaderRow[];
}

export interface PlayerLeadersQuery {
  metric?: PlayerLeaderMetric;
  limit?: number;
  minGames?: number;
  minAttempts?: number;
  teamId?: string | number;
}

export interface TeamLeadersQuery {
  metric?: TeamLeaderMetric;
  limit?: number;
}

export function getPlayerLeaders(
  params?: PlayerLeadersQuery,
): Promise<PlayerLeadersResponse> {
  return request<PlayerLeadersResponse>(`/leaders/players${buildQuery(params)}`);
}

export function getTeamLeaders(
  params?: TeamLeadersQuery,
): Promise<TeamLeadersResponse> {
  return request<TeamLeadersResponse>(`/leaders/teams${buildQuery(params)}`);
}

// ---- Head-to-head (W13 L3, R2) ----

export interface H2HTeamSide {
  teamId: number;
  teamName: string;
  teamSlug: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  ties: number;
  goalsFor: number;
  goalsAgainst: number;
  gamesPlayed: number;
}

export interface H2HDirectMeeting {
  gameId: number;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  aResult: 'W' | 'L' | 'T';
}

export interface H2HCommonOpponent {
  opponentId: number;
  opponentName: string;
}

export interface H2HTeamsResponse {
  a: H2HTeamSide | null;
  b: H2HTeamSide | null;
  commonOpponents: H2HCommonOpponent[];
  directMeetings: H2HDirectMeeting[];
}

export interface H2HPlayerSide {
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  goalsPerGame: number | null;
  assistsPerGame: number | null;
  pointsPerGame: number | null;
}

export interface H2HCategoryLead {
  category: string;
  key: string;
  aValue: number;
  bValue: number;
  leader: 'a' | 'b' | 'tie';
  diff: number;
}

export interface H2HPlayersResponse {
  a: H2HPlayerSide | null;
  b: H2HPlayerSide | null;
  aLeads: H2HCategoryLead[];
  bLeads: H2HCategoryLead[];
}

export function getH2HTeams(a: number, b: number): Promise<H2HTeamsResponse> {
  return request<H2HTeamsResponse>(`/h2h/teams?a=${a}&b=${b}`);
}

export function getH2HPlayers(a: number, b: number): Promise<H2HPlayersResponse> {
  return request<H2HPlayersResponse>(`/h2h/players?a=${a}&b=${b}`);
}
