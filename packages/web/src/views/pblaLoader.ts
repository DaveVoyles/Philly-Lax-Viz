// pblaLoader.ts — Fetches PBLA data from live API when available,
// merging with team metadata (colors, captains, jersey images) from pblaData.ts.
// Falls back to fully hardcoded data when API is unreachable (e.g., GitHub Pages static mode).

import { apiUrl } from '../apiBase.js';
import {
  getPblaSeason,
  PBLA_DEFAULT_SEASON,
  teamColor,
  type PblaGame,
  type PblaGoalie,
  type PblaPlayer,
  type PblaSeason,
  type PblaTeam,
} from './pblaData.js';

const IS_STATIC = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
  ?.VITE_STATIC_MODE === 'true';

// Metadata not available from scraper — captain names and jersey images
const TEAM_META: Record<string, { captain?: string; jerseyImg?: string }> = {
  'More Dudes LC': { captain: 'Murf Butler', jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/MoreDudes.png/:/rs=w:600,cg:true,m' },
  Outlaws: { captain: 'Joe Stainer', jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/Outlaws.png/:/rs=w:600,cg:true,m' },
  Edge: { captain: "Matt O'Brian", jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/Edge%202025%20Jersey.png/:/cr=t:0%25,l:0%25,w:100%25,h:100%25/rs=w:600,cg:true' },
  Thunder: { captain: 'Kyle Williams', jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/Thunder.png/:/rs=w:600,cg:true,m' },
  'Pups LC': { captain: 'Adam Segal', jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/Pups.png/:/rs=w:600,cg:true,m' },
  'Beer Wolves': { captain: 'Anthony Fabian', jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/Beer%20Wolves.png/:/rs=w:600,cg:true,m' },
  Revolution: { captain: 'Dave Voyles', jerseyImg: '//img1.wsimg.com/isteam/ip/9e5f3063-7bf9-40d1-b593-5c59c6903080/Revolution.png/:/rs=w:600,cg:true,m' },
};

interface ApiTeamRow {
  league_id: number;
  name: string;
  gp: number;
  wins: number;
  losses: number;
  ties: number;
  otw: number;
  otl: number;
  pts: number;
  pf: number;
  pa: number;
  diff: number;
  streak: string;
}

interface ApiPlayerRow {
  league_id: number;
  jersey: number;
  name: string;
  team: string;
  gp: number;
  goals: number;
  assists: number;
  points: number;
  penalties: number;
  pim: number;
}

interface ApiGoalieRow {
  league_id: number;
  jersey: number;
  name: string;
  team: string;
  gp: number;
  min: number;
  ga: number;
  gaa: number;
}

interface ApiGameRow {
  league_id: number;
  game_num: number;
  date: string;
  time: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  location: string;
  is_playoff: number;
  note: string;
}

let cachedSeason: PblaSeason | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function mapTeam(row: ApiTeamRow): PblaTeam {
  const meta = TEAM_META[row.name];
  return {
    id: 0,
    name: row.name,
    gp: row.gp,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    otw: row.otw,
    otl: row.otl,
    pts: row.pts,
    pf: row.pf,
    pa: row.pa,
    diff: row.diff,
    streak: row.streak,
    color: teamColor(row.name),
    captain: meta?.captain,
    jerseyImg: meta?.jerseyImg,
  };
}

function mapPlayer(row: ApiPlayerRow): PblaPlayer {
  return {
    jersey: row.jersey,
    name: row.name,
    team: row.team,
    gp: row.gp,
    goals: row.goals,
    assists: row.assists,
    points: row.points,
    penalties: row.penalties,
    pim: row.pim,
  };
}

function mapGoalie(row: ApiGoalieRow): PblaGoalie {
  return {
    jersey: row.jersey,
    name: row.name,
    team: row.team,
    gp: row.gp,
    min: row.min,
    ga: row.ga,
    gaa: row.gaa,
  };
}

function mapGame(row: ApiGameRow): PblaGame {
  return {
    gameNum: row.game_num,
    date: row.date,
    time: row.time,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeScore: row.home_score,
    awayScore: row.away_score,
    location: row.location,
    isPlayoff: row.is_playoff === 1,
    note: row.note,
  };
}

async function fetchFromApi(leagueId: number): Promise<PblaSeason | null> {
  try {
    const [teamsRes, playersRes, goaliesRes, gamesRes] = await Promise.all([
      fetch(apiUrl(`/api/pbla/standings?league_id=${leagueId}`)),
      fetch(apiUrl(`/api/pbla/players?league_id=${leagueId}`)),
      fetch(apiUrl(`/api/pbla/goalies?league_id=${leagueId}`)),
      fetch(apiUrl(`/api/pbla/games?league_id=${leagueId}`)),
    ]);

    if (!teamsRes.ok || !playersRes.ok || !goaliesRes.ok || !gamesRes.ok) {
      return null;
    }

    const [teams, players, goalies, games] = await Promise.all([
      teamsRes.json() as Promise<ApiTeamRow[]>,
      playersRes.json() as Promise<ApiPlayerRow[]>,
      goaliesRes.json() as Promise<ApiGoalieRow[]>,
      gamesRes.json() as Promise<ApiGameRow[]>,
    ]);

    // Only use API data if it actually has content
    if (teams.length === 0 && players.length === 0) {
      return null;
    }

    return {
      year: PBLA_DEFAULT_SEASON,
      leagueId,
      label: `${PBLA_DEFAULT_SEASON} (Live)`,
      teams: teams.map(mapTeam),
      players: players.map(mapPlayer),
      goalies: goalies.map(mapGoalie),
      rosters: {}, // Rosters not available from scraper yet
      games: games.map(mapGame),
    };
  } catch {
    return null;
  }
}

/**
 * Load the current PBLA season data.
 * Tries the live API first, falls back to hardcoded data from pblaData.ts.
 * Results are cached for 5 minutes to avoid excessive API calls.
 */
export async function loadPblaSeason(leagueId = 50731): Promise<PblaSeason> {
  // In static mode, always use hardcoded data
  if (IS_STATIC) {
    return getPblaSeason(PBLA_DEFAULT_SEASON);
  }

  // Check cache
  if (cachedSeason && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedSeason;
  }

  const apiData = await fetchFromApi(leagueId);
  if (apiData) {
    cachedSeason = apiData;
    cacheTime = Date.now();
    return apiData;
  }

  // Fallback to hardcoded
  return getPblaSeason(PBLA_DEFAULT_SEASON);
}

/** Synchronous fallback — returns hardcoded data immediately (no API call) */
export function loadPblaSeasonSync(): PblaSeason {
  if (cachedSeason) return cachedSeason;
  return getPblaSeason(PBLA_DEFAULT_SEASON);
}
