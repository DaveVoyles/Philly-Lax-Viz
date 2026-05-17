// Tiny hash-based router. No external deps.
// Routes: #/, #/teams/:id, #/games/:id, #/players/:id, #/data-quality

export interface RouteMatch {
  name: 'dashboard' | 'teamDetail' | 'gameDetail' | 'gameScrubber' | 'playerDetail' | 'comparePlayers' | 'dataQuality' | 'leaders' | 'anomalies' | 'graph' | 'constellation' | 'h2h' | 'schedule' | 'sources' | 'status' | 'adminCorrections' | 'adminDedup' | 'notFound';
  path: string;
  params: Record<string, string>;
}

type RouteHandler = (match: RouteMatch) => void;

interface RouteDef {
  name: RouteMatch['name'];
  pattern: RegExp;
  keys: string[];
}

const routes: RouteDef[] = [
  { name: 'dashboard', pattern: /^\/?$/, keys: [] },
  { name: 'teamDetail', pattern: /^\/teams\/([^/]+)\/?$/, keys: ['id'] },
  { name: 'gameDetail', pattern: /^\/games\/([^/]+)\/?$/, keys: ['id'] },
  { name: 'gameScrubber', pattern: /^\/game\/([^/]+)\/?$/, keys: ['id'] },
  { name: 'playerDetail', pattern: /^\/players\/([^/]+)\/?$/, keys: ['id'] },
  { name: 'comparePlayers', pattern: /^\/compare\/players\/?$/, keys: [] },
  { name: 'dataQuality', pattern: /^\/data-quality\/?$/, keys: [] },
  { name: 'leaders', pattern: /^\/leaders\/?$/, keys: [] },
  { name: 'anomalies', pattern: /^\/anomalies\/?$/, keys: [] },
  { name: 'graph', pattern: /^\/graph\/?$/, keys: [] },
  { name: 'constellation', pattern: /^\/constellation\/?$/, keys: [] },
  { name: 'h2h', pattern: /^\/h2h\/?$/, keys: [] },
  { name: 'schedule', pattern: /^\/schedule\/?$/, keys: [] },
  { name: 'sources', pattern: /^\/sources\/?$/, keys: [] },
  { name: 'status', pattern: /^\/status\/?$/, keys: [] },
  { name: 'adminCorrections', pattern: /^\/admin\/corrections\/?$/, keys: [] },
  { name: 'adminDedup', pattern: /^\/admin\/dedup\/?$/, keys: [] },
];

function parseHash(): RouteMatch {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const qIdx = withSlash.indexOf('?');
  const path = qIdx >= 0 ? withSlash.slice(0, qIdx) : withSlash;
  for (const def of routes) {
    const m = def.pattern.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      def.keys.forEach((k, i) => {
        const v = m[i + 1];
        if (v !== undefined) params[k] = decodeURIComponent(v);
      });
      return { name: def.name, path, params };
    }
  }
  return { name: 'notFound', path, params: {} };
}

const handlers = new Set<RouteHandler>();

function fire(): void {
  const match = parseHash();
  for (const h of handlers) h(match);
}

export function onRoute(handler: RouteHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function navigate(path: string): void {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${normalized}`) {
    fire();
  } else {
    window.location.hash = normalized;
  }
}

export function startRouter(): void {
  window.addEventListener('hashchange', fire);
  // Defer first fire so listeners can attach.
  queueMicrotask(fire);
}

export function currentRoute(): RouteMatch {
  return parseHash();
}
