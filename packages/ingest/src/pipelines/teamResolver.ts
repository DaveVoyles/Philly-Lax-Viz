// teamResolver.ts — normalize raw team names and resolve to a `teams` row id.
// Pure SQL helpers (no async). Used by all three pipelines so name-normalization
// rules live in exactly one place.

import type { Database } from 'better-sqlite3';

export interface TeamRow {
  id: number;
  name: string;
  slug: string;
}

/**
 * Normalize a team name for equality matching:
 *   - lowercase
 *   - strip trailing " HS" / " High School" / " H.S." suffix
 *   - collapse internal whitespace
 *   - trim leading/trailing whitespace
 *   - drop trailing punctuation (`.`, `,`, `:`)
 *   - normalize curly quotes to straight single quote
 *   - normalize en/em dashes to plain hyphen
 */
export function normalizeTeamName(raw: string): string {
  if (!raw) return '';
  let s = raw
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ');
  s = s.toLowerCase().trim();
  // Drop trailing HS / High School / H.S. suffixes.
  s = s.replace(/\s+(?:high\s+school|h\.?\s*s\.?)$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[\.,:;]+$/u, '').trim();
  return s;
}

/**
 * Strip trailing "Scorers / Scoring / Stats / Goals / Leaders / Notes"
 * sub-header suffixes (with optional trailing colon) from a raw team token.
 *
 * Wave 11 Lane 1 (Chewy 🐻💪): summaries posts use sub-headers like
 *   "DV Scorers", "Episcopal Scorers:", "Haverford Stats:", "CBW Scoring"
 * to introduce a per-team player block. The bare team token ("DV", "CBW")
 * is what aliases / `teams.name` map against, but the suffix words and
 * punctuation prevent the lookup from succeeding. Stripping happens BEFORE
 * `normalizeTeamName` so callers can pass raw header lines directly.
 *
 * Wave 13 Lane 1 (Chewy 🐻💪): also peel section-only keywords
 * ("Goalie", "Goalies", "Faceoffs", "Ground Balls", "GBs", "Saves",
 * "FACEOFFS:") from the trailing edge so headers like "CBW FACEOFFS:" or
 * "Springfield Goalies:" reduce to the bare team token. A pure section
 * header with no team prefix ("Goalie", "Goalies:") collapses to empty
 * string — the caller treats that as "no hint, default to home".
 *
 * Idempotent and case-insensitive.
 */
const SUB_HEADER_SUFFIX_RE =
  /\s+(?:scorers?|scoring|stats?|goals?|assists?|saves?|leaders?|notes?)\s*:?\s*$/i;
// Wave 13: section-only suffix words. Matched on the WHOLE remaining string
// or as a leading/trailing word; a bare match collapses the token to ''.
const SECTION_ONLY_RE =
  /^(?:goalies?|faceoffs?|ground\s*balls?|gbs?|saves?|ctos?|caused\s*turnovers?|shots?)\s*:?\s*$/i;
const SECTION_TRAILING_RE =
  /\s+(?:goalies?|faceoffs?|ground\s*balls?|gbs?|ctos?|caused\s*turnovers?|shots?)\s*:?\s*$/i;
export function normalizeTeamToken(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(/\u00A0/g, ' ').trim();
  // Peel suffix words; loop in case of e.g. "X Scoring Stats".
  for (let i = 0; i < 3; i++) {
    const next = s
      .replace(SUB_HEADER_SUFFIX_RE, '')
      .replace(SECTION_TRAILING_RE, '')
      .trim();
    if (next === s) break;
    s = next;
  }
  // If what remains is itself a bare section keyword, collapse to empty.
  if (SECTION_ONLY_RE.test(s)) return '';
  // Drop trailing punctuation (": .,;") that survives suffix stripping —
  // e.g. "CB South:" → "CB South".
  s = s.replace(/[\s:.,;]+$/u, '').trim();
  return s;
}

/** Slug from a normalized team name: spaces → "-", strip non-[a-z0-9-]. */
export function slugifyTeamName(normalized: string): string {
  return normalized
    .replace(/'/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface ExistingTeamRow {
  id: number;
  name: string;
  slug: string;
}

interface AliasRow {
  team_id: number;
}

/**
 * Look up a team by raw name WITHOUT inserting. Returns null if no match.
 * Use this for boundary-detection paths where we want to check whether a
 * sub-header refers to a known team without creating a new team row from
 * what may be a stray abbreviation or noise token.
 */
export function findTeamByName(db: Database, rawName: string): TeamRow | null {
  // Strip sub-header suffix words ("X Scorers:", "X Stats") before
  // normalization so alias/exact-name lookups see just the team token.
  const cleaned = normalizeTeamToken(rawName);
  const normalized = normalizeTeamName(cleaned);
  if (!normalized) return null;

  const aliasRow = db
    .prepare('SELECT team_id FROM team_aliases WHERE alias = ?')
    .get(normalized) as AliasRow | undefined;
  if (aliasRow) {
    const team = db
      .prepare('SELECT id, name, slug FROM teams WHERE id = ?')
      .get(aliasRow.team_id) as ExistingTeamRow | undefined;
    if (team) return team;
  }

  const allTeams = db
    .prepare('SELECT id, name, slug FROM teams')
    .all() as ExistingTeamRow[];
  for (const t of allTeams) {
    if (normalizeTeamName(t.name) === normalized) return t;
  }
  return null;
}

/**
 * Resolve a raw team name to a `teams` row, inserting if not found. Lookup
 * order: alias → existing team (normalized name match) → insert new team.
 */
export function resolveTeam(db: Database, rawName: string): TeamRow {
  const cleaned = normalizeTeamToken(rawName);
  const normalized = normalizeTeamName(cleaned);
  if (!normalized) {
    throw new Error(`resolveTeam: empty team name (raw=${JSON.stringify(rawName)})`);
  }

  const aliasRow = db
    .prepare('SELECT team_id FROM team_aliases WHERE alias = ?')
    .get(normalized) as AliasRow | undefined;
  if (aliasRow) {
    const team = db
      .prepare('SELECT id, name, slug FROM teams WHERE id = ?')
      .get(aliasRow.team_id) as ExistingTeamRow | undefined;
    if (team) return team;
  }

  const allTeams = db
    .prepare('SELECT id, name, slug FROM teams')
    .all() as ExistingTeamRow[];
  for (const t of allTeams) {
    if (normalizeTeamName(t.name) === normalized) return t;
  }

  const displayName = (cleaned || rawName).trim().replace(/\s+/g, ' ');
  const baseSlug = slugifyTeamName(normalized) || `team-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM teams WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const info = db
    .prepare(`INSERT INTO teams (name, slug, division) VALUES (?, ?, 'high-school')`)
    .run(displayName, slug);
  const id = Number(info.lastInsertRowid);
  return { id, name: displayName, slug };
}
