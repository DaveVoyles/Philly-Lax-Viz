import { onRoute, startRouter, type RouteMatch } from './router.js';
import { mountSearchBox } from './components/searchBox.js';
import { setCanonicalUrl } from './util/ogMeta.js';
import { setPageTitle } from './util/pageTitle.js';
import { clearJsonLd } from './util/jsonLd.js';
import { IS_STATIC } from './staticLoader.js';
import './styles/responsive.css';

// W18 Lane A (Han) — proposal 04: every view module is now lazy-loaded so the
// entry chunk only carries the router, shell, and search box. Each route's
// chunk is fetched on first navigation; subsequent visits resolve from the
// browser's module cache. See docs/improvements/04-web-bundle-code-splitting.md.

type ViewModule = {
  render: (root: HTMLElement, params: Record<string, string>) => void | Promise<void>;
  destroy?: () => void;
};

type RouteName = RouteMatch['name'];

// Map every navigable route to a dynamic loader. Vite/Rollup emits one chunk
// per import() target; previously eager views (dashboard, leaders, etc.) now
// produce their own per-route chunks.
const loaders: Record<Exclude<RouteName, 'notFound'>, () => Promise<ViewModule>> = {
  dashboard: () => import('./views/dashboard.js'),
  teamDetail: () => import('./views/teamDetail.js'),
  gameDetail: () => import('./views/gameDetail.js'),
  gameScrubber: () => import('./views/game.js'),
  playerDetail: () => import('./views/playerDetail.js'),
  comparePlayers: () => import('./views/comparePlayers.js'),
  dataQuality: () => import('./views/dataQuality.js'),
  leaders: () => import('./views/leaders.js'),
  topTeams: () => import('./views/topTeams.js'),
  anomalies: () => import('./views/anomalies.js'),
  graph: () => import('./views/graph.js'),
  constellation: () => import('./views/constellation.js'),
  h2h: () => import('./views/h2h.js'),
  schedule: () => import('./views/schedule.js'),
  commitments: () => import('./views/commitments.js'),
  sources: () => import('./views/sources.js'),
  status: () => import('./views/status.js'),
  coachDashboard: () => import('./views/coachDashboard.js'),
  coachUpload: () => import('./views/coachUpload.js'),
  adminCorrections: () => import('./views/adminCorrections.js'),
  adminDedup: () => import('./views/adminDedup.js'),
  adminHudl: () => import('./views/adminHudl.js'),
};

interface NavLink {
  href: string;
  label: string;
  match: RouteName;
}

const NAV: NavLink[] = [
  { href: '#/', label: 'Dashboard', match: 'dashboard' },
  { href: '#/leaders', label: 'Leaders', match: 'leaders' },
  { href: '#/h2h', label: 'Compare', match: 'h2h' },
  { href: '#/graph', label: 'Team Connections', match: 'graph' },
  { href: '#/schedule', label: 'Schedule', match: 'schedule' },
  { href: '#/commitments', label: 'Commitments', match: 'commitments' },
  { href: '#/constellation', label: 'Player Map', match: 'constellation' },
];

const MORE_NAV: NavLink[] = [
  { href: '#/data-quality', label: 'Data quality', match: 'dataQuality' },
  { href: '#/top-teams', label: 'Top 10 Teams', match: 'topTeams' },
  { href: '#/anomalies', label: 'Anomalies', match: 'anomalies' },
  { href: '#/sources', label: 'Sources', match: 'sources' },
  { href: '#/status', label: 'Status', match: 'status' },
  ...(IS_STATIC
    ? []
    : [
        { href: '#/coach/dashboard', label: 'Coach dashboard', match: 'coachDashboard' as const },
        { href: '#/coach/upload', label: 'Coach upload', match: 'coachUpload' as const },
        { href: '#/admin/corrections', label: 'Admin corrections', match: 'adminCorrections' as const },
        { href: '#/admin/dedup', label: 'Admin dedup', match: 'adminDedup' as const },
        { href: '#/admin/hudl', label: 'Admin Hudl', match: 'adminHudl' as const },
      ]),
];

function mountShell(app: HTMLElement): {
  main: HTMLElement;
  setActive: (name: RouteName) => void;
} {
  app.innerHTML = `
    <header class="site-header">
      <div class="brand">🥍 Philly Lacrosse</div>
      <button class="nav-hamburger" aria-label="Open navigation" aria-expanded="false" aria-controls="main-nav">&#9776;</button>
      <nav id="main-nav">
        ${NAV.map(
          (n) => `<a data-nav="${n.match}" href="${n.href}">${n.label}</a>`,
        ).join('')}
        <div class="more-menu">
          <button class="more-menu__btn" aria-haspopup="true" aria-expanded="false">More ▾</button>
          <div class="more-menu__dropdown">
            ${MORE_NAV.map(
              (n) => `<a data-nav="${n.match}" href="${n.href}">${n.label}</a>`,
            ).join('')}
            <a href="https://github.com/DaveVoyles/Philly-Lax-Viz" target="_blank" rel="noopener noreferrer">GitHub repo &#8599;</a>
          </div>
        </div>
      </nav>
      <div id="search-host" class="search-host"></div>
      <div id="season-host" class="season-host"></div>
    </header>
    <main id="main" class="container"></main>
    <footer class="site-footer">
      <div class="site-footer__row">
        <span class="muted" id="freshness-footer">Refreshed nightly</span>
        <span class="muted">
          <a href="#/sources">Where does this data come from?</a>
        </span>
        <span class="muted">Made with &#10084;&#65039; in Philly</span>
      </div>
      <span class="muted attribution">
        Win/loss records and rankings: <a href="https://www.piaa.org" target="_blank" rel="noopener noreferrer">PIAA District 1</a> (state officials, ground truth).
        Game summaries, scores, and player stats: <a href="https://phillylacrosse.com" target="_blank" rel="noopener noreferrer">PhillyLacrosse</a> RSS feed.
        Team logos: <a href="https://www.maxpreps.com" target="_blank" rel="noopener noreferrer">MaxPreps</a>.
      </span>
    </footer>
  `;
  const main = app.querySelector<HTMLElement>('#main');
  if (!main) throw new Error('shell mount missing');
  const searchHost = app.querySelector<HTMLElement>('#search-host');
  if (searchHost) mountSearchBox(searchHost);

  // Hamburger toggle for mobile.
  const hamburger = app.querySelector<HTMLButtonElement>('.nav-hamburger');
  const mainNav = app.querySelector<HTMLElement>('#main-nav');
  if (hamburger && mainNav) {
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = mainNav.classList.toggle('nav-open');
      hamburger.setAttribute('aria-expanded', String(open));
    });
    // Close on any nav link click (route change).
    mainNav.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'A') {
        mainNav.classList.remove('nav-open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('click', (e) => {
      if (!mainNav.contains(e.target as Node) && e.target !== hamburger) {
        mainNav.classList.remove('nav-open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Wire up the More dropdown toggle.
  const moreBtn = app.querySelector<HTMLButtonElement>('.more-menu__btn');
  const moreDropdown = app.querySelector<HTMLElement>('.more-menu__dropdown');
  if (moreBtn && moreDropdown) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = moreDropdown.classList.toggle('is-open');
      moreBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      moreDropdown.classList.remove('is-open');
      moreBtn.setAttribute('aria-expanded', 'false');
    });
    moreDropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  const links = Array.from(app.querySelectorAll<HTMLAnchorElement>('a[data-nav]'));
  return {
    main,
    setActive(name) {
      for (const a of links) {
        if (a.dataset['nav'] === name) a.classList.add('active');
        else a.classList.remove('active');
      }
    },
  };
}

// Shared spinner overlay. We only show it if the dynamic import takes longer
// than ~100 ms, otherwise cached chunks would cause a visible flicker.
function showSpinner(main: HTMLElement): void {
  if (main.querySelector('[data-route-spinner]')) return;
  const el = document.createElement('div');
  el.dataset['routeSpinner'] = '1';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText =
    'padding:2rem;text-align:center;color:var(--muted);font-size:0.9rem;';
  el.textContent = 'Loading view…';
  main.appendChild(el);
}

function hideSpinner(main: HTMLElement): void {
  const el = main.querySelector('[data-route-spinner]');
  if (el) el.remove();
}

let currentDestroy: (() => void) | null = null;
let navToken = 0;

const ROUTE_TITLES: Partial<Record<RouteName, string>> = {
  dashboard: 'Dashboard',
  teamDetail: 'Team Stats',
  gameDetail: 'Game Detail',
  gameScrubber: 'Game Scrubber',
  playerDetail: 'Player Stats',
  comparePlayers: 'Compare Players',
  dataQuality: 'Data Quality',
  leaders: 'Stat Leaders',
  topTeams: 'Top Teams',
  anomalies: 'Anomalies',
  graph: 'Team Connections',
  constellation: 'Player Map',
  h2h: 'Compare Teams',
  schedule: 'Schedule',
  commitments: 'College Commitments',
  sources: 'Sources',
  status: 'Site Status',
  coachDashboard: 'Coach Dashboard',
  coachUpload: 'Coach Upload',
  adminCorrections: 'Admin Corrections',
  adminDedup: 'Admin Dedup',
  adminHudl: 'Admin Hudl',
};

function applyRouteSeo(match: RouteMatch): void {
  clearJsonLd();
  setCanonicalUrl(window.location.href);
  if (match.name === 'notFound') {
    setPageTitle('Not found');
    return;
  }
  setPageTitle(ROUTE_TITLES[match.name]);
}

async function dispatch(main: HTMLElement, match: RouteMatch): Promise<void> {
  const myToken = ++navToken;
  // Tear down any active GPU/pixi/scrubber resources from the previous view
  // before mounting the next one.
  if (currentDestroy) {
    try { currentDestroy(); } catch (e) { console.error('view destroy failed', e); }
    currentDestroy = null;
  }

  if (match.name === 'notFound') {
    main.innerHTML = `<h1>Not found</h1><p>No route for <code>${match.path}</code>. <a href="#/">Go home</a>.</p>`;
    return;
  }

  const loader = loaders[match.name];
  if (!loader) {
    main.innerHTML = `<h1>Not found</h1><p>Unknown route.</p>`;
    return;
  }

  const spinTimer = window.setTimeout(() => {
    if (myToken === navToken) showSpinner(main);
  }, 100);

  try {
    const mod = await loader();
    // If the user has navigated again while we were waiting on the chunk,
    // drop this result on the floor — a newer dispatch is in flight.
    if (myToken !== navToken) {
      window.clearTimeout(spinTimer);
      return;
    }
    window.clearTimeout(spinTimer);
    hideSpinner(main);
    await mod.render(main, match.params);
    if (myToken === navToken && typeof mod.destroy === 'function') {
      currentDestroy = mod.destroy;
    }
  } catch (err) {
    window.clearTimeout(spinTimer);
    if (myToken === navToken) {
      hideSpinner(main);
      main.innerHTML = `<h1>Failed to load view</h1><p class="muted">${
        err instanceof Error ? err.message : 'Unknown error'
      }</p>`;
    }
    console.error('route load failed', err);
  }
}

// Idle-prefetch the most-likely next routes from the dashboard so subsequent
// navigation feels instant. Honours `saveData` on metered connections.
function prefetchLikelyViews(): void {
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  const idle =
    (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 250));
  idle(() => { void loaders.leaders(); });
  idle(() => { void loaders.teamDetail(); });
}

function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app root missing');
  const { main, setActive } = mountShell(app);

  onRoute((match) => {
    setActive(match.name);
    applyRouteSeo(match);
    void dispatch(main, match);
  });
  startRouter();

  // Warm the most-likely secondary routes after first paint.
  prefetchLikelyViews();
}

boot();

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
