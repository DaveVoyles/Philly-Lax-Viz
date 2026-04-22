import { onRoute, startRouter, type RouteMatch } from './router.js';
import * as dashboard from './views/dashboard.js';
import * as teamDetail from './views/teamDetail.js';
import * as gameDetail from './views/gameDetail.js';
import * as playerDetail from './views/playerDetail.js';
import * as dataQuality from './views/dataQuality.js';
import * as leaders from './views/leaders.js';
import * as anomalies from './views/anomalies.js';
import * as graph from './views/graph.js';

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

function mountShell(app: HTMLElement): { main: HTMLElement; setActive: (name: RouteMatch['name']) => void } {
  app.innerHTML = `
    <header class="site-header">
      <div class="brand">🥍 Philly Lacrosse</div>
      <nav>
        ${NAV.map(
          (n) => `<a data-nav="${n.match}" href="${n.href}">${n.label}</a>`,
        ).join('')}
      </nav>
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
  if (!main) throw new Error('main mount missing');
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
  const { main, setActive } = mountShell(app);
  onRoute((match) => {
    setActive(match.name);
    dispatch(main, match);
  });
  startRouter();
}

boot();
