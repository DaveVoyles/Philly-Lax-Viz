// Head-to-head comparator queries (W13 L3, R2).
// Two flavors: team-vs-team and player-vs-player.

import type { Database } from 'better-sqlite3';

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
  // Result from team A's perspective: 'W' | 'L' | 'T'.
  aResult: 'W' | 'L' | 'T';
}

export interface H2HCommonOpponent {
  opponentId: number;
  opponentName: string;
}

export interface H2HTeamsResult {
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
  category: string; // human label
  key: string; // machine key
  aValue: number;
  bValue: number;
  leader: 'a' | 'b' | 'tie';
  diff: number; // |aValue - bValue|
}

export interface H2HPlayersResult {
  a: H2HPlayerSide | null;
  b: H2HPlayerSide | null;
  // Top 3 categories where A leads B (sorted by diff desc).
  aLeads: H2HCategoryLead[];
  // Top 3 categories where B leads A (sorted by diff desc).
  bLeads: H2HCategoryLead[];
}

interface TeamSummaryRow {
  team_id: number;
  team_name: string;
  team_slug: string;
  logo_url: string | null;
  wins: number;
  losses: number;
  ties: number;
  goals_for: number;
  goals_against: number;
  games_played: number;
}

const TEAM_SUMMARY_SQL = `
  WITH team_games AS (
    SELECT home_team_id AS team_id,
           home_score   AS goals_for,
           away_score   AS goals_against,
           postponed    AS postponed
    FROM games
    WHERE home_team_id = @teamId OR away_team_id = @teamId
    UNION ALL
    SELECT away_team_id AS team_id,
           away_score   AS goals_for,
           home_score   AS goals_against,
           postponed    AS postponed
    FROM games
    WHERE home_team_id = @teamId OR away_team_id = @teamId
  )
  SELECT
    t.id   AS team_id,
    t.name AS team_name,
    t.slug AS team_slug,
    t.logo_url AS logo_url,
    COALESCE(SUM(CASE WHEN tg.postponed = 0 THEN 1 ELSE 0 END), 0) AS games_played,
    COALESCE(SUM(CASE WHEN tg.postponed = 0 AND tg.goals_for >  tg.goals_against THEN 1 ELSE 0 END), 0) AS wins,
    COALESCE(SUM(CASE WHEN tg.postponed = 0 AND tg.goals_for <  tg.goals_against THEN 1 ELSE 0 END), 0) AS losses,
    COALESCE(SUM(CASE WHEN tg.postponed = 0 AND tg.goals_for =  tg.goals_against THEN 1 ELSE 0 END), 0) AS ties,
    COALESCE(SUM(CASE WHEN tg.postponed = 0 THEN tg.goals_for     ELSE 0 END), 0) AS goals_for,
    COALESCE(SUM(CASE WHEN tg.postponed = 0 THEN tg.goals_against ELSE 0 END), 0) AS goals_against
  FROM teams t
  LEFT JOIN team_games tg ON tg.team_id = t.id
  WHERE t.id = @teamId
  GROUP BY t.id, t.name, t.slug, t.logo_url
`;

function loadTeamSummary(db: Database, teamId: number): H2HTeamSide | null {
  const row = db.prepare(TEAM_SUMMARY_SQL).get({ teamId }) as TeamSummaryRow | undefined;
  if (!row) return null;
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    teamSlug: row.team_slug,
    logoUrl: row.logo_url ? `/logos/${row.logo_url}` : null,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    gamesPlayed: row.games_played,
  };
}

const COMMON_OPPONENTS_SQL = `
  WITH a_opps AS (
    SELECT CASE WHEN home_team_id = @a THEN away_team_id ELSE home_team_id END AS opp_id
    FROM games
    WHERE postponed = 0 AND (home_team_id = @a OR away_team_id = @a)
  ),
  b_opps AS (
    SELECT CASE WHEN home_team_id = @b THEN away_team_id ELSE home_team_id END AS opp_id
    FROM games
    WHERE postponed = 0 AND (home_team_id = @b OR away_team_id = @b)
  )
  SELECT DISTINCT t.id AS opponent_id, t.name AS opponent_name
  FROM a_opps
  JOIN b_opps ON a_opps.opp_id = b_opps.opp_id
  JOIN teams t ON t.id = a_opps.opp_id
  WHERE a_opps.opp_id != @a AND a_opps.opp_id != @b
  ORDER BY t.name COLLATE NOCASE ASC
`;

const DIRECT_MEETINGS_SQL = `
  SELECT id AS game_id, date, home_team_id, away_team_id, home_score, away_score
  FROM games
  WHERE postponed = 0
    AND ((home_team_id = @a AND away_team_id = @b)
      OR (home_team_id = @b AND away_team_id = @a))
  ORDER BY date DESC, id DESC
`;

interface GameRow {
  game_id: number;
  date: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
}

export function getH2HTeams(db: Database, aId: number, bId: number): H2HTeamsResult {
  const a = loadTeamSummary(db, aId);
  const b = loadTeamSummary(db, bId);

  if (!a || !b || aId === bId) {
    return { a, b, commonOpponents: [], directMeetings: [] };
  }

  const commonOpponents = db
    .prepare(COMMON_OPPONENTS_SQL)
    .all({ a: aId, b: bId }) as Array<{ opponent_id: number; opponent_name: string }>;

  const meetingRows = db
    .prepare(DIRECT_MEETINGS_SQL)
    .all({ a: aId, b: bId }) as GameRow[];

  const directMeetings: H2HDirectMeeting[] = meetingRows.map((g) => {
    const aIsHome = g.home_team_id === aId;
    const aScore = aIsHome ? g.home_score : g.away_score;
    const bScore = aIsHome ? g.away_score : g.home_score;
    let aResult: 'W' | 'L' | 'T';
    if (aScore > bScore) aResult = 'W';
    else if (aScore < bScore) aResult = 'L';
    else aResult = 'T';
    return {
      gameId: g.game_id,
      date: g.date,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      homeScore: g.home_score,
      awayScore: g.away_score,
      aResult,
    };
  });

  return {
    a,
    b,
    commonOpponents: commonOpponents.map((r) => ({
      opponentId: r.opponent_id,
      opponentName: r.opponent_name,
    })),
    directMeetings,
  };
}

interface PlayerSummaryRow {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  games_played: number;
  goals: number;
  assists: number;
  ground_balls: number;
  caused_turnovers: number;
  saves: number;
}

const PLAYER_SUMMARY_SQL = `
  SELECT
    p.id   AS player_id,
    p.name AS player_name,
    p.team_id AS team_id,
    t.name AS team_name,
    COUNT(ps.id) AS games_played,
    COALESCE(SUM(ps.goals), 0)            AS goals,
    COALESCE(SUM(ps.assists), 0)          AS assists,
    COALESCE(SUM(ps.ground_balls), 0)     AS ground_balls,
    COALESCE(SUM(ps.caused_turnovers), 0) AS caused_turnovers,
    COALESCE(SUM(ps.saves), 0)            AS saves
  FROM players p
  JOIN teams t        ON t.id = p.team_id
  LEFT JOIN player_stats ps ON ps.player_id = p.id
  WHERE p.id = @playerId
  GROUP BY p.id, p.name, p.team_id, t.name
`;

function loadPlayerSummary(db: Database, playerId: number): H2HPlayerSide | null {
  const row = db.prepare(PLAYER_SUMMARY_SQL).get({ playerId }) as PlayerSummaryRow | undefined;
  if (!row) return null;
  const gp = row.games_played;
  const points = row.goals + row.assists;
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    teamId: row.team_id,
    teamName: row.team_name,
    gamesPlayed: gp,
    goals: row.goals,
    assists: row.assists,
    points,
    groundBalls: row.ground_balls,
    causedTurnovers: row.caused_turnovers,
    saves: row.saves,
    goalsPerGame: gp > 0 ? Math.round((row.goals / gp) * 100) / 100 : null,
    assistsPerGame: gp > 0 ? Math.round((row.assists / gp) * 100) / 100 : null,
    pointsPerGame: gp > 0 ? Math.round((points / gp) * 100) / 100 : null,
  };
}

const COMPARISON_KEYS: ReadonlyArray<{ key: keyof H2HPlayerSide; label: string }> = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'points', label: 'Points' },
  { key: 'groundBalls', label: 'Ground balls' },
  { key: 'causedTurnovers', label: 'Caused TOs' },
  { key: 'saves', label: 'Saves' },
  { key: 'pointsPerGame', label: 'Points/game' },
  { key: 'goalsPerGame', label: 'Goals/game' },
  { key: 'assistsPerGame', label: 'Assists/game' },
];

export function getH2HPlayers(db: Database, aId: number, bId: number): H2HPlayersResult {
  const a = loadPlayerSummary(db, aId);
  const b = loadPlayerSummary(db, bId);

  if (!a || !b || aId === bId) {
    return { a, b, aLeads: [], bLeads: [] };
  }

  const allCmps: H2HCategoryLead[] = COMPARISON_KEYS.map(({ key, label }) => {
    const av = (a[key] as number | null) ?? 0;
    const bv = (b[key] as number | null) ?? 0;
    let leader: 'a' | 'b' | 'tie';
    if (av > bv) leader = 'a';
    else if (bv > av) leader = 'b';
    else leader = 'tie';
    return {
      category: label,
      key: String(key),
      aValue: av,
      bValue: bv,
      leader,
      diff: Math.abs(av - bv),
    };
  });

  const aLeads = allCmps
    .filter((c) => c.leader === 'a')
    .sort((x, y) => y.diff - x.diff)
    .slice(0, 3);
  const bLeads = allCmps
    .filter((c) => c.leader === 'b')
    .sort((x, y) => y.diff - x.diff)
    .slice(0, 3);

  return { a, b, aLeads, bLeads };
}
