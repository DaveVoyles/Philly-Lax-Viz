// Shared domain types for Philly Lacrosse Visualization.
// All ingest, server, and web packages import from here so the data shape is
// the single source of truth across the monorepo.

export type Gender = 'boys' | 'girls';
export type Division = 'high-school' | 'd1' | 'd2' | 'd3' | 'unknown';
export type RankingSource = 'philly' | 'pa-state';
export type ParserStrategy =
  | 'score-line'
  | 'quarter-line'
  | 'player-stat-line'
  | 'aggregated-list'
  | 'ranking-list';
export type StatSource = 'summary' | 'manual';
export type NameResolution = 'full' | 'partial';
export type AliasSource = 'manual' | 'auto';

export interface PiaaRecord {
  wins: number;
  losses: number;
  ties: number;
  seed: number | null;
  classification: string;
  ranking: number;
  totalPoints: number;
  nameOfficial: string;
}

export interface CoverageRecord {
  ourGames: number;
  piaaGames: number | null;
  gap: number | null; // piaaGames - ourGames; null if no PIAA
}

// Derived season W/L/T computed from non-postponed games in our DB.
export interface DerivedRecord {
  wins: number;
  losses: number;
  ties: number;
}

// PIAA cross-validation status. Compares our derivedRecord vs PIAA snapshot.
//   match     -> totalDiff == 0
//   close     -> totalDiff in [1, 2]   (likely missing a non-Philly opponent)
//   divergent -> totalDiff >= 3        (data quality concern)
//   unmapped  -> no PIAA row joined
export type PiaaValidationStatus = 'match' | 'close' | 'divergent' | 'unmapped';

export interface PiaaValidation {
  status: PiaaValidationStatus;
  winDiff: number | null;   // piaaW - derivedW; null when unmapped
  lossDiff: number | null;
  totalDiff: number | null; // |winDiff| + |lossDiff|
  sourceUrl: string;        // public PIAA D1 scores+rankings page
}

export interface Team {
  id: number;
  name: string;
  slug: string;
  division: Division;
  logoUrl: string | null;
  piaa?: PiaaRecord | null;
  coverage?: CoverageRecord;
  derivedRecord?: DerivedRecord;
  piaaValidation?: PiaaValidation;
}

export interface Game {
  id: number;
  date: string; // ISO date (YYYY-MM-DD), local Philadelphia date of game
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  otPeriods: number; // 0 = regulation
  postponed: boolean;
  sourcePostId: string;
  recapUrl: string | null;
  parsedAt: string; // ISO timestamp
}

export interface GamePeriod {
  id: number;
  gameId: number;
  teamId: number;
  periodNumber: number; // 1..N (>4 = OT)
  goals: number;
}

export interface Player {
  id: number;
  name: string;
  nameNormalized: string; // lowercased, accent-stripped, spaces collapsed
  teamId: number;
  nameResolution: NameResolution;
}

export interface PlayerStat {
  id: number;
  gameId: number;
  playerId: number;
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
  source: StatSource;
  parserVersion: string;
  confidence: number; // 0..1
}

export interface TeamAlias {
  id: number;
  alias: string;
  teamId: number;
  source: AliasSource;
  confidence: number;
}

export interface Ranking {
  id: number;
  weekStart: string; // ISO date of the Monday of the ranking week
  rankingSource: RankingSource;
  teamId: number;
  rank: number;
  sourcePostId: string;
  capturedAt: string; // ISO timestamp
}

export interface IngestLog {
  id: number;
  runAt: string;
  feedItemsSeen: number;
  gamesAdded: number;
  summariesParsed: number;
  rankingsParsed: number;
  anomaliesCreated: number;
  durationMs: number;
}

export interface IngestAnomaly {
  id: number;
  sourcePostId: string;
  sourceUrl: string;
  rawLine: string;
  parentGameId: number | null;
  strategyAttempted: ParserStrategy;
  reason: string;
  createdAt: string;
}

export interface RawCacheMeta {
  postId: string;
  url: string;
  fetchedAt: string;
  contentSha256: string;
}

// ===== Parser intermediate types (no DB ids) =====
// Parsers are pure functions that emit these "Parsed*" shapes plus anomalies.
// The pipeline layer is responsible for resolving teams/players to ids and
// upserting into the DB.

export interface ParsedScoreLine {
  teamA: string;
  scoreA: number;
  teamB: string;
  scoreB: number;
  otPeriods: number;
  postponed: boolean;
}

export interface ParsedQuarterLine {
  teamHint: string; // raw team name or abbrev as written
  periods: number[]; // length >= 4
  total: number;
  validates: boolean; // sum(periods) === total
}

export interface ParsedPlayerStat {
  name: string; // as written
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
  isPartialName: boolean; // true when only last name was given
  confidence: number;
}

export interface ParsedRankingEntry {
  rank: number;
  teamName: string;
  weekStart: string;
  rankingSource: RankingSource;
}

export interface ParsedAnomaly {
  rawLine: string;
  strategyAttempted: ParserStrategy;
  reason: string;
}

export interface ParseResult<T> {
  result: T | null;
  anomalies: ParsedAnomaly[];
}

export interface ParseListResult<T> {
  results: T[];
  anomalies: ParsedAnomaly[];
}

// Current parser version. Bump when grammar changes so re-runs can target
// affected rows via player_stats.parser_version.
export const PARSER_VERSION = '0.2.5';

// ===== Leaderboards =====
// Minimal contract shared with the web client. Server-side query rows include
// many more fields (see packages/server/src/queries/leaderboards.ts); this
// interface exposes the cross-package fields that views care about.
export interface Leader {
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  goals: number;
  assists: number;
  points: number;
  // True when a player has scored more than 2 goals across their last 3
  // (non-postponed) games. Optional so older payloads remain valid.
  onFire?: boolean;
}
