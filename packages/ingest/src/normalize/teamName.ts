/**
 * Canonicalize a team name extracted from rankings/scoreboard parsers.
 *
 * Strips trailing parenthetical suffixes that have crept into team names
 * via greedy parsing (district seeds, conference codes, district labels,
 * record/seed annotations, "last week" notes, etc.) while *preserving*
 * legitimate out-of-state 2-letter state markers used to disambiguate
 * from PA teams of the same name (e.g. "St. Anthony's (NY)").
 *
 * Rules:
 *   - Trim leading/trailing whitespace and collapse internal whitespace.
 *   - Repeatedly peel a trailing `(...)` group; preserve it iff its inner
 *     content is a known out-of-state 2-letter code, otherwise drop it.
 *
 * Throws on empty/whitespace-only input so callers don't accidentally
 * persist anonymous teams.
 */

const PRESERVED_STATE_CODES = new Set([
  'NJ', 'NY', 'DE', 'MD', 'VA', 'CT', 'MA', 'OH',
]);

function isPreservedState(inner: string): boolean {
  const t = inner.trim();
  return /^[A-Za-z]{2}$/.test(t) && PRESERVED_STATE_CODES.has(t.toUpperCase());
}

export function normalizeTeamName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new TypeError('normalizeTeamName: expected string');
  }
  let name = raw.replace(/\s+/g, ' ').trim();
  if (!name) {
    throw new Error('normalizeTeamName: empty team name');
  }

  // Repeatedly peel trailing parenthetical groups; stop when there is no
  // trailing group, when we hit a preserved state code (which we re-emit
  // canonicalized after also peeling any noise that preceded it), or when
  // stripping would leave the name empty.
  let preservedStateSuffix = '';
  for (;;) {
    const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!m) break;
    const head = (m[1] ?? '').trim();
    const inner = m[2] ?? '';
    if (isPreservedState(inner)) {
      if (preservedStateSuffix) {
        // Already captured one — duplicate trailing state codes, keep
        // the outermost (closest-to-name); drop this older one.
        name = head;
        continue;
      }
      preservedStateSuffix = ` (${inner.trim().toUpperCase()})`;
      name = head;
      continue;
    }
    if (!head) {
      // Whole name was just a parenthetical — keep original rather than
      // emit "".
      throw new Error('normalizeTeamName: name reduced to empty after stripping');
    }
    name = head;
  }

  return preservedStateSuffix ? `${name}${preservedStateSuffix}` : name;
}

