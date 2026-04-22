// PIAA District 1 Boys Lacrosse rankings ingest.
//
// Source: https://www.piaad1.org/sports/spring-sports/lacrosse-b/scores-and-rankings/
//
// The page contains one section per classification (e.g. "PIAA D1 3A Boys
// Lacrosse", "PIAA D1 2A Boys Lacrosse"), each with a striped table:
//   Seed | School | W | L | T | Total Points | Ranking
//
// Schools are uppercased (e.g. `BISHOP SHANAHAN`) and unranked teams use `-`
// for the seed. We expose both the title-cased display form and a normalized
// form for cross-referencing against our own `teams` table.

import * as cheerio from 'cheerio';

export interface PiaaTeamRow {
  classification: string;
  seed: number | null;
  nameOfficial: string;
  nameNormalized: string;
  wins: number;
  losses: number;
  ties: number;
  totalPoints: number;
  ranking: number;
}

export const PIAA_D1_RANKINGS_URL =
  'https://www.piaad1.org/sports/spring-sports/lacrosse-b/scores-and-rankings/';

/**
 * Title-case a school name from the all-caps form on PIAA pages while keeping
 * common short connectors lowercase. Acronyms of length 2-3 (e.g. "NJ", "NY",
 * "HS") are preserved as uppercase when they appear standalone.
 */
export function titleCaseSchool(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  const small = new Set(['of', 'and', 'the', 'in', 'for', 'at']);
  return text
    .split(' ')
    .map((word, i) => {
      if (!word) return word;
      // Preserve standalone short all-caps acronyms (NJ, NY, HS, II, III) —
      // only if the token, after stripping surrounding parens, is 2-3
      // uppercase letters. This intentionally does NOT match "ST." (has a
      // period) which should become "St.".
      const parenStripped = word.replace(/^\(|\)$/g, '');
      if (/^[A-Z]{2,3}$/.test(parenStripped)) return word;
      const lower = word.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      // Capitalize letter at start, after hyphens, and after periods.
      return lower.replace(/(^|[-.\s])([a-z])/g, (_m, p1, p2) => p1 + p2.toUpperCase());
    })
    .join(' ');
}

/**
 * Normalize a team name for cross-referencing across data sources.
 * Lowercases, strips punctuation, collapses whitespace, removes parenthetical
 * suffixes EXCEPT (nj)/(ny) which mark out-of-state teams.
 */
export function normalizeTeamName(raw: string): string {
  let s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  const stateMatch = s.match(/\((nj|ny)\)/);
  const stateTag = stateMatch ? ` (${stateMatch[1]})` : '';
  s = s.replace(/\s*\([^)]*\)/g, '');
  s = s.replace(/[^a-z0-9 ]+/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s + stateTag;
}

function parseInteger(text: string): number {
  const n = parseInt(text.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatSafe(text: string): number {
  const n = parseFloat(text.trim());
  return Number.isFinite(n) ? n : 0;
}

type CheerioTable = ReturnType<cheerio.CheerioAPI>;

function parseSectionTable(
  $: cheerio.CheerioAPI,
  classification: string,
  table: CheerioTable,
): PiaaTeamRow[] {
  const out: PiaaTeamRow[] = [];
  table.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;
    const seedText = $(tds.get(0)).text().replace(/\s+/g, ' ').trim();
    const schoolEl = $(tr).find('td[data-field="schoolName"]').first();
    const wEl = $(tr).find('td[data-field="wins"]').first();
    const lEl = $(tr).find('td[data-field="losses"]').first();
    const tEl = $(tr).find('td[data-field="ties"]').first();
    const schoolRaw = (schoolEl.length ? schoolEl.text() : $(tds.get(1)).text())
      .replace(/\s+/g, ' ')
      .trim();
    if (!schoolRaw) return;
    const wins = parseInteger((wEl.length ? wEl.text() : $(tds.get(2)).text()) || '0');
    const losses = parseInteger((lEl.length ? lEl.text() : $(tds.get(3)).text()) || '0');
    const ties = parseInteger((tEl.length ? tEl.text() : $(tds.get(4)).text()) || '0');
    // Last two numeric cells are Total Points + Ranking.
    const numericCells: number[] = [];
    tds.each((_i, el) => {
      const txt = $(el).text().replace(/\s+/g, ' ').trim();
      if (/^-?\d+(\.\d+)?$/.test(txt)) numericCells.push(parseFloatSafe(txt));
    });
    const totalPoints = numericCells.length >= 2 ? (numericCells[numericCells.length - 2] ?? 0) : 0;
    const ranking = numericCells.length >= 1 ? (numericCells[numericCells.length - 1] ?? 0) : 0;

    const seed = /^\d+$/.test(seedText) ? parseInteger(seedText) : null;
    const nameOfficial = titleCaseSchool(schoolRaw);
    out.push({
      classification,
      seed,
      nameOfficial,
      nameNormalized: normalizeTeamName(nameOfficial),
      wins,
      losses,
      ties,
      totalPoints,
      ranking,
    });
  });
  return out;
}

/** Parse the PIAA D1 boys lacrosse rankings page HTML into rows. */
export function parsePiaaHtml(html: string): PiaaTeamRow[] {
  const $ = cheerio.load(html);
  const rows: PiaaTeamRow[] = [];
  $('h3').each((_, h) => {
    const heading = $(h).text().replace(/\s+/g, ' ').trim();
    const m = heading.match(/PIAA\s+D1\s+(\d+A)\s+Boys\s+Lacrosse/i);
    if (!m || !m[1]) return;
    const classification = m[1].toUpperCase();
    // Find the next table after this heading; PIAA wraps it deeply, so search
    // among following siblings of the heading and its ancestors.
    let table = $(h).nextAll().find('table').first();
    if (!table.length) table = $(h).parent().nextAll().find('table').first();
    if (!table.length) {
      // Fallback: the table within the same containing block.
      table = $(h).closest('div').find('table').first();
    }
    if (!table.length) return;
    rows.push(...parseSectionTable($, classification, table));
  });
  return rows;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Fetch + parse the PIAA D1 boys lacrosse rankings. */
export async function fetchPiaaTeams(
  opts: { fetchFn?: FetchLike; url?: string } = {},
): Promise<PiaaTeamRow[]> {
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const url = opts.url ?? PIAA_D1_RANKINGS_URL;
  const res = await fetchFn(url, {
    headers: {
      'User-Agent':
        'philly-lacrosse-vis/0.1 (+https://github.com/) - fetching PIAA D1 official rankings',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`PIAA fetch failed: ${res.status}`);
  }
  const html = await res.text();
  return parsePiaaHtml(html);
}
