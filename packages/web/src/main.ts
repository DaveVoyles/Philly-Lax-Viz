import { onRoute, startRouter, currentRoute, type RouteMatch } from './router.js';
import * as dashboard from './views/dashboard.js';
import * as teamDetail from './views/teamDetail.js';
import * as gameDetail from './views/gameDetail.js';
import * as playerDetail from './views/playerDetail.js';
import * as dataQuality from './views/dataQuality.js';
import * as leaders from './views/leaders.js';
import * as anomalies from './views/anomalies.js';
import * as graph from './views/graph.js';

// Wave 14 Lane 3 — game scrubber view, kept lazy so pixi/scrubber chunk
// stays out of the entry bundle. Coordinated with Han to add only ONE line
// for view + ONE for teardown to minimise router/main.ts churn.
let scrubberDestroy: (() => void) | null = null;
import {
  initSeasonPicker,
  mountSeasonPicker,
  withSeasonInHash,
  seasonValueToString,
  type SeasonValue,
} from './components/seasonPicker.js';

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
  { href: '#/data-quality', label: 'Data quality', match: 'dataQuality' },
  { href: '#/anomalies', label: 'Anomalies', match: 'anomalies' },
];

function mountShell(app: HTMLElement): {
  main: HTMLElement;
  seasonHost: HTMLElement;
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
      <div id="season-host" class="season-host"></div>
    </header>
    <main id="main" class="container"></main>
    <footer class="site-footer">
      <span class="muted">Wave 2 shell &middot; @pll/web</span>
      <span class="muted attribution">
        Win/loss records and rankings: <a href="https://www.piaa.org" target="_blank" rel="noopener noreferrer">PIAA District 1</a> (state officials, ground truth).
        Game summaries, scores, and player stats: <a href="https://phillylacrosse.com" target="_blank" rel="noopener noreferrer">PhillyLacrosse</a> RSS feed.
        Team logos: <a href="https://www.maxpreps.com" target="_blank" rel="noopener noreferrer">MaxPreps</a>.
      </span>
    </footer>
  `;
  const main = app.querySelector<HTMLElement>('#main');
  const seasonHost = app.querySelector<HTMLElement>('#season-host');
  if (!main || !seasonHost) throw new Error('shell mount missing');
  const links = Array.from(app.querySelectorAll<HTMLAnchorElement>('a[data-nav]'));
  return {
    main,
    seasonHost,
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
    case 'h2h':
      void import('./views/h2h.js').then((m) => m.render(main, match.params));
      return;
    case 'notFound':
      main.innerHTML = `<h1>Not found</h1><p>No route for <code>${match.path}</code>. <a href="#/">Go home</a>.</p>`;
      return;
  }
}

function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app root missing');
  const { main, seasonHost, setActive } = mountShell(app);

  const rerenderCurrent = (): void => {
    const match = currentRoute();
    setActive(match.name);
    dispatch(main, match);
  };

  onRoute((match) => {
    setActive(match.name);
    dispatch(main, match);
  });
  startRouter();

  // Mount season picker after first render so the dropdown appears even if
  // /api/seasons is slow. Selection updates the URL hash (preserving the
  // current path/query) and re-runs the active view.
  void initSeasonPicker().then(() => {
    mountSeasonPicker(seasonHost, {
      onChange: (value: SeasonValue) => {
        const next = withSeasonInHash(window.location.hash, value);
        if (window.location.hash !== next) {
          window.location.hash = next.replace(/^#/, '');
        } else {
          rerenderCurrent();
        }
        // Persisted by mountSeasonPicker → setSeason. Logged here for clarity.
        void seasonValueToString;
      },
    });
  });
}

boot();
