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
import {
  currentSeason,
  seasonValueToString,
  SEASON_QUERY_KEY,
} from './components/seasonPicker.js';
import { apiUrl } from './apiBase.js';
import { IS_STATIC, staticFetch } from './staticLoader.js';

export type { GamePeriod, PiaaRecord };

export { currentSeason } from './components/seasonPicker.js';

// Endpoints that must NOT be season-scoped (their response is the source of
// truth for season metadata, or they're global health probes).
const SEASON_EXEMPT = new Set<string>(['/seasons', '/health', '/players']);

function shouldAttachSeason(path: string): boolean {
  const pathname = path.split('?', 1)[0] ?? path;
  for (const exempt of SEASON_EXEMPT) {
    if (pathname === exempt || pathname === `/api${exempt}`) {
      return false;
    }
    if (
      exempt !== '/players' &&
      (pathname.startsWith(`${exempt}/`) || pathname.startsWith(`/api${exempt}/`))
    ) {
      return false;
    }
  }
  return true;
}

/** Append `?season=` to a built URL when a season is selected. */
export function attachSeason(url: string, season = currentSeason()): string {
  if (season === null) return url;
  if (!shouldAttachSeason(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  // If the caller already set season explicitly, leave it alone.
  if (url.includes(`${SEASON_QUERY_KEY}=`)) return url;
  return `${url}${sep}${SEASON_QUERY_KEY}=${encodeURIComponent(seasonValueToString(season))}`;
}

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
  const baseUrl = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  if (IS_STATIC) return staticFetch<T>(baseUrl);
  const url = apiUrl(attachSeason(baseUrl));
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

export interface FreshnessResponse {
  scoreboardLast: string | null;
  recapsLast: string | null;
  rankingsLast: string | null;
  scheduleLast: string | null;
  piaaLast: string | null;
  aliasesLast: string | null;
  laxnumbersLast: string | null;
  lastIngestAt: string | null;
  counts: {
    teams: number;
    games: number;
    players: number;
    scheduleGames: number;
    playerAliases: number;
    piaaTeams: number;
    laxnumbersGames: number;
  };
  generatedAt: string;
}

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

export function getFreshness(): Promise<FreshnessResponse> {
  return request<FreshnessResponse>('/freshness');
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

export interface CalendarDay {
  date: string;
  count: number;
  gameIds?: number[];
}

interface CalendarDayResponse {
  date: string;
  gameCount: number;
}

export async function getGameCalendar(): Promise<CalendarDay[]> {
  const days = await request<CalendarDayResponse[]>('/games/calendar');
  return days.map((day) => ({
    date: day.date,
    count: day.gameCount,
  }));
}

export function getGame(id: string | number): Promise<GameDetailResponse> {
  return request<GameDetailResponse>(`/games/${encodeURIComponent(String(id))}`);
}

export function getPlayer(id: string | number): Promise<PlayerDetailResponse> {
  return request<PlayerDetailResponse>(`/players/${encodeURIComponent(String(id))}`);
}

export interface PlayerListEntry {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
  teamSlug: string;
}

export function getPlayerList(params?: {
  season?: string | null;
  search?: string | null;
  limit?: number;
}): Promise<PlayerListEntry[]> {
  const q: Record<string, string | number> = {};
  if (params?.season) q['season'] = params.season;
  if (params?.search) q['search'] = params.search;
  if (params?.limit !== undefined) q['limit'] = params.limit;
  return request<PlayerListEntry[]>(`/players${buildQuery(q)}`);
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
  derivedRecord?: { wins: number; losses: number; ties: number };
  recordSource?: 'piaa' | 'phillylacrosse';
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
  scoringEvents?: ScoringEvent[];
  scoringEventsHeuristic?: string;
}

export interface ScoringEvent {
  quarter: number;
  sequence: number;
  teamId: number;
  side: 'home' | 'away';
  playerId: number | null;
  playerName: string | null;
  assistPlayerId: number | null;
  assistPlayerName: string | null;
  homeScoreAfter: number;
  awayScoreAfter: number;
  synthesized: true;
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

// ---- W17 L2 (Han) — batch image lookup for post slugs ----

export interface PostImage {
  imageUrl: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export async function getPostImages(slugs: string[]): Promise<Record<string, PostImage>> {
  const cleaned = slugs.filter((s) => !!s);
  if (cleaned.length === 0) return {};
  const qs = encodeURIComponent(cleaned.join(','));
  const res = await request<{ images: Record<string, PostImage> }>(`/posts/images?slugs=${qs}`);
  return res.images;
}

// ---- W16 L2 (Leia) — schedule (upcoming games) ----

export interface ScheduleGame {
  id: number;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamSlug: string | null;
  awayTeamSlug: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  gameDate: string;
  gameTime: string | null;
  location: string | null;
  source: string;
  sourceUrl: string | null;
  season: number;
}

export interface ScheduleByDate {
  date: string;
  games: ScheduleGame[];
}

export interface ScheduleResponse {
  from: string;
  to: string | null;
  season: number | null;
  total: number;
  byDate: ScheduleByDate[];
}

export interface ScheduleQuery {
  season?: number;
  from?: string;
  to?: string;
  team?: number;
  limit?: number;
}

export function getSchedule(params?: ScheduleQuery): Promise<ScheduleResponse> {
  return request<ScheduleResponse>(`/schedule${buildQuery(params)}`);
}

export interface TeamUpcomingResponse {
  teamId: number;
  from: string;
  games: ScheduleGame[];
}

export function getTeamUpcoming(teamId: number | string, limit = 3): Promise<TeamUpcomingResponse> {
  return request<TeamUpcomingResponse>(
    `/schedule/team/${encodeURIComponent(String(teamId))}/upcoming?limit=${limit}`,
  );
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

// ---- Wave H8 L1 (Han) — batch player detail for the compare view ----

export interface ComparePlayersResponse {
  players: PlayerDetail[];
}

export function getComparePlayers(ids: ReadonlyArray<number>): Promise<ComparePlayersResponse> {
  const csv = ids.join(',');
  return request<ComparePlayersResponse>(`/compare/players?ids=${encodeURIComponent(csv)}`);
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
  teamPrimaryColor?: string | null;
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
  primaryColor?: string | null;
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

// Wave H7 L2 (Yoda) — inline sparkline data for the leaders table.
// Mirrors the player leaders endpoint shape but returns per-game series.
export interface LeaderSparklinePlayer {
  player_id: number;
  name: string;
  perGame: number[];
}

export interface LeaderSparklinesResponse {
  metric: string;
  season: number | null;
  players: LeaderSparklinePlayer[];
}

// Allowed metrics on the sparklines endpoint. Snake_case mirrors the
// underlying SQL columns; camelCase variants map to compound stats.
export type LeaderSparklineMetric =
  | 'points'
  | 'goals'
  | 'assists'
  | 'groundBalls'
  | 'causedTurnovers'
  | 'saves'
  | 'faceoffWins';

export function getLeaderSparklines(
  metric: LeaderSparklineMetric,
  limit = 10,
): Promise<LeaderSparklinesResponse> {
  return request<LeaderSparklinesResponse>(
    `/leaders/players/sparklines${buildQuery({ metric, limit })}`,
  );
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

// ---- Seasons (W13 L2 Leia / W14 L2 Han) ----

export interface SeasonsResponse {
  seasons: number[];
  default: number | null;
}

export function getSeasons(): Promise<SeasonsResponse> {
  return request<SeasonsResponse>('/seasons');
}

// ---- Player constellation (W15 L2, R2) ----

export interface ConstellationPlayer {
  id: number;
  name: string;
  teamId: number;
  teamName: string;
  teamColor: string | null;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  goalsPerGame: number;
  assistsPerGame: number;
}

export interface ConstellationResponse {
  season: number | null;
  players: ConstellationPlayer[];
}

export function getConstellation(): Promise<ConstellationResponse> {
  return request<ConstellationResponse>('/players/constellation');
}

export interface CorrectionRecord {
  id: number;
  submitter_first?: string;
  submitter_last?: string;
  submitter_email?: string;
  submitter_name?: string;
  entity_type: string;
  entity_id: number;
  field_name: string;
  old_value: string | null;
  new_value: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'outlier';
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

export function getFlaggedCorrections(): Promise<CorrectionRecord[]> {
  return request<CorrectionRecord[]>('/corrections/flagged');
}

export function getRecentCorrections(): Promise<CorrectionRecord[]> {
  return request<CorrectionRecord[]>('/corrections/recent');
}

// ---- Admin player dedup review (LS-1-C, Chewy) ----

export interface DedupCandidateRow {
  id: number;
  player_a_id: number;
  player_a_name: string;
  player_a_team: string;
  player_a_stats: number;
  player_b_id: number;
  player_b_name: string;
  player_b_team: string;
  player_b_stats: number;
  similarity: number;
  algo: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  reviewer_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export async function getDedupCandidates(
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ candidates: DedupCandidateRow[]; total: number }> {
  const url = apiUrl(`/api/admin/dedup-candidates${buildQuery({ status, limit, offset })}`);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as { candidates: DedupCandidateRow[]; total: number };
}

export async function patchDedupCandidate(
  id: number,
  body: { status: string; reviewer_notes?: string },
): Promise<void> {
  const url = apiUrl(`/api/admin/dedup-candidates/${encodeURIComponent(String(id))}`);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}

export async function mergeDedupCandidate(
  id: number,
): Promise<{ statsRedirected: number; statsDropped: number }> {
  const url = apiUrl(`/api/admin/dedup-candidates/${encodeURIComponent(String(id))}/merge`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  const json = (await res.json()) as { ok: true; statsRedirected: number; statsDropped: number };
  return { statsRedirected: json.statsRedirected, statsDropped: json.statsDropped };
}

// ---- Header search (W H4 L2, Yoda) ----

export interface SearchHit {
  kind: 'player' | 'team';
  id: number;
  name: string;
  teamName?: string;
}

export function searchAll(q: string, limit = 10): Promise<SearchHit[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return Promise.resolve([]);
  return request<SearchHit[]>(
    `/search?q=${encodeURIComponent(trimmed)}&limit=${encodeURIComponent(String(limit))}`,
  );
}
