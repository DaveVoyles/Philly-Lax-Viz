export const SEASON_QUERY_KEY = 'season';
export const SEASON_STORAGE_KEY = 'pll-selected-season';
export const ALL_SEASONS = 'all' as const;

export type SeasonValue = number | typeof ALL_SEASONS;

export interface SeasonsResponse {
  seasons: number[];
  default: number | null;
}

const FALLBACK_SEASON = 2026;

const listeners = new Set<(s: SeasonValue | null) => void>();
let knownSeasons: number[] = [FALLBACK_SEASON];
let memorySeason: SeasonValue | null | undefined;

function readStoredSeasonRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SEASON_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSeasonRaw(raw: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (raw === null) window.localStorage.removeItem(SEASON_STORAGE_KEY);
    else window.localStorage.setItem(SEASON_STORAGE_KEY, raw);
  } catch {
    // localStorage unavailable; keep the in-memory season only.
  }
}

export function onSeasonChange(fn: (s: SeasonValue | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

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

export function setKnownSeasons(seasons: readonly number[]): void {
  const normalized = [...new Set(seasons)]
    .filter((season) => Number.isInteger(season) && season >= 2000 && season <= 2100)
    .sort((a, b) => b - a);
  if (normalized.length > 0) {
    knownSeasons = normalized;
  }
}

export function currentSeason(): SeasonValue | null {
  if (memorySeason !== undefined) return memorySeason;
  return parseSeasonValue(readStoredSeasonRaw()) ?? defaultSeason();
}

export function availableSeasons(): readonly number[] {
  return knownSeasons;
}

export function defaultSeason(): number {
  return knownSeasons[0] ?? FALLBACK_SEASON;
}

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

export function readSeasonFromHash(hash: string): string | undefined {
  const noHash = hash.replace(/^#/, '');
  const q = noHash.indexOf('?');
  if (q < 0) return undefined;
  const usp = new URLSearchParams(noHash.slice(q + 1));
  return usp.get(SEASON_QUERY_KEY) ?? undefined;
}

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

export function setSeason(value: SeasonValue | null, opts: { persist?: boolean } = {}): void {
  memorySeason = value;
  if (opts.persist !== false) {
    writeStoredSeasonRaw(value === null ? null : seasonValueToString(value));
  }
  for (const listener of listeners) listener(value);
}

export function mountSeasonPicker(
  host: HTMLElement,
  opts: { onChange: (value: SeasonValue) => void },
): HTMLSelectElement {
  const select = document.createElement('select');
  for (const season of availableSeasons()) {
    const option = document.createElement('option');
    option.value = String(season);
    option.textContent = String(season);
    select.appendChild(option);
  }
  const selected = currentSeason();
  if (selected !== null && selected !== ALL_SEASONS) {
    select.value = String(selected);
  }
  select.addEventListener('change', () => {
    const next = parseSeasonValue(select.value);
    if (next !== null) {
      setSeason(next);
      opts.onChange(next);
    }
  });
  host.replaceChildren(select);
  return select;
}

export async function initSeasonPicker(opts: {
  fetchSeasons?: () => Promise<SeasonsResponse>;
  hashQuery?: string;
} = {}): Promise<SeasonValue | null> {
  const response = opts.fetchSeasons ? await opts.fetchSeasons() : { seasons: availableSeasons() as number[], default: defaultSeason() };
  setKnownSeasons(response.seasons);
  const next = pickInitialSeason(opts.hashQuery, readStoredSeasonRaw(), response.default) ?? defaultSeason();
  setSeason(next);
  return currentSeason();
}

export function __resetForTests(): void {
  listeners.clear();
  knownSeasons = [FALLBACK_SEASON];
  memorySeason = undefined;
  writeStoredSeasonRaw(null);
}
