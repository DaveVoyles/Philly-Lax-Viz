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

export interface PblaRosterEntry {
  name: string;
  jersey: string;
  position: string;
  notes: string;
}

export interface PblaSeason {
  year: number;
  leagueId: number;
  label: string;
  teams: PblaTeam[];
  players: PblaPlayer[];
  goalies: PblaGoalie[];
  rosters: Record<string, PblaRosterEntry[]>;
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

/** Get the full roster for a team in a given season */
export function getTeamRoster(teamName: string, season: PblaSeason): PblaRosterEntry[] {
  return season.rosters[teamName] ?? [];
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
      { jersey: 55, name: 'Dalton Hofmann', team: 'More Dudes LC', gp: 1, goals: 7, assists: 1, points: 8, penalties: 0, pim: 0 },
      { jersey: 92, name: 'Brian Beatson', team: 'Outlaws', gp: 2, goals: 2, assists: 6, points: 8, penalties: 0, pim: 0 },
      { jersey: 16, name: 'Dylan Portnoy', team: 'Outlaws', gp: 2, goals: 4, assists: 1, points: 5, penalties: 0, pim: 0 },
      { jersey: 4, name: 'Jack Glemser', team: 'Edge', gp: 1, goals: 3, assists: 1, points: 4, penalties: 0, pim: 0 },
      { jersey: 55, name: 'Philip Melecio', team: 'Outlaws', gp: 1, goals: 4, assists: 0, points: 4, penalties: 0, pim: 0 },
      { jersey: 88, name: 'Brian Sullivan', team: 'Outlaws', gp: 2, goals: 1, assists: 3, points: 4, penalties: 0, pim: 0 },
      { jersey: 96, name: 'Andrew Streilein', team: 'Pups LC', gp: 1, goals: 2, assists: 2, points: 4, penalties: 0, pim: 0 },
      { jersey: 17, name: 'Murph Butler', team: 'More Dudes LC', gp: 1, goals: 1, assists: 2, points: 3, penalties: 0, pim: 0 },
      { jersey: 1, name: 'Brandon Cerone', team: 'Outlaws', gp: 1, goals: 3, assists: 0, points: 3, penalties: 0, pim: 0 },
      { jersey: 96, name: 'George Downey', team: 'Outlaws', gp: 2, goals: 2, assists: 0, points: 2, penalties: 1, pim: 2 },
    ],
    goalies: [
      { jersey: 0, name: 'Bryce Kash', team: 'Outlaws', gp: 2, min: 60, ga: 8, gaa: 6.67 },
      { jersey: 4, name: 'Matt Kuhn', team: 'More Dudes LC', gp: 1, min: 45, ga: 5, gaa: 5.56 },
      { jersey: 29, name: 'Conor Atkinson', team: 'Thunder', gp: 1, min: 45, ga: 8, gaa: 8.89 },
      { jersey: 0, name: 'Toby Feddor', team: 'Beer Wolves', gp: 1, min: 45, ga: 11, gaa: 12.22 },
      { jersey: 30, name: 'Sid Johansen', team: 'Revolution', gp: 1, min: 45, ga: 15, gaa: 16.67 },
      { jersey: 69, name: 'Bennett Mileto', team: 'Outlaws', gp: 1, min: 30, ga: 10, gaa: 16.67 },
      { jersey: 2, name: 'Chase Beale', team: 'Pups LC', gp: 1, min: 30, ga: 6, gaa: 10.00 },
      { jersey: 17, name: "Tom O'Hagan", team: 'Edge', gp: 1, min: 30, ga: 6, gaa: 10.00 },
      { jersey: 19, name: 'Victoria Sloan', team: 'Pups LC', gp: 1, min: 15, ga: 3, gaa: 10.00 },
      { jersey: 38, name: 'Eric Young', team: 'Edge', gp: 1, min: 15, ga: 2, gaa: 6.67 },
    ],
    rosters: {
      'Beer Wolves': [
        { name: 'Ricky Amorim', jersey: '92', position: '', notes: 'Rook' },
        { name: 'Gabriel Bonner', jersey: '18', position: '', notes: '' },
        { name: 'Liam Burns', jersey: '', position: '', notes: '' },
        { name: 'Ryan Carrthers', jersey: '97', position: '', notes: '' },
        { name: 'Timothy Clark', jersey: '2', position: '', notes: '' },
        { name: 'Roman Decenzo', jersey: '13', position: '', notes: '' },
        { name: 'Mackenzie Ensley', jersey: '53', position: '', notes: '' },
        { name: 'Toby Feddor', jersey: '00', position: 'Goalie', notes: '' },
        { name: 'Rob Foster', jersey: '91', position: '', notes: '' },
        { name: 'Joshua Hammer', jersey: '99', position: 'Goalie', notes: '' },
        { name: 'Frank Haney', jersey: '8', position: '', notes: '' },
        { name: 'Jason Jones', jersey: '41', position: '', notes: '' },
        { name: 'Chris Lasprogata', jersey: '16', position: '', notes: '' },
        { name: 'Robert Lowman', jersey: '40', position: '', notes: '' },
        { name: 'Ryan Mackey', jersey: '21', position: '', notes: '' },
        { name: 'Luke Mingioni', jersey: '9', position: '', notes: '' },
        { name: 'William Murdock', jersey: '12', position: '', notes: '' },
        { name: 'Ryan Santo Domingo', jersey: '96', position: '', notes: '' },
        { name: 'Anthony Stranix', jersey: '42', position: '', notes: '' },
        { name: 'Michael Wadley', jersey: '', position: '', notes: '' },
        { name: 'Nate Winters', jersey: '76', position: '', notes: '' },
      ],
      Edge: [
        { name: 'Dave Anderson', jersey: '14', position: '', notes: '' },
        { name: 'Brian Andrews', jersey: '7', position: '', notes: 'Asst' },
        { name: 'George Balascak', jersey: '41', position: '', notes: '' },
        { name: 'Dominic Burphy', jersey: '47', position: '', notes: '' },
        { name: 'Chris Calhoun', jersey: '12', position: '', notes: '' },
        { name: 'Jheramiah Dameus', jersey: '9', position: '', notes: '' },
        { name: 'Julian Definis', jersey: '51', position: '', notes: '' },
        { name: 'Julian Freedman', jersey: '81', position: '', notes: '' },
        { name: 'Pat Gillespie', jersey: '19', position: '', notes: '' },
        { name: 'Jack Glemser', jersey: '4', position: '', notes: '' },
        { name: 'Joe Hagedorn', jersey: '15', position: '', notes: '' },
        { name: 'Spencer Homan', jersey: '87', position: '', notes: '' },
        { name: 'Chris Lawrence', jersey: '55', position: '', notes: '' },
        { name: 'Tanner Mearns', jersey: '28', position: '', notes: '' },
        { name: 'Richard Nelson', jersey: '39', position: '', notes: '' },
        { name: "Matt O'Brien", jersey: '29', position: '', notes: 'Capt' },
        { name: "Tom O'Hagan", jersey: '17', position: 'Goalie', notes: '' },
        { name: 'Luke Okupski', jersey: '2', position: '', notes: '' },
        { name: 'Bailey Orehosky', jersey: '9', position: '', notes: '' },
        { name: 'Michael Plastino', jersey: '19', position: '', notes: '' },
        { name: 'Max Pulcini', jersey: '43', position: '', notes: 'Asst' },
        { name: 'Curtis Reinard', jersey: '5', position: '', notes: '' },
        { name: 'Jason Smaron', jersey: '91', position: '', notes: '' },
        { name: 'Jude Walsh', jersey: '67', position: '', notes: '' },
        { name: 'Sean Walsh', jersey: '16', position: '', notes: '' },
        { name: 'Eric Young', jersey: '38', position: 'Goalie', notes: '' },
      ],
      'More Dudes LC': [
        { name: 'Murph Butler', jersey: '17', position: '', notes: '' },
        { name: 'John Creaney', jersey: '47', position: '', notes: '' },
        { name: 'Cristian Davis', jersey: '50', position: '', notes: '' },
        { name: 'Noah Frantz', jersey: '7', position: '', notes: '' },
        { name: 'Rob Hefron', jersey: '77', position: '', notes: '' },
        { name: 'Dalton Hofmann', jersey: '55', position: '', notes: '' },
        { name: 'Billy Houser', jersey: '', position: '', notes: '' },
        { name: 'Ethan Krauss', jersey: '3', position: '', notes: '' },
        { name: 'Matt Kuhn', jersey: '4', position: 'Goalie', notes: '' },
        { name: 'Brett Lundberg', jersey: '42', position: '', notes: '' },
        { name: 'Tom McAneney', jersey: '71', position: '', notes: '' },
        { name: 'Robert McClure', jersey: '13', position: '', notes: '' },
        { name: 'Jonathan Miller', jersey: '5', position: '', notes: '' },
        { name: 'Ben Minardi', jersey: '19', position: '', notes: '' },
        { name: 'Sam Mutz', jersey: '10', position: '', notes: '' },
        { name: 'Wade Mutz', jersey: '24', position: '', notes: '' },
        { name: 'Erik Ojert', jersey: '67', position: '', notes: '' },
        { name: 'Tyler Rotkowitz', jersey: '9', position: '', notes: '' },
        { name: 'Guile Schltzkie', jersey: '26', position: '', notes: '' },
        { name: 'Evan Scott', jersey: '92', position: '', notes: '' },
        { name: 'Cale Stielau', jersey: '23', position: '', notes: '' },
        { name: 'Jake Townsend', jersey: '31', position: '', notes: '' },
        { name: 'Greg Wheaton', jersey: '88', position: '', notes: '' },
        { name: 'Adam Yee', jersey: '11', position: '', notes: '' },
      ],
      Outlaws: [
        { name: 'Niall Bailey', jersey: '56', position: '', notes: '' },
        { name: 'Brian Beatson', jersey: '92', position: '', notes: '' },
        { name: 'Ian Bittenbender', jersey: '6', position: '', notes: '' },
        { name: 'Brandon Cerone', jersey: '1', position: '', notes: '' },
        { name: 'Chip Chapman', jersey: '79', position: '', notes: '' },
        { name: 'George Downey', jersey: '96', position: '', notes: '' },
        { name: 'Jovan Estrada', jersey: '25', position: '', notes: '' },
        { name: 'Jeff Gonzales84', jersey: '66', position: '', notes: '' },
        { name: 'Brady Hawlk', jersey: '9', position: '', notes: '' },
        { name: 'Caiden Hawlk', jersey: '31', position: '', notes: '' },
        { name: 'Kees Holterman', jersey: '63', position: '', notes: '' },
        { name: 'Bryce Kash', jersey: '0', position: 'Goalie', notes: '' },
        { name: 'Matt Kruszewski', jersey: '77', position: '', notes: '' },
        { name: 'Adam Kulp', jersey: '20', position: '', notes: '' },
        { name: 'William Mahon', jersey: '19', position: '', notes: '' },
        { name: 'Aedan McKenna', jersey: '87', position: '', notes: '' },
        { name: 'Philip Melecio', jersey: '55', position: '', notes: '' },
        { name: 'Bennett Mileto', jersey: '69', position: 'Goalie', notes: '' },
        { name: 'Camdon Pierce', jersey: '3', position: '', notes: '' },
        { name: 'Dylan Pool', jersey: '18', position: '', notes: '' },
        { name: 'Dylan Portnoy', jersey: '16', position: '', notes: '' },
        { name: 'Dan Recine', jersey: '49', position: '', notes: '' },
        { name: 'Kinori Rosnow', jersey: '29', position: '', notes: '' },
        { name: 'Joe Stainer', jersey: '22', position: '', notes: '' },
        { name: 'Brian Sullivan', jersey: '88', position: '', notes: '' },
        { name: 'Evan Swiker', jersey: '15', position: '', notes: '' },
      ],
      'Pups LC': [
        { name: 'Logan Amaya', jersey: '8', position: '', notes: '' },
        { name: 'Logan Barlok', jersey: '91', position: '', notes: '' },
        { name: 'Blake Beale', jersey: '28', position: '', notes: '' },
        { name: 'Brent Beale', jersey: '26', position: '', notes: '' },
        { name: 'Chase Beale', jersey: '2', position: 'Goalie', notes: '' },
        { name: 'Colin Bosak', jersey: '11', position: '', notes: '' },
        { name: 'Reece Childs', jersey: '', position: '', notes: '' },
        { name: 'Nick Fox', jersey: '7', position: '', notes: '' },
        { name: 'George Grippo', jersey: '00', position: '', notes: '' },
        { name: 'Soloman Hess', jersey: '', position: '', notes: '' },
        { name: 'Tyler Kostack', jersey: '22', position: '', notes: '' },
        { name: 'Chris Lieze-Hammel', jersey: '34', position: '', notes: '' },
        { name: 'James Lindsay', jersey: '24', position: '', notes: '' },
        { name: 'Caleb Oswari', jersey: '88', position: '', notes: '' },
        { name: 'Ryan Quinn', jersey: '14', position: '', notes: '' },
        { name: 'Sean Quinn, Jr', jersey: '43', position: '', notes: '' },
        { name: 'Ryan Rafferty', jersey: '18', position: '', notes: '' },
        { name: 'Mattew Rueter', jersey: '45', position: '', notes: '' },
        { name: 'Andrew Sloan', jersey: '86', position: '', notes: '' },
        { name: 'Victoria Sloan', jersey: '19', position: 'Goalie', notes: '' },
        { name: 'Andrew Streilein', jersey: '96', position: '', notes: '' },
        { name: 'Caiden Zadell', jersey: '51', position: '', notes: '' },
      ],
      Revolution: [
        { name: 'Andrew Butkus', jersey: '8', position: '', notes: '' },
        { name: 'Nicholas Cost', jersey: '9', position: '', notes: '' },
        { name: 'Jayden Cox', jersey: '10', position: '', notes: '' },
        { name: 'Alec Fleming', jersey: '19', position: '', notes: '' },
        { name: 'Tyler Foulke', jersey: '35', position: '', notes: '' },
        { name: 'Connor Freer', jersey: '2', position: '', notes: '' },
        { name: 'Ricky Gergasko', jersey: '64', position: '', notes: '' },
        { name: 'Jack Gerzabek', jersey: '39', position: '', notes: '' },
        { name: 'Ian Hagan', jersey: '21', position: '', notes: '' },
        { name: 'Sabastian Hamilton', jersey: '22', position: '', notes: '' },
        { name: 'Scott Jackson', jersey: '88', position: '', notes: '' },
        { name: 'Sid Johansen', jersey: '30', position: 'Goalie', notes: '' },
        { name: 'Scott MacMillan', jersey: '59', position: '', notes: '' },
        { name: 'Sean McMaster', jersey: '27', position: '', notes: '' },
        { name: 'Brandon Reese', jersey: '11', position: '', notes: '' },
        { name: 'James Reilly', jersey: '77', position: '', notes: '' },
        { name: 'Andrew Ruiz', jersey: '17', position: '', notes: '' },
        { name: 'Russ Taranto', jersey: '34', position: '', notes: '' },
        { name: 'Jeffrey Vetter', jersey: '44', position: '', notes: '' },
        { name: 'Dave Voyles', jersey: '49', position: '', notes: '' },
        { name: 'Joe Walton', jersey: '55', position: '', notes: '' },
      ],
      Thunder: [
        { name: 'Conor Atkinson', jersey: '29', position: 'G', notes: 'Goalie' },
        { name: 'Michael Buono', jersey: '88', position: '', notes: '' },
        { name: 'Michael Carbone', jersey: '41', position: '', notes: '' },
        { name: 'Austin Conner', jersey: '10', position: '', notes: '' },
        { name: 'Brian Dailey', jersey: '61', position: '', notes: 'Capt' },
        { name: 'Jimmy Gabrielsen', jersey: '36', position: '', notes: '' },
        { name: 'Jake Hervada', jersey: '1', position: '', notes: '' },
        { name: 'Deglan Hogarth', jersey: '22', position: '', notes: '' },
        { name: 'Traeger Hogarth', jersey: '27', position: '', notes: '' },
        { name: 'Tim Kiel', jersey: '17', position: '', notes: '' },
        { name: 'Joey Klinges', jersey: '4', position: '', notes: 'Asst' },
        { name: 'Matt Klinges', jersey: '91', position: '', notes: '' },
        { name: 'Kellen Korb', jersey: '24', position: '', notes: '' },
        { name: 'Kyle Marr', jersey: '51', position: '', notes: '' },
        { name: 'Seamus McCloskey', jersey: '7', position: '', notes: '' },
        { name: 'Ryan McNulty', jersey: '19', position: '', notes: '' },
        { name: 'Ryan Quan', jersey: '13', position: '', notes: '' },
        { name: 'Conor Resch', jersey: '34', position: '', notes: 'Asst' },
        { name: 'Patrick Resch', jersey: '33', position: '', notes: '' },
        { name: 'Alec Rubman', jersey: '30', position: '', notes: '' },
        { name: 'Pat Smyth', jersey: '71', position: '', notes: '' },
        { name: 'Mike Weaver', jersey: '16', position: '', notes: '' },
      ],
    },
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
    rosters: {},
  },
];
