// MaxPreps per-game score fetcher.
//
// Given a home team name, away team name, and ISO date, fetch the MaxPreps
// game page and parse the final score from the boxscore table.
//
// Anon scrape only — no auth. Returns null on 404, login wall, parse failure,
// or network error (never throws). Sleeps 1.5s before fetching to be polite
// when used in batch (caller can override via sleepImpl).
//
// URL pattern observed:
//   https://www.maxpreps.com/games/{MM}-{DD}-{YYYY}/lacrosse-26/{teamA-slug}-vs-{teamB-slug}.htm
//
// In practice, MaxPreps game URLs frequently require a `?c=<hash>` token
// that gates the canonical page. Without it, requests often 404. This fetcher
// makes a best-effort attempt with both team orderings; callers that already
// hold the canonical URL (e.g. discovered from a team schedule) should pass
// the pre-loaded HTML via `html` and use this module purely as a parser.

import * as cheerio from 'cheerio';
import type { MaxprepsSchool } from './maxprepsSchools.js';

export interface MaxprepsGameScore {
  homeScore: number;
  awayScore: number;
  sourceUrl: string;
}

export interface FetchMaxprepsGameOpts {
  homeName: string;
  awayName: string;
  /** 'YYYY-MM-DD' */
  dateISO: string;
  fetchImpl?: typeof globalThis.fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Optional pre-loaded HTML for testing (skips fetch). */
  html?: string;
  /** Optional MaxprepsSchool index for slug lookup. */
  schools?: MaxprepsSchool[];
  /**
   * Optional Cookie header value for authenticated requests
   * (e.g. `document.cookie` from a logged-in browser session). Lets the
   * fetcher reach pages that anon traffic 404s on.
   */
  cookie?: string;
  /**
   * Optional pre-discovered canonical game URL (with `?c=<hash>` token).
   * When set, the fetcher skips slug-guessing and fetches this URL directly.
   * Discovered via {@link ./maxprepsSchedule.findScheduleEntry}.
   */
  discoveredUrl?: string;
}

const USER_AGENT =
  'PhillyLacrosseVis/1.0 (data-aggregation; github.com/phillylacrosse)';

const DEFAULT_SLEEP_MS = 1500;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert 'YYYY-MM-DD' to MaxPreps' 'MM-DD-YYYY' (zero-padded).
 * Returns empty string on invalid input.
 */
export function maxprepsDatePath(dateISO: string): string {
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[2]}-${m[3]}-${m[1]}`;
}

/**
 * Slugify a team name to a MaxPreps URL fragment heuristic
 * ("Spring-Ford" → "spring-ford", "Pope John Paul II" → "pope-john-paul-ii").
 */
export function slugifyTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Strip common mascot suffixes from a slug ("spring-ford-rams" → "spring-ford"). */
function stripMascotSuffix(slug: string): string {
  // Mascots are usually 1-2 trailing words; we don't have a closed list, so
  // we just return the slug unchanged AND a stripped variant for the caller
  // to try both. This helper returns just the "leading words" candidate.
  const parts = slug.split('-');
  if (parts.length <= 1) return slug;
  // Drop the last segment as a mascot guess.
  return parts.slice(0, -1).join('-');
}

/**
 * Resolve candidate URL slugs for a team. If a schools index is provided and
 * matches by name, derive candidates from the maxprepsSlug
 * (e.g. "royersford/spring-ford-rams" → "spring-ford-rams", "spring-ford",
 * "royersford"). Otherwise fall back to slugify(name).
 */
export function teamUrlSlugCandidates(
  name: string,
  schools?: MaxprepsSchool[],
): string[] {
  const out = new Set<string>();
  if (schools && schools.length > 0) {
    const target = name.trim().toLowerCase();
    const match = schools.find((s) => s.name.trim().toLowerCase() === target);
    if (match) {
      const segments = match.maxprepsSlug.split('/').filter(Boolean);
      // Prefer the team segment (last), then mascot-stripped, then city.
      if (segments.length >= 2) {
        const teamSeg = segments[segments.length - 1] as string;
        out.add(teamSeg);
        out.add(stripMascotSuffix(teamSeg));
        out.add(segments[0] as string);
      } else if (segments.length === 1) {
        out.add(segments[0] as string);
      }
    }
  }
  out.add(slugifyTeamName(name));
  return [...out].filter((s) => s.length > 0);
}

/** Build candidate game URLs to try, in priority order. */
export function buildGameUrlCandidates(opts: {
  homeName: string;
  awayName: string;
  dateISO: string;
  schools?: MaxprepsSchool[];
}): string[] {
  const datePath = maxprepsDatePath(opts.dateISO);
  if (!datePath) return [];
  const homeCandidates = teamUrlSlugCandidates(opts.homeName, opts.schools);
  const awayCandidates = teamUrlSlugCandidates(opts.awayName, opts.schools);
  const urls: string[] = [];
  // MaxPreps URL ordering isn't strictly home-vs-away in practice; try both.
  for (const a of awayCandidates) {
    for (const h of homeCandidates) {
      urls.push(
        `https://www.maxpreps.com/games/${datePath}/lacrosse-26/${a}-vs-${h}.htm`,
      );
    }
  }
  for (const h of homeCandidates) {
    for (const a of awayCandidates) {
      urls.push(
        `https://www.maxpreps.com/games/${datePath}/lacrosse-26/${h}-vs-${a}.htm`,
      );
    }
  }
  return [...new Set(urls)];
}

interface ParsedTeamScore {
  team: string;
  score: number;
}

/** Parse the boxscore table out of a MaxPreps game page. Returns [] on miss. */
export function parseMaxprepsGameHtml(html: string): ParsedTeamScore[] {
  if (!html || html.length === 0) return [];
  // Login walls / soft 404s
  if (
    /<form[^>]+id=["']login["']/i.test(html) ||
    /<title>\s*404/i.test(html) ||
    /Sign In to MaxPreps/i.test(html)
  ) {
    return [];
  }

  const $ = cheerio.load(html);
  // The boxscore table has class "boxscore" with header row containing "Final"
  // and one row per team. We target the first such table that yields a
  // numeric Final column for two teams.
  const results: ParsedTeamScore[] = [];
  $('table.boxscore, .boxscore').each((_i, el) => {
    if (results.length >= 2) return;
    const $tbl = $(el);
    const headers = $tbl
      .find('tr')
      .first()
      .find('th, td')
      .map((_, c) => $(c).text().trim().toLowerCase())
      .get();
    const finalIdx = headers.findIndex((h) => h === 'final');
    if (finalIdx < 0) return;
    const rows: ParsedTeamScore[] = [];
    $tbl.find('tr').each((rowIdx, r) => {
      if (rowIdx === 0) return;
      const cells = $(r)
        .find('th, td')
        .map((_, c) => $(c).text().trim())
        .get();
      const team = cells[0]?.trim();
      const finalRaw = cells[finalIdx]?.trim();
      if (!team || !finalRaw) return;
      // Only accept integer final scores (lacrosse goals).
      const n = Number.parseInt(finalRaw, 10);
      if (!Number.isFinite(n) || `${n}` !== finalRaw) return;
      rows.push({ team, score: n });
    });
    if (rows.length >= 2) {
      results.push(rows[0] as ParsedTeamScore, rows[1] as ParsedTeamScore);
    }
  });
  return results.slice(0, 2);
}

/** Normalize a team name for fuzzy matching ("Spring-Ford" ≈ "Spring Ford"). */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Given parsed boxscore rows and the requested home/away names, map them.
 * Returns null on ambiguous / no-match.
 */
export function mapParsedScores(
  rows: ParsedTeamScore[],
  homeName: string,
  awayName: string,
): { homeScore: number; awayScore: number } | null {
  if (rows.length !== 2) return null;
  const h = normalizeName(homeName);
  const a = normalizeName(awayName);
  const r0 = normalizeName(rows[0]!.team);
  const r1 = normalizeName(rows[1]!.team);
  // Substring match either direction.
  const r0IsHome = r0.includes(h) || h.includes(r0);
  const r0IsAway = r0.includes(a) || a.includes(r0);
  const r1IsHome = r1.includes(h) || h.includes(r1);
  const r1IsAway = r1.includes(a) || a.includes(r1);
  if (r0IsHome && r1IsAway) {
    return { homeScore: rows[0]!.score, awayScore: rows[1]!.score };
  }
  if (r0IsAway && r1IsHome) {
    return { homeScore: rows[1]!.score, awayScore: rows[0]!.score };
  }
  return null;
}

interface FetchedPage {
  html: string;
  url: string;
}

async function tryFetch(
  url: string,
  fetchFn: typeof globalThis.fetch,
  cookie?: string,
): Promise<FetchedPage | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
    };
    if (cookie && cookie.length > 0) {
      headers.Cookie = cookie;
    }
    const res = await fetchFn(url, {
      redirect: 'follow',
      headers,
    });
    if (!res.ok) return null;
    if (res.status === 401) return null;
    const html = await res.text();
    if (!html || html.length < 200) return null;
    if (/<title>\s*404/i.test(html)) return null;
    return { html, url };
  } catch {
    return null;
  }
}

/**
 * Fetch + parse a MaxPreps game's final score.
 * Returns null on any failure (404, login wall, parse miss, network error).
 */
export async function fetchMaxprepsGameScore(
  opts: FetchMaxprepsGameOpts,
): Promise<MaxprepsGameScore | null> {
  // Pre-loaded HTML path (testing / when caller already has the page).
  if (opts.html !== undefined) {
    const rows = parseMaxprepsGameHtml(opts.html);
    const mapped = mapParsedScores(rows, opts.homeName, opts.awayName);
    if (!mapped) return null;
    const datePath = maxprepsDatePath(opts.dateISO);
    const homeSlug =
      teamUrlSlugCandidates(opts.homeName, opts.schools)[0] ?? '';
    const awaySlug =
      teamUrlSlugCandidates(opts.awayName, opts.schools)[0] ?? '';
    const sourceUrl = `https://www.maxpreps.com/games/${datePath}/lacrosse-26/${awaySlug}-vs-${homeSlug}.htm`;
    return { ...mapped, sourceUrl };
  }

  const candidates = opts.discoveredUrl
    ? [opts.discoveredUrl]
    : buildGameUrlCandidates({
        homeName: opts.homeName,
        awayName: opts.awayName,
        dateISO: opts.dateISO,
        schools: opts.schools,
      });
  if (candidates.length === 0) return null;

  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const sleepFn = opts.sleepImpl ?? defaultSleep;

  await sleepFn(DEFAULT_SLEEP_MS);

  for (const url of candidates) {
    const fetched = await tryFetch(url, fetchFn, opts.cookie);
    if (!fetched) continue;
    const rows = parseMaxprepsGameHtml(fetched.html);
    const mapped = mapParsedScores(rows, opts.homeName, opts.awayName);
    if (mapped) {
      return { ...mapped, sourceUrl: fetched.url };
    }
  }
  return null;
}
