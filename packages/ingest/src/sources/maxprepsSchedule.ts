// MaxPreps team schedule fetcher / parser.
//
// MaxPreps per-game URLs require an unguessable `?c=<hash>` token. We can't
// construct them; we have to discover them. The schedule page for a team
// (https://www.maxpreps.com/pa/{slug}/lacrosse/schedule/) is server-rendered
// HTML and lists every game on the season with the canonical URL + token.
//
// This module:
//   1. fetches a team's schedule page (anon — works without cookie),
//   2. parses out every `/games/MM-DD-YYYY/lacrosse-26/{a}-vs-{b}.htm?c=...`
//      link,
//   3. exposes a lookup helper that returns the canonical URL for a given
//      (date, opponent-slug) pair.
//
// Returns null on network/404/empty rather than throwing so callers can degrade
// gracefully.

const USER_AGENT =
  'PhillyLacrosseVis/1.0 (data-aggregation; github.com/phillylacrosse)';

const DEFAULT_SLEEP_MS = 1500;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ScheduleEntry {
  /** ISO date 'YYYY-MM-DD' parsed from the URL's MM-DD-YYYY segment. */
  dateISO: string;
  /** First slug in the URL (e.g. "pottsgrove" from .../pottsgrove-vs-spring-ford.htm). */
  firstSlug: string;
  /** Second slug in the URL (e.g. "spring-ford"). */
  secondSlug: string;
  /** Absolute canonical game URL with `?c=<hash>` token. */
  url: string;
}

/** Build the team's MaxPreps schedule URL from a school slug + state. */
export function buildScheduleUrl(opts: {
  /** e.g. "royersford/spring-ford-rams". */
  schoolSlug: string;
  /** Two-letter state code; defaults to 'pa'. */
  state?: string;
}): string {
  const state = (opts.state ?? 'pa').toLowerCase();
  return `https://www.maxpreps.com/${state}/${opts.schoolSlug}/lacrosse/schedule/`;
}

/**
 * Parse all canonical game URLs out of a schedule page. The same href appears
 * twice per game (once relative, once absolute); we de-dup by URL.
 */
export function parseScheduleHtml(html: string): ScheduleEntry[] {
  if (!html || html.length === 0) return [];
  // Match both relative ("/games/...") and absolute ("https://www.maxpreps.com/games/...")
  // hrefs in a single pass; dedupe by canonical URL.
  const re =
    /href="(?:https:\/\/www\.maxpreps\.com)?(\/games\/(\d{2})-(\d{2})-(\d{4})\/lacrosse-26\/([a-z0-9-]+)-vs-([a-z0-9-]+)\.htm\?c=[A-Za-z0-9_-]+)"/g;
  const seen = new Map<string, ScheduleEntry>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1] as string;
    const month = m[2] as string;
    const day = m[3] as string;
    const year = m[4] as string;
    const firstSlug = m[5] as string;
    const secondSlug = m[6] as string;
    const url = `https://www.maxpreps.com${path}`;
    if (seen.has(url)) continue;
    seen.set(url, {
      dateISO: `${year}-${month}-${day}`,
      firstSlug,
      secondSlug,
      url,
    });
  }
  return [...seen.values()];
}

/**
 * Find a schedule entry matching a date + opponent slug heuristic.
 * Match rule: dateISO equals AND opponent slug appears as either the first
 * or second URL segment AND the team's own slug appears as the other segment.
 *
 * `ownSlugCandidates` and `opponentSlugCandidates` are tried as substrings
 * against the URL slugs (so "spring-ford" matches "spring-ford" and
 * "spring-ford-rams"; "perkiomen" matches "perkiomen-valley").
 */
export function findScheduleEntry(
  entries: ScheduleEntry[],
  opts: {
    dateISO: string;
    ownSlugCandidates: string[];
    opponentSlugCandidates: string[];
  },
): ScheduleEntry | null {
  const own = opts.ownSlugCandidates
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);
  const opp = opts.opponentSlugCandidates
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 0);
  if (own.length === 0 || opp.length === 0) return null;
  const matches = entries.filter((e) => e.dateISO === opts.dateISO);
  if (matches.length === 0) return null;

  for (const e of matches) {
    const f = e.firstSlug.toLowerCase();
    const s = e.secondSlug.toLowerCase();
    const slugMatch = (slug: string, candidates: string[]): boolean =>
      candidates.some(
        (c) => slug === c || slug.includes(c) || c.includes(slug),
      );
    const ownIsFirst = slugMatch(f, own);
    const ownIsSecond = slugMatch(s, own);
    const oppIsFirst = slugMatch(f, opp);
    const oppIsSecond = slugMatch(s, opp);
    if ((ownIsFirst && oppIsSecond) || (ownIsSecond && oppIsFirst)) {
      return e;
    }
  }
  return null;
}

export interface FetchScheduleOpts {
  /** e.g. "royersford/spring-ford-rams". */
  schoolSlug: string;
  /** Two-letter state code; defaults to 'pa'. */
  state?: string;
  fetchImpl?: typeof globalThis.fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Optional Cookie header for authenticated requests. */
  cookie?: string;
  /** Optional pre-loaded HTML for testing (skips fetch). */
  html?: string;
}

/**
 * Fetch + parse a team's schedule page. Returns null on 404 / network error
 * / empty page; returns [] for "page loaded but no games" (a real signal,
 * different from "couldn't reach the page").
 */
export async function fetchTeamSchedule(
  opts: FetchScheduleOpts,
): Promise<ScheduleEntry[] | null> {
  if (opts.html !== undefined) {
    return parseScheduleHtml(opts.html);
  }
  const url = buildScheduleUrl({
    schoolSlug: opts.schoolSlug,
    state: opts.state,
  });
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const sleepFn = opts.sleepImpl ?? defaultSleep;
  await sleepFn(DEFAULT_SLEEP_MS);
  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
    };
    if (opts.cookie && opts.cookie.length > 0) {
      headers.Cookie = opts.cookie;
    }
    const res = await fetchFn(url, { redirect: 'follow', headers });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html || html.length < 200) return null;
    return parseScheduleHtml(html);
  } catch {
    return null;
  }
}
