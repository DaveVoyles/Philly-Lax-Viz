import type { ParseResult, ParsedScoreLine } from '@pll/shared';
import { normalizeUnicodeQuotes, normalizeWhitespace } from './text.js';

/**
 * Strip a trailing 2-3 letter state-suffix parenthetical like "(NJ)",
 * "(OH)", "(MD)" from a team token. Wave 14 Lane 1 (Yoda 🧙‍♂️🟢):
 * out-of-state opponents on inquirer.com appear as "Notre Dame (NJ)".
 * The suffix breaks alias / initials matching ("WK" should match
 * "Worthington Kilbourne" but doesn't match "Worthington Kilbourne (OH)").
 * Strip here so downstream resolution sees only the bare team name.
 */
function stripTrailingStateSuffix(s: string): string {
  return s.replace(/\s*\([A-Z]{2,3}\)\s*$/i, '').trim();
}

/**
 * Pre-normalize a candidate score line so the strict SCORE_RE can match a few
 * common dirty-input variants we see in scoreboard posts:
 *
 *   1. Trailing comma garbage:   "Team A 7, Team B 4,"           → drop "," 
 *   2. Comma/period bare OT:     "...7 4, 2OT" / "...4. OT"      → "(2OT)"/"(OT)"
 *   3. District parenthetical:   "Abington Heights (district 2)" → strip
 *
 * Recovers ~11 score lines per scrape that previously slipped through and
 * caused all subsequent player-stat lines on the post to attribute to the
 * wrong game (the prior score line). See data/anomaly-triage.md for the
 * full failure inventory.
 */
function normalizeScoreLineInput(s: string): string {
  let r = s;
  // Strip district / division parenthetical that decorates a team token but
  // isn't part of the team name.
  r = r.replace(/\s*\((?:district\s+\d+|d\d+)\)/gi, '');
  // Drop a trailing junk comma (often a copy-paste artifact at end of line).
  r = r.replace(/,\s*$/, '');
  // Normalize OT variants written with comma or period instead of as a
  // standalone parenthetical:
  //   ", 2OT" / ", 2 OT" → " (2OT)"
  //   ". OT"  / ". 2OT"  → " (OT)"  / " (2OT)"
  r = r.replace(/[,.]\s*(\d+)?\s*OT\b/i, (_m, n) => ` (${n ? n : ''}OT)`);
  return r;
}

// Score line: "Team A 14, Team B 7" with optional "(3OT)" / ", OT" / ", ppd"
// or trailing bare " 2OT" / " OT" (Wave 12 Lane 1 — Darth 😈⚡: catches
// "Avon Grove 9, West Chester East 8 2OT").
// Strict shape: team names cannot contain `:`, `=`, or digits — this prevents
// quarter lines like "Easton: 6, 3, 3, 2 – 14" from being misread as scores.
//
// Wave 14 Lane 1 (Yoda 🧙‍♂️🟢): require team names of >= 3 chars OR
// multi-word. Single 1-2 char tokens like "PR", "DV", "AC" are sub-headers,
// not real teams — letting them match here is what created the score-line
// ghost-team artifacts (Easton vs Pennridge "PR" sub-header, etc).
// Wave 15 Lane 1 (Chewy 🐻💪): allow an optional trailing event-annotation
// parenthetical AFTER the second score (and after any OT / ppd clause), e.g.
// "Avon Grove 9, Wissahickon 8 (Cole's Goals Benefit)" or
// "Penn 10, Trinity 7 OT (Senior Day)". Captured but unused — not part of
// either team name. Recovers ~10 games/year that previously failed to parse.
const SCORE_RE =
  /^([A-Za-z][A-Za-z'.\-]{2,}(?:[^,:=\d]*?)?|[A-Za-z][^,:=\d]*?\s+[A-Za-z][^,:=\d]*?)\s+(\d+)\s*,\s*([A-Za-z][A-Za-z'.\-]{2,}(?:[^,:=\d]*?)?|[A-Za-z][^,:=\d]*?\s+[A-Za-z][^,:=\d]*?)\s+(\d+)(?:\s*[,;]?\s*\((\d+)?\s*OT\)|\s*,\s*OT|\s+(\d+)?\s*OT)?(?:\s*[,;]\s*(ppd|postponed))?(?:\s*\(([^)]+)\))?\.?$/i;

// Comma-less form: "Twin Valley 17 Daniel Boone 1". Both team names must be
// title-cased multi-word phrases (every word starts with a capital letter or is
// an all-caps abbreviation). This is intentionally strict to avoid false
// matches against player-stat lines like "Player Name 5 goals 2".
//
// Each team must be EITHER (a) at least one word of >= 3 chars, OR (b) a
// multi-word phrase. Single-word 1-2 char tokens like "TV", "DV", "AC" are
// rejected — those are sub-headers / abbreviations, not full team names, and
// matching them creates ghost team rows in the database.
//
// Wave 12 Lane 1 (Darth 😈⚡): allow an optional state-suffix parenthetical
// `(NJ)` / `(NY)` / `(MD)` after either team name to catch lines like
// "Notre Dame (NJ) 21 Pennsbury 10" that previously slipped through and
// caused the Bishop Shanahan / Pennsbury cross-game contamination.
const TEAM_TOKEN = `(?:[A-Z][A-Za-z'.\\-]{2,}|[A-Z][A-Za-z'.\\-]*(?:\\s+(?:[A-Z][A-Za-z'.\\-]*|of|the|at))+)`;
const STATE_SUFFIX = `(?:\\s*\\([A-Z]{2,3}\\))?`;
// Wave 15 Lane 1 (Chewy 🐻💪): allow optional trailing OT clause and an
// event-annotation paren on the no-comma form too: "Penn 10 Trinity 7 OT
// (Senior Day)". Both groups are captured (m[5] OT count, m[6] event text)
// but only OT affects the parsed result.
const SCORE_RE_NOCOMMA = new RegExp(
  `^(${TEAM_TOKEN})${STATE_SUFFIX}\\s+(\\d+)\\s+(${TEAM_TOKEN})${STATE_SUFFIX}\\s+(\\d+)(?:\\s+(\\d+)?\\s*OT)?(?:\\s*\\(([^)]+)\\))?\\.?$`,
);

export function parseScoreLine(rawLine: string): ParseResult<ParsedScoreLine> {
  const line = normalizeWhitespace(normalizeUnicodeQuotes(rawLine));
  if (!line) return { result: null, anomalies: [] };

  // Trim a single trailing period that's just punctuation noise.
  const cleaned = normalizeScoreLineInput(line.replace(/\.+$/, ''));
  let m = cleaned.match(SCORE_RE);
  let usedNoComma = false;
  if (!m) {
    // Try comma-less fallback: "Team A N Team B N".
    const m2 = cleaned.match(SCORE_RE_NOCOMMA);
    if (m2) {
      m = m2;
      usedNoComma = true;
    }
  }
  if (!m) {
    return {
      result: null,
      anomalies: [
        {
          rawLine,
          strategyAttempted: 'score-line',
          reason: 'score line did not match Team A N, Team B N pattern',
        },
      ],
    };
  }

  const teamA = stripTrailingStateSuffix((m[1] ?? '').trim());
  const teamB = stripTrailingStateSuffix((m[3] ?? '').trim());
  const scoreA = Number(m[2]);
  const scoreB = Number(m[4]);
  // SCORE_RE: m[5] = parenthesized OT count; m[6] = bare-suffix OT count
  // (Wave 12 Lane 1 — Darth 😈⚡); m[7] = ppd token; m[8] = event-annotation
  // paren content (Wave 15 Lane 1 — Chewy 🐻💪, ignored).
  // SCORE_RE_NOCOMMA: m[5] = bare OT count, m[6] = event-annotation
  // paren content (ignored).
  const otRaw = usedNoComma ? m[5] : (m[5] ?? m[6]);
  const ppdToken = usedNoComma ? undefined : m[7];

  // OT periods: "(3OT)" → 3, "(OT)" → 1, ", OT" → 1, " 2OT" → 2, none → 0.
  let otPeriods = 0;
  if (otRaw !== undefined) otPeriods = Number(otRaw);
  else if (/,\s*OT\b/i.test(cleaned)) otPeriods = 1;
  else if (/\(OT\)/i.test(cleaned)) otPeriods = 1;
  else if (/\s+OT$/i.test(cleaned)) otPeriods = 1;
  // Wave 15 Lane 1 (Chewy 🐻💪): bare " OT" followed by an event-annotation
  // paren — e.g. "Penn 10 Trinity 7 OT (Senior Day)" — needs to count as 1 OT.
  else if (/\s+OT\s*\([^)]+\)\s*\.?$/i.test(cleaned)) otPeriods = 1;

  const postponed = !!ppdToken;

  return {
    result: { teamA, scoreA, teamB, scoreB, otPeriods, postponed },
    anomalies: [],
  };
}
