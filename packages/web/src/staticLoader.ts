const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const IS_STATIC: boolean = ENV.VITE_STATIC_MODE === 'true';

interface SearchHit {
  kind: 'player' | 'team';
  id: number;
  name: string;
  teamName?: string;
}

const DEFAULT_SEASON = 2026;
const DEFAULT_PLAYER_METRIC = 'points';
const DEFAULT_TEAM_METRIC = 'wins';
const DEFAULT_SPARKLINE_METRIC = 'points';
const DEFAULT_SEARCH_LIMIT = 10;

function joinUrl(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/\//, '/');
}

function dataRoot(): string {
  return joinUrl(ENV.BASE_URL ?? '/', 'data');
}

function logoRoot(): string {
  return joinUrl(ENV.BASE_URL ?? '/', 'logos');
}

function readUrl(apiPath: string): URL {
  return new URL(apiPath, 'https://static.local');
}

function getSeason(params: URLSearchParams): number {
  const raw = Number(params.get('season') ?? String(DEFAULT_SEASON));
  return Number.isInteger(raw) ? raw : DEFAULT_SEASON;
}

function normalizeLogos<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeLogos(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = normalizeLogos(entry);
    }
    return output as T;
  }
  if (typeof value === 'string' && value.startsWith('/logos/')) {
    return joinUrl(logoRoot(), value.slice('/logos/'.length)) as T;
  }
  return value;
}

/** Map an /api/... URL (with query string) to a static data file URL */
export function toStaticUrl(apiPath: string): string {
  const url = readUrl(apiPath);
  const params = url.searchParams;
  const season = getSeason(params);
  const pathname = url.pathname.startsWith('/api') ? url.pathname.slice(4) || '/' : url.pathname;
  const segments = pathname.split('/').filter(Boolean);
  const root = dataRoot();

  if (pathname === '/health') return joinUrl(root, 'health.json');
  if (pathname === '/seasons') return joinUrl(root, 'seasons.json');
  if (pathname === '/search') return joinUrl(root, String(season), 'search-index.json');
  if (pathname === '/data-quality/piaa-mismatches') {
    return joinUrl(root, String(season), 'data-quality', 'piaa-mismatches.json');
  }
  if (pathname.startsWith('/h2h/') || pathname.startsWith('/compare/') || pathname.startsWith('/posts/') || pathname.startsWith('/data-quality/')) {
    return joinUrl(root, 'empty.json');
  }
  if (pathname === '/teams') return joinUrl(root, String(season), 'teams.json');
  if (segments[0] === 'teams' && segments[1] && segments[2] === 'topScorers') {
    return joinUrl(root, String(season), 'teams', `${segments[1]}.json`);
  }
  if (segments[0] === 'teams' && segments[1]) {
    return joinUrl(root, String(season), 'teams', `${segments[1]}.json`);
  }
  if (pathname === '/games') return joinUrl(root, String(season), 'games.json');
  if (segments[0] === 'games' && segments[1]) {
    return joinUrl(root, String(season), 'games', `${segments[1]}.json`);
  }
  if (segments[0] === 'players' && segments[1] === 'constellation') {
    return joinUrl(root, String(season), 'constellation.json');
  }
  if (segments[0] === 'players' && segments[1]) {
    return joinUrl(root, String(season), 'players', `${segments[1]}.json`);
  }
  if (pathname === '/rankings') return joinUrl(root, String(season), 'rankings.json');
  if (pathname === '/leaders/players/sparklines') {
    const metric = params.get('metric') ?? DEFAULT_SPARKLINE_METRIC;
    return joinUrl(root, String(season), 'leaders', 'sparklines', `${metric}.json`);
  }
  if (pathname === '/leaders/players') {
    const metric = params.get('metric') ?? DEFAULT_PLAYER_METRIC;
    return joinUrl(root, String(season), 'leaders', 'players', `${metric}.json`);
  }
  if (pathname === '/leaders/teams') {
    const metric = params.get('metric') ?? DEFAULT_TEAM_METRIC;
    return joinUrl(root, String(season), 'leaders', 'teams', `${metric}.json`);
  }
  if (pathname === '/rivalries') return joinUrl(root, String(season), 'rivalries.json');
  if (pathname === '/constellation') return joinUrl(root, String(season), 'constellation.json');
  if (pathname === '/anomalies/summary') return joinUrl(root, String(season), 'anomalies-summary.json');
  if (pathname === '/anomalies') return joinUrl(root, String(season), 'anomalies.json');
  if (segments[0] === 'schedule' && segments[1] === 'team' && segments[2] && segments[3] === 'upcoming') {
    return joinUrl(root, String(season), 'schedule', 'team', `${segments[2]}.json`);
  }
  if (pathname === '/schedule') return joinUrl(root, String(season), 'schedule.json');
  if (pathname === '/freshness') return joinUrl(root, 'freshness.json');
  return joinUrl(root, 'empty.json');
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Static fetch failed: ${response.status} ${response.statusText} (${url})`);
  }
  return normalizeLogos((await response.json()) as T);
}

function sortSearchHits(hits: SearchHit[], lower: string): SearchHit[] {
  return hits.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(lower) ? 1 : 0;
    const bPrefix = b.name.toLowerCase().startsWith(lower) ? 1 : 0;
    if (aPrefix !== bPrefix) return bPrefix - aPrefix;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/** Fetch a static JSON file. For /api/search, does client-side filtering. */
export async function staticFetch<T>(apiPath: string): Promise<T> {
  const url = readUrl(apiPath);
  const pathname = url.pathname.startsWith('/api') ? url.pathname.slice(4) || '/' : url.pathname;
  const limit = Number(url.searchParams.get('limit') ?? '');

  if (pathname === '/search') {
    const q = url.searchParams.get('q') ?? '';
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : DEFAULT_SEARCH_LIMIT;
    if (q.trim().length < 2) return [] as T;
    const lower = q.trim().toLowerCase();
    const index = await fetchJson<SearchHit[]>(toStaticUrl(apiPath));
    return sortSearchHits(index.filter((hit) => hit.name.toLowerCase().includes(lower)), lower).slice(0, effectiveLimit) as T;
  }

  const data = await fetchJson<unknown>(toStaticUrl(apiPath));

  if (pathname.match(/^\/teams\/[^/]+\/topScorers$/)) {
    const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 5;
    const topScorers = ((data as { topScorers?: unknown[] }).topScorers ?? []) as unknown[];
    return topScorers.slice(0, effectiveLimit) as T;
  }

  if (pathname === '/leaders/players' && data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows)) {
    const rows = (data as { rows: unknown[] }).rows;
    return { ...(data as object), rows: Number.isFinite(limit) && limit > 0 ? rows.slice(0, Math.trunc(limit)) : rows } as T;
  }

  if (pathname === '/leaders/teams' && data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows)) {
    const rows = (data as { rows: unknown[] }).rows;
    return { ...(data as object), rows: Number.isFinite(limit) && limit > 0 ? rows.slice(0, Math.trunc(limit)) : rows } as T;
  }

  if (pathname === '/leaders/players/sparklines' && data && typeof data === 'object' && Array.isArray((data as { players?: unknown[] }).players)) {
    const players = (data as { players: unknown[] }).players;
    return { ...(data as object), players: Number.isFinite(limit) && limit > 0 ? players.slice(0, Math.trunc(limit)) : players } as T;
  }

  if (pathname.match(/^\/schedule\/team\/[^/]+\/upcoming$/) && data && typeof data === 'object' && Array.isArray((data as { games?: unknown[] }).games)) {
    const games = (data as { games: unknown[] }).games;
    return {
      ...(data as object),
      games: Number.isFinite(limit) && limit > 0 ? games.slice(0, Math.trunc(limit)) : games,
    } as T;
  }

  return data as T;
}
