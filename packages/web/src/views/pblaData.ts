// PBLA (Philadelphia Box Lacrosse Association) hardcoded data
// Source: https://secure.sportability.com/spx/Leagues/ (LgID=50731 for 2026, LgID=50247 for 2025)
// TODO: Replace with live scraper once PBLA partnership is confirmed

export interface PblaTeam {
  id: number;
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
  color: string;
}

export interface PblaPlayer {
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

export interface PblaGoalie {
  jersey: number;
  name: string;
  team: string;
  gp: number;
  min: number;
  ga: number;
  gaa: number;
}

export interface PblaSeason {
  year: number;
  leagueId: number;
  label: string;
  teams: PblaTeam[];
  players: PblaPlayer[];
  goalies: PblaGoalie[];
}

const TEAM_COLORS: Record<string, string> = {
  'More Dudes LC': '#34d399',
  'More Dudes': '#34d399',
  Outlaws: '#f59e0b',
  Edge: '#3b82f6',
  Thunder: '#8b5cf6',
  'Pups LC': '#ef4444',
  'Beer Wolves': '#d97706',
  Revolution: '#ec4899',
  'Black Storm': '#64748b',
};

export function teamColor(name: string): string {
  return TEAM_COLORS[name] ?? '#6b7280';
}

export function teamSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Find a team across all seasons by slug */
export function findTeamBySlug(slug: string): { team: PblaTeam; season: PblaSeason } | null {
  for (const season of SEASONS) {
    const team = season.teams.find((t) => teamSlug(t.name) === slug);
    if (team) return { team, season };
  }
  return null;
}

/** Get all players for a team in a given season */
export function getTeamPlayers(teamName: string, season: PblaSeason): PblaPlayer[] {
  return season.players.filter((p) => p.team === teamName);
}

/** Get all goalies for a team in a given season */
export function getTeamGoalies(teamName: string, season: PblaSeason): PblaGoalie[] {
  return season.goalies.filter((g) => g.team === teamName);
}

export const SEASONS: PblaSeason[] = [
  {
    year: 2026,
    leagueId: 50731,
    label: '2026 (Current)',
    teams: [
      { id: 343517, name: 'More Dudes LC', gp: 1, wins: 1, losses: 0, ties: 0, otw: 0, otl: 0, pts: 3, pf: 14, pa: 5, diff: 9, streak: 'W1', color: '#34d399' },
      { id: 343511, name: 'Outlaws', gp: 2, wins: 1, losses: 1, ties: 0, otw: 0, otl: 0, pts: 3, pf: 20, pa: 18, diff: 2, streak: 'W1', color: '#f59e0b' },
      { id: 343512, name: 'Edge', gp: 1, wins: 1, losses: 0, ties: 0, otw: 0, otl: 0, pts: 3, pf: 11, pa: 8, diff: 3, streak: 'W1', color: '#3b82f6' },
      { id: 343516, name: 'Thunder', gp: 1, wins: 1, losses: 0, ties: 0, otw: 0, otl: 0, pts: 3, pf: 9, pa: 8, diff: 1, streak: 'W1', color: '#8b5cf6' },
      { id: 343514, name: 'Pups LC', gp: 1, wins: 0, losses: 1, ties: 0, otw: 0, otl: 0, pts: 0, pf: 8, pa: 9, diff: -1, streak: 'L1', color: '#ef4444' },
      { id: 343513, name: 'Beer Wolves', gp: 1, wins: 0, losses: 1, ties: 0, otw: 0, otl: 0, pts: 0, pf: 8, pa: 11, diff: -3, streak: 'L1', color: '#d97706' },
      { id: 343515, name: 'Revolution', gp: 1, wins: 0, losses: 1, ties: 0, otw: 0, otl: 0, pts: 0, pf: 4, pa: 15, diff: -11, streak: 'L1', color: '#ec4899' },
    ],
    players: [
      { jersey: 92, name: 'Brian Beatson', team: 'Outlaws', gp: 2, goals: 2, assists: 6, points: 8, penalties: 0, pim: 0 },
      { jersey: 55, name: 'Dalton Hofmann', team: 'More Dudes LC', gp: 1, goals: 7, assists: 1, points: 8, penalties: 0, pim: 0 },
      { jersey: 16, name: 'Dylan Portnoy', team: 'Outlaws', gp: 2, goals: 4, assists: 1, points: 5, penalties: 0, pim: 0 },
      { jersey: 4, name: 'Jack Glemser', team: 'Edge', gp: 1, goals: 3, assists: 1, points: 4, penalties: 0, pim: 0 },
      { jersey: 55, name: 'Philip Melecio', team: 'Outlaws', gp: 1, goals: 4, assists: 0, points: 4, penalties: 0, pim: 0 },
      { jersey: 88, name: 'Brian Sullivan', team: 'Outlaws', gp: 2, goals: 1, assists: 3, points: 4, penalties: 0, pim: 0 },
      { jersey: 96, name: 'Andrew Streilein', team: 'Pups LC', gp: 1, goals: 2, assists: 2, points: 4, penalties: 0, pim: 0 },
      { jersey: 17, name: 'Murph Butler', team: 'More Dudes LC', gp: 1, goals: 1, assists: 2, points: 3, penalties: 0, pim: 0 },
      { jersey: 1, name: 'Brandon Cerone', team: 'Outlaws', gp: 1, goals: 3, assists: 0, points: 3, penalties: 0, pim: 0 },
      { jersey: 96, name: 'George Downey', team: 'Outlaws', gp: 2, goals: 2, assists: 0, points: 2, penalties: 1, pim: 2 },
    ],
    goalies: [],
  },
  {
    year: 2025,
    leagueId: 50247,
    label: '2025 (Complete)',
    teams: [
      { id: 339150, name: 'Thunder', gp: 11, wins: 9, losses: 2, ties: 0, otw: 0, otl: 0, pts: 27, pf: 112, pa: 78, diff: 34, streak: 'W3', color: '#8b5cf6' },
      { id: 339148, name: 'More Dudes', gp: 11, wins: 8, losses: 3, ties: 0, otw: 0, otl: 0, pts: 24, pf: 145, pa: 98, diff: 47, streak: 'W2', color: '#34d399' },
      { id: 339149, name: 'Outlaws', gp: 11, wins: 7, losses: 4, ties: 0, otw: 0, otl: 0, pts: 21, pf: 118, pa: 95, diff: 23, streak: 'L1', color: '#f59e0b' },
      { id: 339152, name: 'Beer Wolves', gp: 11, wins: 6, losses: 5, ties: 0, otw: 0, otl: 0, pts: 18, pf: 130, pa: 110, diff: 20, streak: 'W1', color: '#d97706' },
      { id: 339153, name: 'Black Storm', gp: 11, wins: 5, losses: 6, ties: 0, otw: 0, otl: 0, pts: 15, pf: 105, pa: 112, diff: -7, streak: 'L2', color: '#64748b' },
      { id: 339154, name: 'Revolution LC', gp: 11, wins: 3, losses: 8, ties: 0, otw: 0, otl: 0, pts: 9, pf: 85, pa: 120, diff: -35, streak: 'L3', color: '#ec4899' },
      { id: 339151, name: 'The Edge', gp: 11, wins: 2, losses: 9, ties: 0, otw: 0, otl: 0, pts: 6, pf: 72, pa: 154, diff: -82, streak: 'L5', color: '#3b82f6' },
    ],
    players: [
      { jersey: 31, name: 'Carter Begley', team: 'More Dudes', gp: 9, goals: 36, assists: 7, points: 43, penalties: 1, pim: 2 },
      { jersey: 24, name: 'James Lindsay', team: 'Black Storm', gp: 10, goals: 19, assists: 13, points: 32, penalties: 2, pim: 4 },
      { jersey: 13, name: 'Ryan Quan', team: 'Thunder', gp: 9, goals: 19, assists: 10, points: 29, penalties: 1, pim: 2 },
      { jersey: 18, name: 'Connor Mann', team: 'Beer Wolves', gp: 10, goals: 20, assists: 8, points: 28, penalties: 5, pim: 8 },
      { jersey: 76, name: 'Nathaniel Winters', team: 'Beer Wolves', gp: 10, goals: 19, assists: 8, points: 27, penalties: 0, pim: 0 },
      { jersey: 22, name: 'Joe Stainer', team: 'Outlaws', gp: 11, goals: 11, assists: 15, points: 26, penalties: 5, pim: 10 },
      { jersey: 17, name: 'Murphy Butler', team: 'More Dudes', gp: 9, goals: 14, assists: 11, points: 25, penalties: 3, pim: 6 },
      { jersey: 55, name: 'Dalton Hofmann', team: 'More Dudes', gp: 10, goals: 12, assists: 7, points: 19, penalties: 3, pim: 6 },
      { jersey: 55, name: 'Phillip Melecio', team: 'Outlaws', gp: 10, goals: 16, assists: 3, points: 19, penalties: 3, pim: 6 },
      { jersey: 16, name: 'Dylan Portnoy', team: 'Outlaws', gp: 10, goals: 10, assists: 5, points: 15, penalties: 1, pim: 2 },
    ],
    goalies: [],
  },
];
