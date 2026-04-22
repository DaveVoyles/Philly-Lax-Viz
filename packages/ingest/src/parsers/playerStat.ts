import type { ParseResult, ParsedPlayerStat } from '@pll/shared';
import { normalizeUnicodeQuotes, normalizeWhitespace, stripTrailingNonStatParenthetical } from './text.js';

const NAME_CHARS = "A-Za-z'.\\-";

interface StatBuckets {
  goals: number;
  assists: number;
  groundBalls: number;
  causedTurnovers: number;
  saves: number;
  foWon: number;
  foTaken: number;
}

function emptyStats(): StatBuckets {
  return {
    goals: 0,
    assists: 0,
    groundBalls: 0,
    causedTurnovers: 0,
    saves: 0,
    foWon: 0,
    foTaken: 0,
  };
}

/**
 * Parse the stat fragment of a player line (everything after the name) into
 * stat buckets. Returns the buckets plus a flag indicating whether at least
 * one stat token was matched.
 */
export function parseStatTokens(rawStats: string): { stats: StatBuckets; matched: boolean } {
  const stats = emptyStats();
  let matched = false;
  // Normalize separators so each token is space-delimited and case-insensitive.
  // NOTE: do NOT strip `/` or `-` — they're meaningful inside FO patterns
  // (`16/18 FO`, `10-for-17 FO`).
  const text = rawStats
    .replace(/[\(\)\[\]]/g, ' ')
    .replace(/,/g, ' ')
    // Normalize "X-for-Y" → "X/Y" so the FO regex catches it uniformly.
    .replace(/(\d+)\s*-\s*for\s*-\s*(\d+)/gi, '$1/$2');

  // Faceoff variants first (most specific) — both "X/Y FO" / "X-for-Y FO" /
  // "X-Y FO" and the inverted "FO X/Y".
  const foPatterns: RegExp[] = [
    /(\d+)\s*(?:[\/\-]|\s+for\s+)\s*(\d+)\s*FO(?:'?s)?/gi,
    /\bFO(?:'?s)?\s+(\d+)\s*[\/\-]\s*(\d+)/gi,
  ];
  let foConsumed = '';
  for (const re of foPatterns) {
    foConsumed += text.replace(re, (_full, w: string, t: string) => {
      stats.foWon += Number(w);
      stats.foTaken += Number(t);
      matched = true;
      return ' ';
    });
  }

  // Strip FO matches from the text we scan further.
  let remaining = text;
  for (const re of foPatterns) remaining = remaining.replace(re, ' ');

  // Lone FO token (e.g. "Mason Westwood 8/16 FO" with the X/Y already eaten,
  // but "8/16" without trailing FO would have been caught above). If there's a
  // bare X/Y followed eventually by " FO" we already handled it — if not, the
  // X/Y is ambiguous and we leave it alone.

  // Stat tokens — pattern: <int> <token>. Token vocabulary captured in alts.
  const statRe =
    /(\d+)\s*(goals?|assists?|ground\s*balls?|gbs?|ctos?|saves?|sv|g|a)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = statRe.exec(remaining)) !== null) {
    const n = Number(m[1]);
    const tok = (m[2] ?? '').toLowerCase().replace(/\s+/g, '');
    matched = true;
    if (tok === 'g' || tok === 'goal' || tok === 'goals') stats.goals += n;
    else if (tok === 'a' || tok === 'assist' || tok === 'assists') stats.assists += n;
    else if (tok === 'gb' || tok === 'gbs' || tok === 'groundball' || tok === 'groundballs') stats.groundBalls += n;
    else if (tok === 'cto' || tok === 'ctos') stats.causedTurnovers += n;
    else if (tok === 'sv' || tok === 'save' || tok === 'saves') stats.saves += n;
  }

  void foConsumed; // referenced for clarity; not used downstream
  return { stats, matched };
}

/**
 * Parse a player-stat line of the form "<Name> <stats>" where stats are any
 * combination of goal/assist/groundball/save/cto/faceoff tokens.
 */
export function parsePlayerStatLine(rawLine: string): ParseResult<ParsedPlayerStat> {
  const line0 = normalizeWhitespace(normalizeUnicodeQuotes(rawLine));
  if (!line0) return { result: null, anomalies: [] };

  // Strip trailing non-stat parenthetical (e.g. "(200 career points)").
  const line = stripTrailingNonStatParenthetical(line0);

  // Find the boundary between name and stats:
  //   - first run of digits, OR
  //   - first em/en/regular dash followed by space + digit/letter, OR
  //   - first opening paren.
  // We match the leading name as a sequence of name-words.
  const nameMatch = line.match(
    new RegExp(`^([${NAME_CHARS}]+(?:\\s+[${NAME_CHARS}]+)*)\\s*[\\-–—]?\\s*(.*)$`, 'u'),
  );
  if (!nameMatch) {
    return {
      result: null,
      anomalies: [
        { rawLine, strategyAttempted: 'player-stat-line', reason: 'could not extract name prefix' },
      ],
    };
  }

  let name = (nameMatch[1] ?? '').trim();
  const rest = (nameMatch[2] ?? '').trim();

  // Strip a trailing "Goals:" / "scoring" / similar that snuck into the name.
  name = name.replace(/\s+(?:Scoring|Stats)$/i, '').trim();

  // Find the boundary between name and stats:
  //   - first run of digits, OR
  //   - first opening paren, OR
  //   - first standalone "FO" token (covers "Hunter Farren FO 12/13").
  const firstStatChar = line.search(/[\(\d]/);
  const foMatch = line.match(/\bFO\b/i);
  const firstFOIdx = foMatch && typeof foMatch.index === 'number' ? foMatch.index : -1;
  let firstStatIdx = firstStatChar;
  if (firstFOIdx > 0 && (firstStatIdx < 0 || firstFOIdx < firstStatIdx)) {
    firstStatIdx = firstFOIdx;
  }
  if (firstStatIdx > 0) {
    let candidate = line.slice(0, firstStatIdx).trim();
    // Drop a trailing dash if present.
    candidate = candidate.replace(/[\s\-–—]+$/u, '').trim();
    if (candidate) name = candidate;
  }

  const statsText = firstStatIdx > 0 ? line.slice(firstStatIdx) : rest;

  // Wave 5 Lane 1 — possessive parser fix (Appendix C).
  // Inputs like "Dylan Bella's 4 goals" or "Ryan's Turse 2 assists" capture
  // the possessive into the name. Strip CONSERVATIVELY:
  //   - trailing "'s" at end of name (Bella's → Bella)
  //   - mid-name "'s " between two name tokens (Ryan's Turse → Ryan Turse)
  // Both patterns are absent from real lacrosse names: Irish surnames like
  // O'Kane, O'Leary, D'Annunzio never end in "'s" and never contain "'s ".
  // Only apply when the line actually has stat tokens following — i.e. only
  // run this stripping when we identified a stat boundary.
  if (firstStatIdx > 0) {
    name = name.replace(/'s$/u, '');
    name = name.replace(/([A-Za-z])'s\s+([A-Z])/u, '$1 $2');
    name = name.trim();
  }

  if (!name) {
    return {
      result: null,
      anomalies: [
        { rawLine, strategyAttempted: 'player-stat-line', reason: 'empty player name' },
      ],
    };
  }

  const { stats, matched } = parseStatTokens(statsText);

  if (!matched) {
    // No stat tokens at all → this isn't a player-stat line.
    return {
      result: null,
      anomalies: [
        {
          rawLine,
          strategyAttempted: 'player-stat-line',
          reason: 'no stat tokens recognized in line',
        },
      ],
    };
  }

  const isPartialName = !/\s/.test(name); // single token = last name only

  return {
    result: {
      name,
      ...stats,
      isPartialName,
      confidence: isPartialName ? 0.6 : 0.9,
    },
    anomalies: [],
  };
}
