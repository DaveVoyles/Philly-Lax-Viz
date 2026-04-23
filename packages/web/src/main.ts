import { onRoute, startRouter, type RouteMatch } from './router.js';
import { apiUrl } from './apiBase.js';
import * as dashboard from './views/dashboard.js';
import * as teamDetail from './views/teamDetail.js';
import * as gameDetail from './views/gameDetail.js';
import * as playerDetail from './views/playerDetail.js';
import * as dataQuality from './views/dataQuality.js';
import * as leaders from './views/leaders.js';
import * as anomalies from './views/anomalies.js';
import * as graph from './views/graph.js';
import { mountSearchBox } from './components/searchBox.js';

// Wave 14 Lane 3 — game scrubber view, kept lazy so pixi/scrubber chunk
// stays out of the entry bundle. Coordinated with Han to add only ONE line
// for view + ONE for teardown to minimise router/main.ts churn.
let scrubberDestroy: (() => void) | null = null;
// W15 L2 (R2): same lazy-chunk pattern as the scrubber so the constellation
// view + its axis labels live in their own chunk.
let constellationDestroy: (() => void) | null = null;
// W16 L2 (Leia): same lazy-chunk pattern for the schedule view.
let scheduleDestroy: (() => void) | null = null;

interface NavLink {
  href: string;
  label: string;
  match: RouteMatch['name'];
}

const NAV: NavLink[] = [
  { href: '#/', label: 'Dashboard', match: 'dashboard' },
  { href: '#/leaders', label: 'Leaders', match: 'leaders' },
  { href: '#/h2h', label: 'Compare', match: 'h2h' },
  { href: '#/graph', label: 'Network', match: 'graph' },
  { href: '#/schedule', label: 'Schedule', match: 'schedule' },
  { href: '#/constellation', label: 'Constellation', match: 'constellation' },
  { href: '#/data-quality', label: 'Data quality', match: 'dataQuality' },
  { href: '#/anomalies', label: 'Anomalies', match: 'anomalies' },
  { href: '#/sources', label: 'Sources', match: 'sources' },
  { href: '#/status', label: 'Status', match: 'status' },
];

function mountShell(app: HTMLElement): {
  main: HTMLElement;
  setActive: (name: RouteMatch['name']) => void;
} {
  app.innerHTML = `
    <header class="site-header">
      <div class="brand">🥍 Philly Lacrosse</div>
      <nav>
        ${NAV.map(
          (n) => `<a data-nav="${n.match}" href="${n.href}">${n.label}</a>`,
        ).join('')}
      </nav>
      <div id="search-host" class="search-host"></div>
      <div id="season-host" class="season-host"></div>
    </header>
    <main id="main" class="container"></main>
    <footer class="site-footer">
      <div class="site-footer__row">
        <span class="muted" id="freshness-footer">Last scoreboard update: <span data-freshness="scoreboard">checking...</span></span>
        <span class="muted">
          <a href="#/sources">Where does this data come from?</a>
        </span>
        <span class="muted">Made with &#129405; in Philly</span>
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

function dispatch(main: HTMLElement, match: RouteMatch): void {
  // Tear down any active GPU/pixi resources from the previous view before
  // mounting the next one.
  graph.destroy();
  if (scrubberDestroy) { scrubberDestroy(); scrubberDestroy = null; }
  if (constellationDestroy) { constellationDestroy(); constellationDestroy = null; }
  if (scheduleDestroy) { scheduleDestroy(); scheduleDestroy = null; }
  switch (match.name) {
    case 'dashboard':
      dashboard.render(main, match.params);
      return;
    case 'teamDetail':
      teamDetail.render(main, match.params);
      return;
    case 'gameDetail':
      gameDetail.render(main, match.params);
      return;
    case 'gameScrubber':
      void import('./views/game.js').then((m) => { scrubberDestroy = m.destroy; m.render(main, match.params); });
      return;
    case 'playerDetail':
      playerDetail.render(main, match.params);
      return;
    case 'dataQuality':
      dataQuality.render(main, match.params);
      return;
    case 'leaders':
      leaders.render(main, match.params);
      return;
    case 'anomalies':
      anomalies.render(main, match.params);
      return;
    case 'graph':
      void graph.render(main, match.params);
      return;
    case 'constellation':
      void import('./views/constellation.js').then((m) => {
        constellationDestroy = m.destroy;
        m.render(main, match.params);
      });
      return;
    case 'h2h':
      void import('./views/h2h.js').then((m) => m.render(main, match.params));
      return;
    case 'schedule':
      void import('./views/schedule.js').then((m) => { scheduleDestroy = m.destroy; m.render(main, match.params); });
      return;
    case 'sources':
      void import('./views/sources.js').then((m) => m.render(main, match.params));
      return;
    case 'status':
      void import('./views/status.js').then((m) => m.render(main, match.params));
      return;
    case 'notFound':
      main.innerHTML = `<h1>Not found</h1><p>No route for <code>${match.path}</code>. <a href="#/">Go home</a>.</p>`;
      return;
  }
}

function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app root missing');
  const { main, setActive } = mountShell(app);

  // W17 L3 (R2): populate the global "Last scoreboard update" footer slot
  // from /api/freshness. Failure is silent so a server outage does not
  // break the rest of the UI.
  void fetch(apiUrl('/api/freshness'))
    .then((r) => (r.ok ? r.json() : null))
    .then((f: { scoreboardLast: string | null } | null) => {
      const slot = document.querySelector<HTMLElement>('[data-freshness="scoreboard"]');
      if (!slot) return;
      if (!f || !f.scoreboardLast) {
        slot.textContent = 'unknown';
        return;
      }
      const t = Date.parse(f.scoreboardLast);
      if (Number.isNaN(t)) {
        slot.textContent = 'unknown';
        return;
      }
      const ms = Date.now() - t;
      const min = Math.round(ms / 60_000);
      const rel =
        min < 60 ? `${min}m ago` : min < 24 * 60 ? `${Math.round(min / 60)}h ago` : `${Math.round(min / 60 / 24)}d ago`;
      slot.textContent = `${new Date(t).toLocaleString()} (${rel})`;
    })
    .catch(() => {
      const slot = document.querySelector<HTMLElement>('[data-freshness="scoreboard"]');
      if (slot) slot.textContent = 'unknown';
    });

  onRoute((match) => {
    setActive(match.name);
    dispatch(main, match);
  });
  startRouter();
}

boot();
