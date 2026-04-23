// seasonPicker.ts — Wave 18 W1L2: season is locked to 2026.
//
// The picker UI is hidden entirely. currentSeason() always returns 2026.
// Pure hash/URL helpers are kept for back-compat with callers that import
// them; the storage/URL/listener machinery does not run.

export const SEASON_QUERY_KEY = 'season';
export const ALL_SEASONS = 'all' as const;

export type SeasonValue = number | typeof ALL_SEASONS;

export interface SeasonsResponse {
  seasons: number[];
  default: number | null;
}

const LOCKED_SEASON = 2026;

// Kept for back-compat. Listeners are never invoked in locked mode.
const listeners = new Set<(s: SeasonValue | null) => void>();

export function onSeasonChange(fn: (s: SeasonValue | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Parse a raw string (URL or storage) into a SeasonValue, or null. */
export function parseSeasonValue(raw: string | null | undefined): SeasonValue | null {
  if (raw == null || raw === '') return null;
  if (raw === ALL_SEASONS) return ALL_SEASONS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null;
  return n;
}

export function seasonValueToString(v: SeasonValue): string {
  return v === ALL_SEASONS ? ALL_SEASONS : String(v);
}

/** Always returns 2026 — season picker is locked. */
export function currentSeason(): SeasonValue | null {
  return LOCKED_SEASON;
}

/** Returns [2026] — only the locked season is available. */
export function availableSeasons(): readonly number[] {
  return [LOCKED_SEASON];
}

/** Returns 2026 — locked. */
export function defaultSeason(): number {
  return LOCKED_SEASON;
}

/** Read selection from URL hash query, then localStorage, else default. */
export function pickInitialSeason(
  hashQuery: string | undefined,
  stored: string | null,
  serverDefault: number | null,
): SeasonValue | null {
  return (
    parseSeasonValue(hashQuery) ??
    parseSeasonValue(stored) ??
    (serverDefault === null ? null : serverDefault)
  );
}

/** Read the `season=` value from a hash like "#/teams?season=2025". */
export function readSeasonFromHash(hash: string): string | undefined {
  const noHash = hash.replace(/^#/, '');
  const q = noHash.indexOf('?');
  if (q < 0) return undefined;
  const usp = new URLSearchParams(noHash.slice(q + 1));
  return usp.get(SEASON_QUERY_KEY) ?? undefined;
}

/** Return a new hash with `season=` set (or removed when `value` is null). */
export function withSeasonInHash(hash: string, value: SeasonValue | null): string {
  const noHash = hash.replace(/^#/, '') || '/';
  const q = noHash.indexOf('?');
  const path = q >= 0 ? noHash.slice(0, q) : noHash;
  const usp = new URLSearchParams(q >= 0 ? noHash.slice(q + 1) : '');
  if (value === null) {
    usp.delete(SEASON_QUERY_KEY);
  } else {
    usp.set(SEASON_QUERY_KEY, seasonValueToString(value));
  }
  const qs = usp.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/** No-op — season is locked; state mutations are ignored. */
export function setSeason(_value: SeasonValue | null, _opts: { persist?: boolean } = {}): void {
  // locked to 2026; mutations are intentionally ignored
}

/**
 * No-op mount — picker is hidden. Returns a detached element for type compat.
 */
export function mountSeasonPicker(
  _host: HTMLElement,
  _opts: { onChange: (value: SeasonValue) => void },
): HTMLSelectElement {
  return document.createElement('select');
}

/**
 * No-op init — always resolves to 2026 without a network request.
 */
export async function initSeasonPicker(_opts: {
  fetchSeasons?: () => Promise<SeasonsResponse>;
  hashQuery?: string;
} = {}): Promise<SeasonValue | null> {
  return LOCKED_SEASON;
}

/** Test-only reset. Not exported through index. */
export function __resetForTests(): void {
  listeners.clear();
}
