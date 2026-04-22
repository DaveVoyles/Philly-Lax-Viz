import type { ParseResult, ParsedQuarterLine } from '@pll/shared';
import { normalizeUnicodeQuotes, normalizeWhitespace } from './text.js';

/**
 * Parse a quarter line like:
 *   "Spring-Ford 3 1 5 1 - 10"
 *   "MHS 5-7-1-2=15"
 *   "Easton: 6, 3, 3, 2 - 14"
 *   "Garnet Valley 4 2. 5. 3. =14"
 *   "Parkland: 1-4-0-2-0-0-1=8"
 *
 * Strategy: extract all integers; the last integer is the *total* iff the sum
 * of the others equals it. Otherwise the line is recorded as an anomaly with
 * `validates=false` (still emits a result so callers can store the partial
 * data and a human can review).
 */
export function parseQuarterLine(
  rawLine: string,
  knownTeams: [string, string],
): ParseResult<ParsedQuarterLine> {
  const line = normalizeWhitespace(normalizeUnicodeQuotes(rawLine));
  if (!line) return { result: null, anomalies: [] };

  // Pull all unsigned integer tokens.
  const ints = Array.from(line.matchAll(/\d+/g)).map(m => Number(m[0]));
  if (ints.length < 2) {
    return {
      result: null,
      anomalies: [
        {
          rawLine,
          strategyAttempted: 'quarter-line',
          reason: 'fewer than 2 integers found in quarter line',
        },
      ],
    };
  }

  // Team hint = text before the first integer (strip trailing colon/dash/=).
  const firstIntIdx = line.search(/\d/);
  let teamHintRaw = firstIntIdx > 0 ? line.slice(0, firstIntIdx) : '';
  teamHintRaw = teamHintRaw.replace(/[\s:=\-–—.,]+$/u, '').trim();

  // Quarter line should start with a team-name token (letters or abbreviation).
  // If we don't see at least one alphabetic char before the digits, it's not a
  // quarter line.
  if (!/[A-Za-z]/.test(teamHintRaw)) {
    return {
      result: null,
      anomalies: [
        {
          rawLine,
          strategyAttempted: 'quarter-line',
          reason: 'no team hint found before integers',
        },
      ],
    };
  }

  const last = ints[ints.length - 1]!;
  const periods = ints.slice(0, -1);
  const sumPeriods = periods.reduce((a, b) => a + b, 0);

  const validates = sumPeriods === last && periods.length >= 1;

  // Resolve hint against knownTeams by initial-letter match (best-effort).
  const teamHint = resolveTeamHint(teamHintRaw, knownTeams);

  if (!validates) {
    return {
      result: { teamHint, periods, total: last, validates: false },
      anomalies: [
        {
          rawLine,
          strategyAttempted: 'quarter-line',
          reason: `sum mismatch: ${periods.join('+')} != ${last}`,
        },
      ],
    };
  }

  // Pad to at least 4 periods so downstream code can assume a regulation game.
  // We do NOT fabricate goals — we leave the array as-is. Length < 4 is a
  // soft anomaly that callers may choose to surface.
  const anomalies = periods.length < 4
    ? [
        {
          rawLine,
          strategyAttempted: 'quarter-line' as const,
          reason: `only ${periods.length} period(s) found; expected >= 4`,
        },
      ]
    : [];

  return {
    result: { teamHint, periods, total: last, validates: true },
    anomalies,
  };
}

function resolveTeamHint(hint: string, knownTeams: [string, string]): string {
  if (!hint) return hint;
  const lc = hint.toLowerCase();
  for (const t of knownTeams) {
    if (t.toLowerCase() === lc) return t;
  }
  // Initial-letter match (e.g. "MHS" → "Methacton High School", "PV" → "Perkiomen Valley")
  for (const t of knownTeams) {
    const initials = t
      .split(/[\s\-]+/)
      .map(w => w[0])
      .filter(Boolean)
      .join('')
      .toUpperCase();
    if (initials === hint.replace(/[^A-Za-z]/g, '').toUpperCase()) return t;
  }
  // Substring match (e.g. "MHS" inside "Methacton" — first letters of words).
  for (const t of knownTeams) {
    if (t.toLowerCase().startsWith(lc) || lc.startsWith(t.toLowerCase().split(/\s/)[0]!.toLowerCase())) {
      return t;
    }
  }
  return hint;
}
