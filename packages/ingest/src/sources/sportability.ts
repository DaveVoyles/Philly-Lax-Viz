// Sportability league data scraper for PBLA (Philadelphia Box Lacrosse Association).
//
// Source: https://secure.sportability.com/spx/Leagues/
// Standings:  LeagueStandings.aspx?LgID={leagueId}
// Scorers:    LeagueLeaders.aspx?LgID={leagueId}&StatCat=Scoring
// Goalies:    LeagueLeaders.aspx?LgID={leagueId}&StatCat=Goaltending
// Schedule:   LeagueSchedule.aspx?LgID={leagueId}
//
// The site may require session cookies. If direct fetch fails, use Playwright
// via the --headed flag to capture cookies interactively.

import * as cheerio from 'cheerio';

// --- Interfaces ---------------------------------------------------------

export interface SportabilityTeam {
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

export interface SportabilityPlayer {
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

export interface SportabilityGoalie {
  jersey: number;
  name: string;
  team: string;
  gp: number;
  min: number;
  ga: number;
  gaa: number;
}

export interface SportabilityGame {
  gameNum: number;
  date: string;
  time: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  location: string;
  isPlayoff: boolean;
  note: string;
}

export interface SportabilityLeagueData {
  leagueId: number;
  scrapedAt: string;
  teams: SportabilityTeam[];
  players: SportabilityPlayer[];
  goalies: SportabilityGoalie[];
  games: SportabilityGame[];
}

// --- URL helpers --------------------------------------------------------

const BASE = 'https://secure.sportability.com/spx/Leagues';

export function standingsUrl(leagueId: number): string {
  return `${BASE}/LeagueStandings.aspx?LgID=${leagueId}`;
}

export function scorersUrl(leagueId: number): string {
  return `${BASE}/LeagueLeaders.aspx?LgID=${leagueId}&StatCat=Scoring`;
}

export function goaliesUrl(leagueId: number): string {
  return `${BASE}/LeagueLeaders.aspx?LgID=${leagueId}&StatCat=Goaltending`;
}

export function scheduleUrl(leagueId: number): string {
  return `${BASE}/LeagueSchedule.aspx?LgID=${leagueId}`;
}

// --- Parsers ------------------------------------------------------------

function parseInteger(text: string): number {
  const n = parseInt(text.replace(/[^-\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloat2(text: string): number {
  const n = parseFloat(text.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse the Sportability standings page HTML.
 * Table columns: Team | GP | W | L | T | OTW | OTL | Pts | PF | PA | Diff | Streak
 */
export function parseStandingsHtml(html: string): SportabilityTeam[] {
  const $ = cheerio.load(html);
  const teams: SportabilityTeam[] = [];

  // Sportability uses a GridView table with class "pointed" or id containing "GridView"
  const table = $('table.pointed, table[id*="GridView"], table[id*="gvStandings"], .standings-table, table').first();
  if (!table.length) return teams;

  table.find('tr').each((i, tr) => {
    if (i === 0) return; // skip header row
    const tds = $(tr).find('td');
    if (tds.length < 8) return;

    const cells = tds.map((_, td) => $(td).text().trim()).get();
    // Expected column order: Team, GP, W, L, T, OTW, OTL, Pts, PF, PA, Diff, Streak
    // Some leagues may omit OTW/OTL — handle both formats
    let offset = 0;
    const name = cells[0] ?? '';
    if (!name) return;

    const gp = parseInteger(cells[1] ?? '0');
    const wins = parseInteger(cells[2] ?? '0');
    const losses = parseInteger(cells[3] ?? '0');
    const ties = parseInteger(cells[4] ?? '0');

    // Detect whether OTW/OTL columns are present (12 cols) or not (10 cols)
    if (cells.length >= 12) {
      offset = 0;
    } else {
      offset = -2; // no OTW/OTL columns
    }

    const otw = offset === 0 ? parseInteger(cells[5] ?? '0') : 0;
    const otl = offset === 0 ? parseInteger(cells[6] ?? '0') : 0;
    const pts = parseInteger(cells[7 + offset] ?? '0');
    const pf = parseInteger(cells[8 + offset] ?? '0');
    const pa = parseInteger(cells[9 + offset] ?? '0');
    const diff = parseInteger(cells[10 + offset] ?? '0');
    const streak = cells[11 + offset] ?? '';

    teams.push({ name, gp, wins, losses, ties, otw, otl, pts, pf, pa, diff, streak });
  });

  return teams;
}

/**
 * Parse the Sportability scoring leaders page HTML.
 * Table columns: # | Name | Team | GP | G | A | Pts | PEN | PIM
 */
export function parseScorersHtml(html: string): SportabilityPlayer[] {
  const $ = cheerio.load(html);
  const players: SportabilityPlayer[] = [];

  const table = $('table.pointed, table[id*="GridView"], table[id*="gvScoring"], table').first();
  if (!table.length) return players;

  table.find('tr').each((i, tr) => {
    if (i === 0) return;
    const tds = $(tr).find('td');
    if (tds.length < 7) return;

    const cells = tds.map((_, td) => $(td).text().trim()).get();
    const jersey = parseInteger(cells[0] ?? '0');
    const name = cells[1] ?? '';
    const team = cells[2] ?? '';
    if (!name) return;

    const gp = parseInteger(cells[3] ?? '0');
    const goals = parseInteger(cells[4] ?? '0');
    const assists = parseInteger(cells[5] ?? '0');
    const points = parseInteger(cells[6] ?? '0');
    const penalties = parseInteger(cells[7] ?? '0');
    const pim = parseInteger(cells[8] ?? '0');

    players.push({ jersey, name, team, gp, goals, assists, points, penalties, pim });
  });

  return players;
}

/**
 * Parse the Sportability goaltending leaders page HTML.
 * Table columns: # | Name | Team | GP | MIN | GA | GAA
 */
export function parseGoaliesHtml(html: string): SportabilityGoalie[] {
  const $ = cheerio.load(html);
  const goalies: SportabilityGoalie[] = [];

  const table = $('table.pointed, table[id*="GridView"], table[id*="gvGoaltending"], table').first();
  if (!table.length) return goalies;

  table.find('tr').each((i, tr) => {
    if (i === 0) return;
    const tds = $(tr).find('td');
    if (tds.length < 6) return;

    const cells = tds.map((_, td) => $(td).text().trim()).get();
    const jersey = parseInteger(cells[0] ?? '0');
    const name = cells[1] ?? '';
    const team = cells[2] ?? '';
    if (!name) return;

    const gp = parseInteger(cells[3] ?? '0');
    const min = parseInteger(cells[4] ?? '0');
    const ga = parseInteger(cells[5] ?? '0');
    const gaa = parseFloat2(cells[6] ?? '0');

    goalies.push({ jersey, name, team, gp, min, ga, gaa });
  });

  return goalies;
}

/**
 * Parse the Sportability schedule/results page HTML.
 * Table columns: Game # | Date | Time | Home | Away | Score | Location | Notes
 */
export function parseScheduleHtml(html: string): SportabilityGame[] {
  const $ = cheerio.load(html);
  const games: SportabilityGame[] = [];

  const table = $('table.pointed, table[id*="GridView"], table[id*="gvSchedule"], table').first();
  if (!table.length) return games;

  table.find('tr').each((i, tr) => {
    if (i === 0) return;
    const tds = $(tr).find('td');
    if (tds.length < 5) return;

    const cells = tds.map((_, td) => $(td).text().trim()).get();
    const gameNum = parseInteger(cells[0] ?? '0');
    const date = cells[1] ?? '';
    const time = cells[2] ?? '';
    const homeTeam = cells[3] ?? '';
    const awayTeam = cells[4] ?? '';

    // Score may be in format "5 - 3" or separate columns
    let homeScore = 0;
    let awayScore = 0;
    const scoreCell = cells[5] ?? '';
    const scoreParts = scoreCell.split(/\s*-\s*/);
    if (scoreParts.length === 2) {
      homeScore = parseInteger(scoreParts[0] ?? '0');
      awayScore = parseInteger(scoreParts[1] ?? '0');
    }

    const location = cells[6] ?? '';
    const noteRaw = (cells[7] ?? '').toLowerCase();
    let note = '';
    let isPlayoff = false;
    if (noteRaw.includes('overtime') || noteRaw.includes('ot')) note = 'Overtime';
    else if (noteRaw.includes('forfeit')) note = 'Forfeit';
    else if (noteRaw.includes('shootout')) note = 'ShootOut';
    else if (noteRaw.includes('rain')) note = 'Rainout';
    if (noteRaw.includes('playoff') || noteRaw.includes('semi') || noteRaw.includes('final')) {
      isPlayoff = true;
    }

    if (homeTeam || awayTeam) {
      games.push({ gameNum, date, time, homeTeam, awayTeam, homeScore, awayScore, location, isPlayoff, note });
    }
  });

  return games;
}

// --- Fetch orchestrator -------------------------------------------------

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ScrapeOptions {
  leagueId: number;
  fetchFn?: FetchLike;
  /** Optional cookies string (e.g. from Playwright session) */
  cookies?: string;
}

const UA = 'philly-lacrosse-vis/0.1 (+https://phillylaxstats.com) - PBLA data sync';

async function fetchPage(url: string, opts: ScrapeOptions): Promise<string> {
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml',
  };
  if (opts.cookies) {
    headers['Cookie'] = opts.cookies;
  }
  const res = await fetchFn(url, { headers });
  if (!res.ok) {
    throw new Error(`Sportability fetch failed: ${res.status} for ${url}`);
  }
  return res.text();
}

/**
 * Scrape all PBLA data for a given league from Sportability.
 * Returns structured data ready for DB storage or JSON export.
 */
export async function scrapePblaLeague(opts: ScrapeOptions): Promise<SportabilityLeagueData> {
  const { leagueId } = opts;

  const [standingsHtml, scorersHtml, goaliesHtml, scheduleHtml] = await Promise.all([
    fetchPage(standingsUrl(leagueId), opts),
    fetchPage(scorersUrl(leagueId), opts),
    fetchPage(goaliesUrl(leagueId), opts),
    fetchPage(scheduleUrl(leagueId), opts),
  ]);

  return {
    leagueId,
    scrapedAt: new Date().toISOString(),
    teams: parseStandingsHtml(standingsHtml),
    players: parseScorersHtml(scorersHtml),
    goalies: parseGoaliesHtml(goaliesHtml),
    games: parseScheduleHtml(scheduleHtml),
  };
}
