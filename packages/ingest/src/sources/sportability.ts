// Sportability league data scraper for PBLA (Philadelphia Box Lacrosse Association).
//
// Source: https://secure.sportability.com/spx/Leagues/
// Standings:  Standings.asp?LgID={leagueId}
// Players:    Statistics.asp?LgID={leagueId}&Pkg=1
// Goalies:    Statistics.asp?LgID={leagueId}&Pkg=2
// Schedule:   Schedule.asp?LgID={leagueId}
//
// Pages are server-rendered HTML. No JavaScript execution needed.
// Dropdowns are just URL parameter filters.

import * as cheerio from 'cheerio';

// --- Interfaces ---------------------------------------------------------

export interface SportabilityTeam {
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

export interface SportabilityRosterPlayer {
  jersey: string;
  name: string;
}

export interface SportabilityTeamRoster {
  teamId: number;
  teamName: string;
  players: SportabilityRosterPlayer[];
}

// --- URL helpers --------------------------------------------------------

const BASE = 'https://secure.sportability.com/spx/Leagues';

export function standingsUrl(leagueId: number): string {
  return `${BASE}/Standings.asp?LgID=${leagueId}`;
}

export function scorersUrl(leagueId: number): string {
  // show1=%20 (space) means "show all" instead of default top 10
  return `${BASE}/Statistics.asp?LgID=${leagueId}&Pkg=1&show1=%20`;
}

export function goaliesUrl(leagueId: number): string {
  // show1=%20 (space) means "show all"
  return `${BASE}/Statistics.asp?LgID=${leagueId}&Pkg=2&show1=%20`;
}

export function scheduleUrl(leagueId: number): string {
  return `${BASE}/Schedule.asp?LgID=${leagueId}`;
}

export function teamRosterUrl(leagueId: number, teamId: number): string {
  return `https://secure.sportability.com/spx/leagues/team.asp?LgID=${leagueId}&TmID=${teamId}`;
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
 * The page uses <table class='sub'> with rows class="tablecontent".
 * Columns: Rank | Team | GP | Record (W-L-T) (streak) | OTW | OTL | Pts | PF | PA | +/-
 */
export function parseStandingsHtml(html: string): SportabilityTeam[] {
  const $ = cheerio.load(html);
  const teams: SportabilityTeam[] = [];

  // Find all data rows in the standings table
  $('tr.tablecontent').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;

    const cells = tds.map((_, td) => $(td).text().trim()).get();

    // Extract team name from link text
    const teamLink = $(tr).find('a[href*="Team.asp"]');
    const name = teamLink.text().trim();
    if (!name) return;

    // Extract team ID from the link href (&TmID=XXXXX)
    const href = teamLink.attr('href') ?? '';
    const tmIdMatch = href.match(/TmID=(\d+)/);
    const id = tmIdMatch ? parseInt(tmIdMatch[1]!, 10) : 0;

    // Parse record link text: "1-0-0" with possible "(W1)" streak after
    const recordLink = $(tr).find('a[href*="Schedule.asp"]');
    const recordText = recordLink.text().trim();
    const recordMatch = recordText.match(/(\d+)-(\d+)-(\d+)/);
    const wins = recordMatch ? parseInt(recordMatch[1]!, 10) : 0;
    const losses = recordMatch ? parseInt(recordMatch[2]!, 10) : 0;
    const ties = recordMatch ? parseInt(recordMatch[3]!, 10) : 0;

    // Streak is in parentheses after the record link
    const fullCellText = $(tds[3]).text().trim();
    const streakMatch = fullCellText.match(/\(([WLT]\d+)\)/);
    const streak = streakMatch ? streakMatch[1]! : '';

    // The remaining columns depend on layout
    // Rank | Team | GP | Record | OTW | OTL | Pts | PF | PA | +/-
    const gp = parseInteger(cells[2] ?? '0');
    const otw = parseInteger(cells[4] ?? '0');
    const otl = parseInteger(cells[5] ?? '0');
    const pts = parseInteger(cells[6] ?? '0');
    const pf = parseInteger(cells[7] ?? '0');
    const pa = parseInteger(cells[8] ?? '0');
    const diff = parseInteger(cells[9] ?? '0');

    teams.push({ id, name, gp, wins, losses, ties, otw, otl, pts, pf, pa, diff, streak });
  });

  return teams;
}

/**
 * Parse the Sportability player statistics page HTML.
 * Columns: # | Player | Team | GP | G | A | Pts | Pen | PIM | Susp
 * Player cell contains "jersey - Name" as link text.
 */
export function parseScorersHtml(html: string): SportabilityPlayer[] {
  const $ = cheerio.load(html);
  const players: SportabilityPlayer[] = [];

  $('tr.tablecontent').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 7) return;

    // Player cell: link text is "92 - Brian Beatson"
    const playerLink = $(tr).find('a[href*="Player.asp"]');
    const playerText = playerLink.text().trim();
    const playerMatch = playerText.match(/^(\d+)\s*-\s*(.+)$/);
    if (!playerMatch) return;

    const jersey = parseInt(playerMatch[1]!, 10);
    const name = playerMatch[2]!.trim();
    const team = $(tds[2]).text().trim();
    if (!name || !team) return;

    const gp = parseInteger($(tds[3]).text());
    const goals = parseInteger($(tds[4]).text());
    const assists = parseInteger($(tds[5]).text());
    const points = parseInteger($(tds[6]).text());
    const penalties = parseInteger($(tds[7]).text());
    const pim = parseInteger($(tds[8]).text());

    players.push({ jersey, name, team, gp, goals, assists, points, penalties, pim });
  });

  return players;
}

/**
 * Parse the Sportability goalie statistics page HTML.
 * Columns: # | Player | Team | GP | Min | GA | GAA
 * Player cell contains "jersey - Name" as link text.
 */
export function parseGoaliesHtml(html: string): SportabilityGoalie[] {
  const $ = cheerio.load(html);
  const goalies: SportabilityGoalie[] = [];

  $('tr.tablecontent').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;

    const playerLink = $(tr).find('a[href*="Player.asp"]');
    const playerText = playerLink.text().trim();
    const playerMatch = playerText.match(/^(\d+)\s*-\s*(.+)$/);
    if (!playerMatch) return;

    const jersey = parseInt(playerMatch[1]!, 10);
    const name = playerMatch[2]!.trim();
    const team = $(tds[2]).text().trim();
    if (!name || !team) return;

    const gp = parseInteger($(tds[3]).text());
    const min = parseInteger($(tds[4]).text());
    const ga = parseInteger($(tds[5]).text());
    const gaa = parseFloat2($(tds[6]).text());

    goalies.push({ jersey, name, team, gp, min, ga, gaa });
  });

  return goalies;
}

/**
 * Parse the Sportability schedule/results page HTML.
 * The schedule table has rows with: Date | Time | Gm | Teams | (empty) | Location | Officials
 * Games with scores have link text like "Outlaws 5 at More Dudes LC 14" or
 * "Thunder 9 at Pups LC 8". The winning score is wrapped in <font color=darkgreen>.
 * Unplayed games show "Edge at Thunder" (no scores).
 */
export function parseScheduleHtml(html: string): SportabilityGame[] {
  const $ = cheerio.load(html);
  const games: SportabilityGame[] = [];
  let lastDate = '';

  $('tr.tablecontent').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;

    // Date column may be empty for second game of same day
    const dateText = $(tds[0]).text().trim().replace(/<a[^>]*>/g, '');
    if (dateText) lastDate = dateText;
    if (!lastDate) return;

    const time = $(tds[1]).text().trim();
    const gameNum = parseInteger($(tds[2]).text());
    if (gameNum === 0) return;

    const teamsCell = $(tds[3]);
    const gameLink = teamsCell.find('a[href*="Game.asp"]');
    const teamsText = gameLink.text().trim();
    if (!teamsText) return;

    const location = $(tds[5]).text().trim();

    // Parse "Away 5 at Home 14" or "Home 9 at Away 8" or "Edge at Thunder" (no scores)
    // Format: the link text shows "Team1 [score] at Team2 [score]"
    // The away team is listed first: "Outlaws 5 at More Dudes LC 14" means Outlaws=away(5), More Dudes=home(14)
    // But also "Thunder 9 at Pups LC 8" means Thunder=away(9), Pups=home(8)
    // Wait - looking at the HTML more carefully:
    // Game 1: "Outlaws 5 at More Dudes LC 14" - Outlaws away, More Dudes home (home wins 14-5)
    // Game 2: "Thunder 9 at Pups LC 8" - Thunder away, Pups home (Thunder wins 9-8)
    // The format is: "{AwayTeam} [score] at {HomeTeam} [score]"

    let awayTeam = '';
    let homeTeam = '';
    let awayScore = 0;
    let homeScore = 0;

    // Try scored game pattern: "Team1 N at Team2 N"
    const scoredMatch = teamsText.match(/^(.+?)\s+(\d+)\s+at\s+(.+?)\s+(\d+)$/);
    if (scoredMatch) {
      awayTeam = scoredMatch[1]!.trim();
      awayScore = parseInt(scoredMatch[2]!, 10);
      homeTeam = scoredMatch[3]!.trim();
      homeScore = parseInt(scoredMatch[4]!, 10);
    } else {
      // Unplayed: "Team1 at Team2"
      const unplayedMatch = teamsText.match(/^(.+?)\s+at\s+(.+)$/);
      if (unplayedMatch) {
        awayTeam = unplayedMatch[1]!.trim();
        homeTeam = unplayedMatch[2]!.trim();
      }
    }

    if (!homeTeam && !awayTeam) return;

    // Convert date format from "Mon 5/18/2026" to "2026-05-18"
    const dateMatch = lastDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    let isoDate = '';
    if (dateMatch) {
      const month = dateMatch[1]!.padStart(2, '0');
      const day = dateMatch[2]!.padStart(2, '0');
      isoDate = `${dateMatch[3]}-${month}-${day}`;
    }

    // Detect playoff from page context (Sportability marks it in link or separate playoff page)
    const isPlayoff = false;
    const note = '';

    games.push({
      gameNum, date: isoDate, time, homeTeam, awayTeam,
      homeScore, awayScore, location, isPlayoff, note,
    });
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
 * Parse a Sportability team roster page (team.asp?LgID=...&TmID=...).
 *
 * The page is latin-1 encoded. Roster rows have:
 *   <td align=right>{jersey}</td><td><a ...>{name}</a></td>
 *
 * "Bench X" entries (jersey -1 or empty-ish) are placeholder slots and are excluded.
 */
export function parseTeamRosterHtml(html: string, teamId: number): SportabilityTeamRoster {
  const $ = cheerio.load(html);

  // Extract team name from the page heading
  let teamName = '';
  $('td.sectionhead, h2, h3, .teamname').each((_i, el) => {
    const t = $(el).text().trim();
    if (t && !teamName) teamName = t;
  });
  // Fallback: look for a bold header cell
  if (!teamName) {
    $('b').each((_i, el) => {
      const t = $(el).text().trim();
      if (t.length > 3 && !teamName) teamName = t;
    });
  }

  const players: SportabilityRosterPlayer[] = [];
  const seen = new Set<string>();

  // Roster rows: <td align="right">jersey</td><td><a href="...">Name</a></td>
  $('tr').each((_i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

    // Find the first td with align=right that looks like a jersey cell
    let jerseyTd = -1;
    tds.each((j, td) => {
      const align = $(td).attr('align') ?? '';
      if (align.toLowerCase() === 'right' && jerseyTd === -1) jerseyTd = j;
    });
    if (jerseyTd === -1) return;

    const jerseyRaw = $(tds[jerseyTd]).text().trim();
    const nameEl = $(tds[jerseyTd + 1]).find('a');
    const name = nameEl.text().trim();

    if (!name || name.length < 2) return;
    // Skip bench/placeholder slots
    if (jerseyRaw === '-1' || name.toLowerCase().startsWith('bench')) return;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    players.push({ jersey: jerseyRaw, name });
  });

  return { teamId, teamName, players };
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

/**
 * Fetch and parse a single team's roster from Sportability.
 */
export async function fetchTeamRoster(
  leagueId: number,
  team: Pick<SportabilityTeam, 'id' | 'name'>,
  opts: Omit<ScrapeOptions, 'leagueId'>,
): Promise<SportabilityTeamRoster> {
  const url = teamRosterUrl(leagueId, team.id);
  const html = await fetchPage(url, { ...opts, leagueId });
  const roster = parseTeamRosterHtml(html, team.id);
  // Use the name from the standings (more reliable than what's on the team page)
  roster.teamName = team.name;
  return roster;
}
