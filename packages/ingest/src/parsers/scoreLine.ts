import type { ParseResult, ParsedScoreLine } from '@pll/shared';
import { normalizeUnicodeQuotes, normalizeWhitespace } from './text.js';

// Score line: "Team A 14, Team B 7" with optional "(3OT)" / ", OT" / ", ppd"
// or trailing bare " 2OT" / " OT" (Wave 12 Lane 1 — Darth 😈⚡: catches
// "Avon Grove 9, West Chester East 8 2OT").
// Strict shape: team names cannot contain `:`, `=`, or digits — this prevents
// quarter lines like "Easton: 6, 3, 3, 2 – 14" from being misread as scores.
const SCORE_RE =
  /^([A-Za-z][^,:=\d]*?)\s+(\d+)\s*,\s*([A-Za-z][^,:=\d]*?)\s+(\d+)(?:\s*[,;]?\s*\((\d+)?\s*OT\)|\s*,\s*OT|\s+(\d+)?\s*OT)?(?:\s*[,;]\s*(ppd|postponed))?\.?$/i;

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
const SCORE_RE_NOCOMMA = new RegExp(
  `^(${TEAM_TOKEN})${STATE_SUFFIX}\\s+(\\d+)\\s+(${TEAM_TOKEN})${STATE_SUFFIX}\\s+(\\d+)\\.?$`,
);

export function parseScoreLine(rawLine: string): ParseResult<ParsedScoreLine> {
  const line = normalizeWhitespace(normalizeUnicodeQuotes(rawLine));
  if (!line) return { result: null, anomalies: [] };

  // Trim a single trailing period that's just punctuation noise.
  const cleaned = line.replace(/\.+$/, '');
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

  const teamA = (m[1] ?? '').trim();
  const teamB = (m[3] ?? '').trim();
  const scoreA = Number(m[2]);
  const scoreB = Number(m[4]);
  // m[5] = parenthesized OT count; m[6] = bare-suffix OT count
  // (Wave 12 Lane 1 — Darth 😈⚡); m[7] = ppd token.
  const otRaw = usedNoComma ? undefined : (m[5] ?? m[6]);
  const ppdToken = usedNoComma ? undefined : m[7];

  // OT periods: "(3OT)" → 3, "(OT)" → 1, ", OT" → 1, " 2OT" → 2, none → 0.
  let otPeriods = 0;
  if (otRaw !== undefined) otPeriods = Number(otRaw);
  else if (/,\s*OT\b/i.test(cleaned)) otPeriods = 1;
  else if (/\(OT\)/i.test(cleaned)) otPeriods = 1;
  else if (/\s+OT$/i.test(cleaned)) otPeriods = 1;

  const postponed = !!ppdToken;

  return {
    result: { teamA, scoreA, teamB, scoreB, otPeriods, postponed },
    anomalies: [],
  };
}
