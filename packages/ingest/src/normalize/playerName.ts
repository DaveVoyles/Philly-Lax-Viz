/**
 * Canonicalize a player name extracted from summary/boxscore parsers.
 *
 * Modeled after `normalizeTeamName` (Wave 2 team dedup). The output is a
 * stable lookup key used in the UNIQUE (team_id, name_normalized) index
 * on the `players` table — so two raw spellings that refer to the same
 * person on the same team must reduce to the same string.
 *
 * Rules (in order):
 *   1. NFKD-normalize and strip combining diacritics (José → jose).
 *   2. Lowercase.
 *   3. Smart quotes → straight ASCII apostrophe ('Connor's → 'connor's).
 *   4. Replace en/em dashes with a regular space (parser noise from
 *      "NOTES – Owen Fehnel made…" lines).
 *   5. Drop characters outside [a-z0-9 .'-]. This kills colons, commas,
 *      semicolons, parentheses, hashes, etc.
 *   6. Strip a period that immediately follows a single-letter initial
 *      ("h. moyer" → "h moyer", "e. harding goalie" → "e harding goalie")
 *      so initial-with-period and initial-without-period collapse together.
 *   7. Strip trailing standalone suffix tokens (jr, sr, ii, iii, iv) —
 *      none observed in current corpus, included preventively.
 *   8. Strip a trailing position-annotation token (`goalie`, `attack`,
 *      `midfield`, `defense`) — these leak in from "E. Harding, goalie,"
 *      summary lines after step 5 strips the commas.
 *   9. Drop any trailing punctuation left over (`.`, `'`, `-`).
 *  10. Collapse internal whitespace and trim.
 *  11. Map known sentinel non-names ("none", "no name provided", "tbd",
 *      "unknown", "n/a") to the empty string so callers can skip them
 *      via the existing empty-name anomaly path in summaries.ts.
 *
 * The function is pure and idempotent: `normalizePlayerName(x) ===
 * normalizePlayerName(normalizePlayerName(x))` for any input.
 *
 * Returns an empty string for empty / whitespace-only / sentinel input
 * — callers MUST treat that as "skip and log anomaly", matching the
 * current contract of the inline normalizer in pipelines/summaries.ts.
 */

const POSITION_TOKENS = new Set(['goalie', 'attack', 'midfield', 'defense']);
const SUFFIX_TOKENS = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
const SENTINEL_NON_NAMES = new Set([
  '',
  'none',
  'no name provided',
  'no names provided',
  'tbd',
  'unknown',
  'n/a',
  'n a',
  'na',
]);

export function normalizePlayerName(raw: string): string {
  if (typeof raw !== 'string') return '';

  let s = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/[^a-z0-9 .'-]/g, ' ');

  s = s.replace(/(\b[a-z])\./g, '$1');

  let tokens = s.split(/\s+/).filter(Boolean);

  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!.replace(/[.'-]+$/g, '');
    if (POSITION_TOKENS.has(last) || SUFFIX_TOKENS.has(last)) {
      tokens.pop();
      continue;
    }
    break;
  }

  s = tokens.join(' ').replace(/[.'-]+$/g, '').replace(/\s+/g, ' ').trim();

  if (SENTINEL_NON_NAMES.has(s)) return '';
  return s;
}
