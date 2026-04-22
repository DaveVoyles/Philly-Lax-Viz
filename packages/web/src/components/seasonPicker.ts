// seasonPicker.ts — header dropdown that scopes every API call to a season.
//
// Wave 14 Lane 2 (Han). Schema/server-side support shipped by Leia (W13 L2);
// this module owns:
//   * fetching /api/seasons,
//   * persisting the user's choice in localStorage,
//   * exposing a `currentSeason()` value that api.ts threads onto every
//     request as `?season=YYYY` (or `?season=all`),
//   * mutating the URL hash so deep links carry the season.
//
// "Default season" semantics: when the user has not picked a season we treat
// it as the most-recent season returned by /api/seasons. We still send the
// query param explicitly so back-end behavior is unambiguous and shareable
// links stay stable even if a newer season later appears in the DB.

const STORAGE_KEY = 'pll.season';
export const SEASON_QUERY_KEY = 'season';
export const ALL_SEASONS = 'all' as const;

export type SeasonValue = number | typeof ALL_SEASONS;

export interface SeasonsResponse {
  seasons: number[];
  default: number | null;
}

interface State {
  available: number[];
  defaultSeason: number | null;
  selected: SeasonValue | null;
}

const state: State = {
  available: [],
  defaultSeason: null,
  selected: null,
};

const listeners = new Set<(s: SeasonValue | null) => void>();

export function onSeasonChange(fn: (s: SeasonValue | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const l of listeners) l(state.selected);
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

/** Current selection as a query value, or null if not yet initialised. */
export function currentSeason(): SeasonValue | null {
  return state.selected;
}

/** Available seasons (newest first). Empty until init() resolves. */
export function availableSeasons(): readonly number[] {
  return state.available;
}

/** Most recent season known to the server (or null if no data). */
export function defaultSeason(): number | null {
  return state.defaultSeason;
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

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function persist(value: SeasonValue | null): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    if (value === null) ls.removeItem(STORAGE_KEY);
    else ls.setItem(STORAGE_KEY, seasonValueToString(value));
  } catch {
    /* ignore quota */
  }
}

function readPersisted(): string | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    return ls.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSeason(value: SeasonValue | null, opts: { persist?: boolean } = {}): void {
  state.selected = value;
  if (opts.persist !== false) persist(value);
  emit();
}

/**
 * Mount the dropdown into `host`. Call after /api/seasons has resolved.
 * Triggers `onChange` whenever the user picks a different season; that hook
 * is responsible for re-rendering the active view.
 */
export function mountSeasonPicker(
  host: HTMLElement,
  opts: { onChange: (value: SeasonValue) => void },
): HTMLSelectElement {
  host.replaceChildren();
  const wrap = document.createElement('label');
  wrap.className = 'season-picker';
  wrap.setAttribute('aria-label', 'Season');

  const text = document.createElement('span');
  text.className = 'season-picker__label muted';
  text.textContent = 'Season:';
  wrap.appendChild(text);

  const select = document.createElement('select');
  select.className = 'season-picker__select';
  select.dataset['testid'] = 'season-picker';

  for (const year of state.available) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    select.appendChild(opt);
  }
  const allOpt = document.createElement('option');
  allOpt.value = ALL_SEASONS;
  allOpt.textContent = 'All seasons';
  select.appendChild(allOpt);

  if (state.selected !== null) {
    select.value = seasonValueToString(state.selected);
  }

  select.addEventListener('change', () => {
    const next = parseSeasonValue(select.value);
    if (next === null) return;
    setSeason(next);
    opts.onChange(next);
  });

  wrap.appendChild(select);
  host.appendChild(wrap);
  return select;
}

/**
 * Fetch /api/seasons and seed initial state. Called once at boot.
 * Returns the resolved selection so callers can immediately re-render.
 */
export async function initSeasonPicker(opts: {
  fetchSeasons?: () => Promise<SeasonsResponse>;
  hashQuery?: string;
} = {}): Promise<SeasonValue | null> {
  const fetcher =
    opts.fetchSeasons ??
    (async () => {
      const res = await fetch('/api/seasons', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`/api/seasons ${res.status}`);
      return (await res.json()) as SeasonsResponse;
    });

  let resp: SeasonsResponse;
  try {
    resp = await fetcher();
  } catch {
    // Network/server hiccup — fall back to whatever the URL/localStorage say.
    resp = { seasons: [], default: null };
  }
  state.available = [...resp.seasons].sort((a, b) => b - a);
  state.defaultSeason = resp.default;

  const hashQuery =
    opts.hashQuery ??
    (typeof window !== 'undefined' ? readSeasonFromHash(window.location.hash) : undefined);
  state.selected = pickInitialSeason(hashQuery, readPersisted(), state.defaultSeason);
  emit();
  return state.selected;
}

/** Test-only reset. Not exported through index. */
export function __resetForTests(): void {
  state.available = [];
  state.defaultSeason = null;
  state.selected = null;
  listeners.clear();
}
