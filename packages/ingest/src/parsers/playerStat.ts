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
  // Strip trailing punctuation noise ("Kropp:" → "Kropp").
  name = name.replace(/[:;,]+$/u, '').trim();

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
    // Drop trailing punctuation that isn't part of a name (`:`, `,`, `;`, `.`).
    // Real names like "Jr." retain "." inside; we only strip when at end and
    // not preceded by a single uppercase letter (to keep "T.J." style intact).
    candidate = candidate.replace(/[:;,]+$/u, '').trim();
    candidate = candidate.replace(/(?<![A-Z])\.+$/u, '').trim();
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

  // Sanity caps — flag and clamp impossible single-game stat values. These
  // bounds are well above the realistic HS lacrosse ceiling (e.g. an entire
  // team rarely scores >20 goals in a game, so a single player at >15 is
  // almost always a parser glitch like "1G (Set School record 173 Goals)").
  const STAT_CAPS = {
    goals: 15,
    assists: 15,
    groundBalls: 30,
    causedTurnovers: 20,
    saves: 40,
    foWon: 40,
    foTaken: 50,
  } as const;
  const capAnomalies: ParseResult<ParsedPlayerStat>['anomalies'] = [];
  let clampedAny = false;
  for (const k of Object.keys(STAT_CAPS) as Array<keyof typeof STAT_CAPS>) {
    if (stats[k] > STAT_CAPS[k]) {
      capAnomalies.push({
        rawLine,
        strategyAttempted: 'stat-cap-exceeded',
        reason: `${k}=${stats[k]} exceeds cap ${STAT_CAPS[k]} for "${name}"; clamped to 0`,
      });
      stats[k] = 0;
      clampedAny = true;
    }
  }
  // If the line was *only* an over-cap value (no other meaningful stats), drop
  // the row entirely so we don't insert an empty stat record.
  if (clampedAny) {
    const total =
      stats.goals + stats.assists + stats.groundBalls +
      stats.causedTurnovers + stats.saves + stats.foWon + stats.foTaken;
    if (total === 0) {
      return { result: null, anomalies: capAnomalies };
    }
  }

  const isPartialName = !/\s/.test(name); // single token = last name only

  return {
    result: {
      name,
      ...stats,
      isPartialName,
      confidence: isPartialName ? 0.6 : 0.9,
    },
    anomalies: capAnomalies,
  };
}

/**
 * Split a composite player name string like "Mason Proctor and Javier
 * Gonzalez-Cruz" or "X, Y, and Z" (Oxford comma) into individual names.
 *
 * Wave H5 Lane 1 — fixes a parser bug where source text such as
 *   "Mason Proctor and Javier Gonzalez-Cruz 19/22 FO"
 * was kept as one literal player row. Now we split on `\s+and\s+`
 * (case-insensitive, word-bounded) and `,` separators, then validate that
 * each side looks name-like (has a capitalized token of >=2 chars). This
 * guards against false positives in legitimate names that contain "and"
 * as a substring (e.g. "Roland Anderson") — those don't match the
 * `\s+and\s+` boundary in the first place, but the name-like check is
 * a second safety net.
 *
 * Returns a single-element array when the input doesn't look composite.
 */
export function splitCompositeNames(rawName: string): string[] {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return [];

  // Normalize Oxford "..., and X" → "..., X" so the comma split catches it.
  const normalized = name.replace(/,\s+and\s+/gi, ', ');
  const parts = normalized
    .split(/\s*,\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length <= 1) return [name];

  // Each piece must look name-like: starts with a capital letter and is
  // at least 2 chars (so "Co", "an" stragglers don't count).
  const isNameLike = (p: string) => /^[A-Z][A-Za-z'\.\-]+/.test(p);
  if (!parts.every(isNameLike)) return [name];

  return parts;
}
