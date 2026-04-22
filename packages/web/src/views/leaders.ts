// League Leaders view: tabbed players/teams leaderboards with chart + table.
// Tab + metric state lives in URL hash query (#/leaders?tab=players&metric=points).

import {
  ApiError,
  getPlayerLeaders,
  getTeamLeaders,
  type PlayerLeaderMetric,
  type PlayerLeaderRow,
  type PlayerLeadersResponse,
  type TeamLeaderMetric,
  type TeamLeaderRow,
  type TeamLeadersResponse,
} from '../api.js';
import { renderHorizontalLeaderboard } from '../charts/index.js';
import type { ChartHandle } from '../charts/types.js';
import { renderTeamBadge } from '../components/teamBadge.js';

type Tab = 'players' | 'teams';

interface MetricDef<M extends string> {
  key: M;
  label: string;
  format: (n: number) => string;
}

const PLAYER_METRICS: ReadonlyArray<MetricDef<PlayerLeaderMetric>> = [
  { key: 'points', label: 'Points', format: intFmt },
  { key: 'goals', label: 'Goals', format: intFmt },
  { key: 'assists', label: 'Assists', format: intFmt },
  { key: 'ground_balls', label: 'Ground balls', format: intFmt },
  { key: 'caused_turnovers', label: 'Caused TOs', format: intFmt },
  { key: 'saves', label: 'Saves', format: intFmt },
  { key: 'fo_pct', label: 'FO %', format: pctFmt },
  { key: 'points_per_game', label: 'Points/game', format: floatFmt },
];

const TEAM_METRICS: ReadonlyArray<MetricDef<TeamLeaderMetric>> = [
  { key: 'wins', label: 'Wins', format: intFmt },
  { key: 'losses', label: 'Losses', format: intFmt },
  { key: 'win_pct', label: 'Win %', format: pctFmt },
  { key: 'goals_for', label: 'Goals for', format: intFmt },
  { key: 'goals_against', label: 'Goals against', format: intFmt },
  { key: 'goal_diff', label: 'Goal diff', format: intFmt },
  { key: 'gpg', label: 'Goals/game', format: floatFmt },
  { key: 'gapg', label: 'Goals against/game', format: floatFmt },
];

const TOP_N = 15;

function intFmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n)) : '—';
}
function floatFmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
function pctFmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

interface ViewState {
  tab: Tab;
  playerMetric: PlayerLeaderMetric;
  teamMetric: TeamLeaderMetric;
  // Sort state per tab
  playerSort: { col: string; dir: 'asc' | 'desc' } | null;
  teamSort: { col: string; dir: 'asc' | 'desc' } | null;
}

let activeChart: ChartHandle | null = null;

function readQuery(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '');
  const q = hash.indexOf('?');
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '');
}

function writeQuery(state: { tab: Tab; metric: string }): void {
  const usp = new URLSearchParams();
  usp.set('tab', state.tab);
  usp.set('metric', state.metric);
  const next = `#/leaders?${usp.toString()}`;
  if (window.location.hash !== next) {
    history.replaceState(null, '', next);
  }
}

function isPlayerMetric(s: string): s is PlayerLeaderMetric {
  return PLAYER_METRICS.some((m) => m.key === s);
}
function isTeamMetric(s: string): s is TeamLeaderMetric {
  return TEAM_METRICS.some((m) => m.key === s);
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }
  root.replaceChildren();

  const q = readQuery();
  const tabRaw = q.get('tab');
  const metricRaw = q.get('metric');
  const tab: Tab = tabRaw === 'teams' ? 'teams' : 'players';

  const state: ViewState = {
    tab,
    playerMetric:
      tab === 'players' && metricRaw && isPlayerMetric(metricRaw) ? metricRaw : 'points',
    teamMetric:
      tab === 'teams' && metricRaw && isTeamMetric(metricRaw) ? metricRaw : 'wins',
    playerSort: null,
    teamSort: null,
  };

  const h1 = document.createElement('h1');
  h1.textContent = 'League Leaders';
  root.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent = 'Season aggregate leaderboards across players and teams.';
  root.appendChild(sub);

  // Tab strip
  const tabStrip = document.createElement('div');
  tabStrip.className = 'leaders-tabs';
  tabStrip.style.cssText =
    'display:flex; gap:.5rem; border-bottom:1px solid var(--border); margin: 1rem 0;';
  const tabButtons: Record<Tab, HTMLButtonElement> = {
    players: makeTabButton('Players'),
    teams: makeTabButton('Teams'),
  };
  tabStrip.appendChild(tabButtons.players);
  tabStrip.appendChild(tabButtons.teams);
  root.appendChild(tabStrip);

  // Metric chip row
  const chipRow = document.createElement('div');
  chipRow.className = 'leaders-chips';
  chipRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:.4rem; margin: .75rem 0 1rem;';
  root.appendChild(chipRow);

  // Chart container
  const chartWrap = document.createElement('section');
  const chartTitle = document.createElement('h2');
  chartTitle.style.marginBottom = '.5rem';
  chartWrap.appendChild(chartTitle);
  const chartEl = document.createElement('div');
  chartEl.id = 'leaders-chart';
  chartEl.textContent = 'Loading…';
  chartWrap.appendChild(chartEl);
  root.appendChild(chartWrap);

  // Table container
  const tableWrap = document.createElement('section');
  const tableTitle = document.createElement('h2');
  tableTitle.textContent = 'Full table';
  tableTitle.style.marginTop = '1.5rem';
  tableWrap.appendChild(tableTitle);
  const tableEl = document.createElement('div');
  tableEl.id = 'leaders-table';
  tableWrap.appendChild(tableEl);
  root.appendChild(tableWrap);

  // Footer caption
  const caption = document.createElement('p');
  caption.className = 'muted';
  caption.id = 'leaders-caption';
  caption.style.marginTop = '1rem';
  root.appendChild(caption);

  function setTab(next: Tab): void {
    state.tab = next;
    refresh();
  }

  function refresh(): void {
    // Tab button active state
    for (const t of ['players', 'teams'] as const) {
      const btn = tabButtons[t];
      const isActive = state.tab === t;
      btn.classList.toggle('active', isActive);
      btn.style.borderBottom = isActive ? '2px solid var(--accent)' : '2px solid transparent';
      btn.style.color = isActive ? 'var(--accent)' : 'var(--fg)';
      btn.style.fontWeight = isActive ? '600' : '400';
    }

    // Build chips for current tab
    chipRow.replaceChildren();
    const metrics: ReadonlyArray<MetricDef<string>> =
      state.tab === 'players' ? PLAYER_METRICS : TEAM_METRICS;
    const currentMetric: string =
      state.tab === 'players' ? state.playerMetric : state.teamMetric;
    for (const m of metrics) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = m.label;
      const isActive = m.key === currentMetric;
      chip.style.cssText =
        'padding:.3rem .75rem; border-radius:999px; border:1px solid var(--border); cursor:pointer; font-size:.9rem;' +
        (isActive
          ? ' background:var(--accent); color:var(--accent-fg); border-color:var(--accent);'
          : ' background:transparent; color:var(--fg);');
      chip.addEventListener('click', () => {
        if (state.tab === 'players' && isPlayerMetric(m.key)) {
          state.playerMetric = m.key;
        } else if (state.tab === 'teams' && isTeamMetric(m.key)) {
          state.teamMetric = m.key;
        }
        refresh();
      });
      chipRow.appendChild(chip);
    }

    writeQuery({ tab: state.tab, metric: currentMetric });

    chartTitle.textContent = `Top ${TOP_N} — ${labelOf(state.tab, currentMetric)}`;

    if (activeChart) {
      activeChart.destroy();
      activeChart = null;
    }
    chartEl.replaceChildren();
    chartEl.textContent = 'Loading…';
    tableEl.replaceChildren();
    tableEl.textContent = 'Loading…';
    caption.textContent = '';

    if (state.tab === 'players') {
      void loadPlayers(state, chartEl, tableEl, caption);
    } else {
      void loadTeams(state, chartEl, tableEl, caption);
    }
  }

  tabButtons.players.addEventListener('click', () => setTab('players'));
  tabButtons.teams.addEventListener('click', () => setTab('teams'));

  refresh();
}

function makeTabButton(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText =
    'background:transparent; border:none; padding:.5rem 1rem; cursor:pointer; font-size:1rem; border-bottom:2px solid transparent;';
  return b;
}

function labelOf(tab: Tab, metric: string): string {
  const list: ReadonlyArray<MetricDef<string>> =
    tab === 'players' ? PLAYER_METRICS : TEAM_METRICS;
  return list.find((m) => m.key === metric)?.label ?? metric;
}

async function loadPlayers(
  state: ViewState,
  chartEl: HTMLElement,
  tableEl: HTMLElement,
  caption: HTMLElement,
): Promise<void> {
  let resp: PlayerLeadersResponse;
  try {
    resp = await getPlayerLeaders({ metric: state.playerMetric, limit: 100 });
  } catch (err) {
    showError(chartEl, err);
    showError(tableEl, err);
    return;
  }

  const metricDef = PLAYER_METRICS.find((m) => m.key === state.playerMetric)!;
  const top = resp.rows.slice(0, TOP_N);
  chartEl.replaceChildren();
  if (top.length === 0) {
    chartEl.textContent = 'No data yet.';
  } else {
    activeChart = renderHorizontalLeaderboard(
      chartEl,
      top.map((r) => ({
        label: r.playerName,
        value: r.value,
        href: `#/players/${r.playerId}`,
        sublabel: r.teamName,
      })),
      { valueFormat: metricDef.format, xAxisLabel: metricDef.label },
    );
  }

  renderPlayerTable(tableEl, resp.rows, state);
  caption.textContent =
    `${resp.rows.length} players considered · metric: ${metricDef.label} · minGames ≥ ${resp.minGames}`;
}

async function loadTeams(
  state: ViewState,
  chartEl: HTMLElement,
  tableEl: HTMLElement,
  caption: HTMLElement,
): Promise<void> {
  let resp: TeamLeadersResponse;
  try {
    resp = await getTeamLeaders({ metric: state.teamMetric, limit: 100 });
  } catch (err) {
    showError(chartEl, err);
    showError(tableEl, err);
    return;
  }

  const metricDef = TEAM_METRICS.find((m) => m.key === state.teamMetric)!;
  const top = resp.rows.slice(0, TOP_N);
  chartEl.replaceChildren();
  if (top.length === 0) {
    chartEl.textContent = 'No data yet.';
  } else {
    activeChart = renderHorizontalLeaderboard(
      chartEl,
      top.map((r) => ({
        label: r.teamName,
        value: r.value,
        href: `#/teams/${r.teamId}`,
      })),
      { valueFormat: metricDef.format, xAxisLabel: metricDef.label },
    );
  }

  renderTeamTable(tableEl, resp.rows, state);
  caption.textContent =
    `${resp.rows.length} teams considered · metric: ${metricDef.label} · minGames ≥ 1`;
}

interface ColDef<T> {
  key: string;
  label: string;
  get: (r: T) => number | string | null;
  fmt: (v: number | string | null) => string;
  numeric: boolean;
  render?: (r: T) => HTMLElement | null;
}

const PLAYER_COLS: ReadonlyArray<ColDef<PlayerLeaderRow>> = [
  { key: 'rank', label: '#', get: (r) => r.rank, fmt: (v) => String(v), numeric: true },
  { key: 'playerName', label: 'Player', get: (r) => r.playerName, fmt: (v) => String(v), numeric: false },
  {
    key: 'teamName',
    label: 'Team',
    get: (r) => r.teamName,
    fmt: (v) => String(v),
    numeric: false,
    render: (r) =>
      renderTeamBadge({
        name: r.teamName,
        logoUrl: r.teamLogoUrl,
        size: 'sm',
        href: `#/teams/${r.teamId}`,
      }),
  },
  { key: 'gamesPlayed', label: 'GP', get: (r) => r.gamesPlayed, fmt: (v) => String(v), numeric: true },
  { key: 'goals', label: 'G', get: (r) => r.goals, fmt: (v) => String(v), numeric: true },
  { key: 'assists', label: 'A', get: (r) => r.assists, fmt: (v) => String(v), numeric: true },
  { key: 'points', label: 'P', get: (r) => r.points, fmt: (v) => String(v), numeric: true },
  { key: 'groundBalls', label: 'GB', get: (r) => r.groundBalls, fmt: (v) => String(v), numeric: true },
  { key: 'causedTurnovers', label: 'CT', get: (r) => r.causedTurnovers, fmt: (v) => String(v), numeric: true },
  { key: 'saves', label: 'SV', get: (r) => r.saves, fmt: (v) => String(v), numeric: true },
  { key: 'foWon', label: 'FO W', get: (r) => r.foWon, fmt: (v) => String(v), numeric: true },
  { key: 'foTaken', label: 'FO Att', get: (r) => r.foTaken, fmt: (v) => String(v), numeric: true },
  { key: 'foPct', label: 'FO %', get: (r) => r.foPct, fmt: (v) => pctFmt(typeof v === 'number' ? v : null), numeric: true },
];

const TEAM_COLS: ReadonlyArray<ColDef<TeamLeaderRow>> = [
  { key: 'rank', label: '#', get: (r) => r.rank, fmt: (v) => String(v), numeric: true },
  {
    key: 'teamName',
    label: 'Team',
    get: (r) => r.teamName,
    fmt: (v) => String(v),
    numeric: false,
    render: (r) =>
      renderTeamBadge({
        name: r.teamName,
        logoUrl: r.logoUrl,
        size: 'md',
        href: `#/teams/${r.teamId}`,
      }),
  },
  { key: 'gamesPlayed', label: 'GP', get: (r) => r.gamesPlayed, fmt: (v) => String(v), numeric: true },
  { key: 'wins', label: 'W', get: (r) => r.wins, fmt: (v) => String(v), numeric: true },
  { key: 'losses', label: 'L', get: (r) => r.losses, fmt: (v) => String(v), numeric: true },
  { key: 'winPct', label: 'Win %', get: (r) => r.winPct, fmt: (v) => pctFmt(typeof v === 'number' ? v : null), numeric: true },
  { key: 'goalsFor', label: 'GF', get: (r) => r.goalsFor, fmt: (v) => String(v), numeric: true },
  { key: 'goalsAgainst', label: 'GA', get: (r) => r.goalsAgainst, fmt: (v) => String(v), numeric: true },
  { key: 'goalDiff', label: '+/-', get: (r) => r.goalDiff, fmt: (v) => String(v), numeric: true },
  { key: 'gpg', label: 'GPG', get: (r) => r.gpg, fmt: (v) => floatFmt(typeof v === 'number' ? v : NaN), numeric: true },
  { key: 'gapg', label: 'GAPG', get: (r) => r.gapg, fmt: (v) => floatFmt(typeof v === 'number' ? v : NaN), numeric: true },
];

function renderPlayerTable(
  el: HTMLElement,
  rows: PlayerLeaderRow[],
  state: ViewState,
): void {
  el.replaceChildren(
    buildSortableTable(
      PLAYER_COLS,
      rows,
      state.playerSort,
      (s) => {
        state.playerSort = s;
        renderPlayerTable(el, rows, state);
      },
      (r) => `#/players/${r.playerId}`,
    ),
  );
}

function renderTeamTable(
  el: HTMLElement,
  rows: TeamLeaderRow[],
  state: ViewState,
): void {
  el.replaceChildren(
    buildSortableTable(
      TEAM_COLS,
      rows,
      state.teamSort,
      (s) => {
        state.teamSort = s;
        renderTeamTable(el, rows, state);
      },
      (r) => `#/teams/${r.teamId}`,
    ),
  );
}

function buildSortableTable<T>(
  cols: ReadonlyArray<ColDef<T>>,
  rows: T[],
  sort: { col: string; dir: 'asc' | 'desc' } | null,
  onSort: (next: { col: string; dir: 'asc' | 'desc' }) => void,
  rowHref: (r: T) => string,
): HTMLElement {
  const table = document.createElement('table');
  table.className = 'stat leaders-table';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const col of cols) {
    const th = document.createElement('th');
    th.textContent = col.label;
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    if (sort && sort.col === col.key) {
      th.textContent = `${col.label} ${sort.dir === 'asc' ? '▲' : '▼'}`;
    }
    th.addEventListener('click', () => {
      const dir: 'asc' | 'desc' =
        sort && sort.col === col.key && sort.dir === 'desc' ? 'asc' : 'desc';
      onSort({ col: col.key, dir });
    });
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const sorted = sort
    ? [...rows].sort((a, b) => {
        const col = cols.find((c) => c.key === sort.col);
        if (!col) return 0;
        const av = col.get(a);
        const bv = col.get(b);
        const an = av === null || av === undefined ? -Infinity : av;
        const bn = bv === null || bv === undefined ? -Infinity : bv;
        let cmp: number;
        if (typeof an === 'number' && typeof bn === 'number') {
          cmp = an - bn;
        } else {
          cmp = String(an).localeCompare(String(bn), undefined, { sensitivity: 'base' });
        }
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : rows;

  const tbody = document.createElement('tbody');
  for (const r of sorted) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'link');
    const go = (): void => {
      window.location.hash = rowHref(r);
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
    for (const col of cols) {
      const td = document.createElement('td');
      const v = col.get(r);
      if (col.render) {
        const node = col.render(r);
        if (node) {
          td.appendChild(node);
        } else {
          td.textContent = v === null || v === undefined ? '—' : col.fmt(v);
        }
      } else {
        td.textContent = v === null || v === undefined ? '—' : col.fmt(v);
      }
      if (col.numeric) td.style.textAlign = 'right';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function showError(el: HTMLElement, err: unknown): void {
  el.replaceChildren();
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent =
    err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
  el.appendChild(p);
  if (err instanceof ApiError) {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = "Is the API server running on :3001?";
    el.appendChild(hint);
  }
}
