import {
  ApiError,
  getServerHealth,
  getTeams,
  getRecentGames,
  getPlayerLeaders,
  type PlayerLeaderRow,
  type PlayerLeaderMetric,
  type ServerHealthResponse,
  type TeamSeasonRecord,
} from '../api.js';
import type { Game, Team } from '@pll/shared';
import { formatDate } from '../util/format.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { renderPiaaBadge } from '../components/piaaBadge.js';
import { renderHorizontalLeaderboard } from '../charts/index.js';
import type { ChartHandle } from '../charts/types.js';

type SortKey = 'name' | 'gap';
type SortDir = 'asc' | 'desc';
interface TeamSort { key: SortKey; dir: SortDir; }

const RECENT_GAME_LIMIT = 25;
const LEADER_PANEL_LIMIT = 10;

// Dashboard chart handles, tracked so route teardown can clean up SVGs.
let dashboardCharts: ChartHandle[] = [];

function destroyDashboardCharts(): void {
  for (const c of dashboardCharts) c.destroy();
  dashboardCharts = [];
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  destroyDashboardCharts();
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Philly Lacrosse — Boys HS';
  root.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent = 'Season scoreboard, team records, and recent games.';
  root.appendChild(sub);

  // Prominent League Leaders nav card
  const leadersCard = document.createElement('a');
  leadersCard.href = '#/leaders';
  leadersCard.className = 'leaders-card';
  leadersCard.style.cssText =
    'display:flex; align-items:center; justify-content:space-between; padding:1rem 1.25rem; margin:1rem 0 1.5rem; border:1px solid var(--accent); border-radius:8px; background:var(--accent); color:var(--accent-fg); text-decoration:none; font-weight:600;';
  const leadersText = document.createElement('span');
  leadersText.textContent = '🏆 League Leaders — top players & teams across every metric';
  const leadersArrow = document.createElement('span');
  leadersArrow.textContent = '→';
  leadersArrow.style.fontSize = '1.25rem';
  leadersCard.appendChild(leadersText);
  leadersCard.appendChild(leadersArrow);
  root.appendChild(leadersCard);

  const healthSection = document.createElement('section');
  const healthHeader = document.createElement('h2');
  healthHeader.textContent = 'System health';
  healthSection.appendChild(healthHeader);
  const healthBanner = document.createElement('div');
  healthBanner.id = 'health-banner';
  healthBanner.textContent = 'Loading…';
  healthSection.appendChild(healthBanner);
  root.appendChild(healthSection);

  const teamsSection = document.createElement('section');
  const teamsHeader = document.createElement('h2');
  teamsHeader.textContent = 'All Teams';
  teamsSection.appendChild(teamsHeader);
  const teamsBody = document.createElement('div');
  teamsBody.id = 'teams-body';
  teamsBody.textContent = 'Loading…';
  teamsSection.appendChild(teamsBody);
  root.appendChild(teamsSection);

  const gamesSection = document.createElement('section');
  const gamesHeader = document.createElement('h2');
  gamesHeader.textContent = 'Recent Games';
  gamesSection.appendChild(gamesHeader);
  const gamesBody = document.createElement('div');
  gamesBody.id = 'games-body';
  gamesBody.textContent = 'Loading…';
  gamesSection.appendChild(gamesBody);
  root.appendChild(gamesSection);

  // Stat-leader panels (saves / faceoff% / ground balls). Surfaced on the
  // dashboard so the home page isn't goal-only — full leaderboards still
  // live at /#/leaders. See Wave 10 Lane 2.
  const leadersSection = document.createElement('section');
  const leadersHeader = document.createElement('h2');
  leadersHeader.textContent = 'Stat Leaders';
  leadersSection.appendChild(leadersHeader);
  const leadersSub = document.createElement('p');
  leadersSub.className = 'muted';
  leadersSub.textContent =
    'Top goalies (saves), faceoff specialists (FO%), and ground-ball leaders. Thresholds applied to filter small-sample noise.';
  leadersSection.appendChild(leadersSub);

  const panelsGrid = document.createElement('div');
  panelsGrid.className = 'leader-panels';
  panelsGrid.style.cssText =
    'display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:1rem; margin-top:.5rem;';
  leadersSection.appendChild(panelsGrid);

  const savesPanel = makeLeaderPanel('Save Leaders', 'Top goalies by total saves (min 3 games).');
  const foPctPanel = makeLeaderPanel(
    'Faceoff Win % Leaders',
    'Best faceoff conversion rate (min 20 attempts).',
  );
  const gbPanel = makeLeaderPanel('Ground Ball Leaders', 'Most ground balls collected (min 3 games).');
  panelsGrid.appendChild(savesPanel.wrap);
  panelsGrid.appendChild(foPctPanel.wrap);
  panelsGrid.appendChild(gbPanel.wrap);
  root.appendChild(leadersSection);

  void loadHealth(healthBanner);
  void loadTeamsAndGames(teamsBody, gamesBody);
  void loadLeaderPanel(savesPanel.body, 'saves', { minGames: 3 }, intFmt, 'Saves');
  void loadLeaderPanel(foPctPanel.body, 'fo_pct', { minAttempts: 20 }, pctFmt, 'FO %');
  void loadLeaderPanel(gbPanel.body, 'ground_balls', { minGames: 3 }, intFmt, 'Ground balls');
}

function intFmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n)) : '—';
}
function pctFmt(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}

interface LeaderPanel {
  wrap: HTMLElement;
  body: HTMLElement;
}

function makeLeaderPanel(title: string, sub: string): LeaderPanel {
  const wrap = document.createElement('div');
  wrap.className = 'leader-panel';
  wrap.style.cssText =
    'border:1px solid var(--border); border-radius:8px; padding:.75rem 1rem; background:var(--bg-elev, transparent);';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  h3.style.cssText = 'margin:0 0 .25rem; font-size:1rem;';
  wrap.appendChild(h3);
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.cssText = 'margin:.1rem 0 .5rem; font-size:.85rem;';
  p.textContent = sub;
  wrap.appendChild(p);
  const body = document.createElement('div');
  body.textContent = 'Loading…';
  wrap.appendChild(body);
  return { wrap, body };
}

async function loadLeaderPanel(
  el: HTMLElement,
  metric: PlayerLeaderMetric,
  extra: { minGames?: number; minAttempts?: number },
  format: (n: number) => string,
  axisLabel: string,
): Promise<void> {
  try {
    const resp = await getPlayerLeaders({ metric, limit: LEADER_PANEL_LIMIT, ...extra });
    el.replaceChildren();
    const top = resp.rows.slice(0, LEADER_PANEL_LIMIT);
    if (top.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No qualifying players yet.';
      el.appendChild(p);
      return;
    }
    const handle = renderHorizontalLeaderboard(
      el,
      top.map((r: PlayerLeaderRow) => ({
        label: r.playerName,
        value: r.value,
        href: `#/players/${r.playerId}`,
        sublabel: r.teamName,
      })),
      { valueFormat: format, xAxisLabel: axisLabel, height: 320, margin: { top: 16, right: 48, bottom: 32, left: 140 } },
    );
    dashboardCharts.push(handle);
  } catch (err) {
    el.replaceChildren(errorBlock(err));
  }
}

async function loadHealth(target: HTMLElement): Promise<void> {
  try {
    const h = await getServerHealth();
    target.replaceChildren(buildHealthBanner(h));
  } catch (err) {
    target.replaceChildren(errorBlock(err, "Is Leia's API server running on :3001?"));
  }
}

function buildHealthBanner(h: ServerHealthResponse): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `health-banner ${h.ok ? 'ok' : 'degraded'}`;

  const status = document.createElement('strong');
  status.textContent = h.ok ? 'OK' : 'DEGRADED';
  wrap.appendChild(status);

  const counts = h.dbRows;
  const summary = document.createElement('span');
  summary.className = 'muted';
  summary.textContent =
    ` · ${counts.teams} teams · ${counts.games} games · ${counts.players} players` +
    ` · ${counts.playerStats} stat lines · ${counts.rankings} rankings · ${counts.anomalies} anomalies`;
  wrap.appendChild(summary);
  return wrap;
}

async function loadTeamsAndGames(
  teamsTarget: HTMLElement,
  gamesTarget: HTMLElement,
): Promise<void> {
  let teams: TeamSeasonRecord[];
  try {
    teams = await getTeams();
  } catch (err) {
    teamsTarget.replaceChildren(errorBlock(err));
    gamesTarget.replaceChildren(errorBlock(err));
    return;
  }

  const sort: TeamSort = { key: 'name', dir: 'asc' };
  const renderGrid = (): void => {
    teamsTarget.replaceChildren(buildTeamsGrid(teams, sort, (next) => {
      sort.key = next.key;
      sort.dir = next.dir;
      renderGrid();
    }));
  };
  renderGrid();

  try {
    const games = await getRecentGames(RECENT_GAME_LIMIT);
    const teamById = new Map<number, Team>(teams.map((t) => [t.id, t]));
    gamesTarget.replaceChildren(buildRecentGamesTable(games, teamById));
  } catch (err) {
    gamesTarget.replaceChildren(errorBlock(err));
  }
}

function sortTeams(teams: TeamSeasonRecord[], sort: TeamSort): TeamSeasonRecord[] {
  const out = [...teams];
  const factor = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'name') {
    out.sort((a, b) => factor * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }
  // gap: nulls (no PIAA data) always pushed to the bottom
  out.sort((a, b) => {
    const ag = a.coverage?.gap ?? null;
    const bg = b.coverage?.gap ?? null;
    if (ag === null && bg === null) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
    if (ag === null) return 1;
    if (bg === null) return -1;
    if (ag === bg) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return factor * (ag - bg);
  });
  return out;
}

const SORT_OPTIONS: { value: string; key: SortKey; dir: SortDir; label: string }[] = [
  { value: 'name-asc', key: 'name', dir: 'asc', label: 'Name (A-Z)' },
  { value: 'name-desc', key: 'name', dir: 'desc', label: 'Name (Z-A)' },
  { value: 'gap-asc', key: 'gap', dir: 'asc', label: 'Data gap (smallest first)' },
  { value: 'gap-desc', key: 'gap', dir: 'desc', label: 'Data gap (largest first)' },
];

function buildTeamsGrid(
  teams: TeamSeasonRecord[],
  sort: TeamSort,
  onSort: (next: TeamSort) => void,
): HTMLElement {
  const wrap = document.createElement('div');

  if (teams.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No teams yet -- run `pnpm ingest` to populate the database.';
    wrap.appendChild(p);
    return wrap;
  }

  // Sort control
  const controls = document.createElement('div');
  controls.className = 'teams-controls';
  const label = document.createElement('label');
  label.className = 'muted';
  label.textContent = 'Sort: ';
  const select = document.createElement('select');
  select.className = 'teams-sort';
  for (const opt of SORT_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.key === sort.key && opt.dir === sort.dir) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    const picked = SORT_OPTIONS.find((o) => o.value === select.value);
    if (picked) onSort({ key: picked.key, dir: picked.dir });
  });
  label.appendChild(select);
  controls.appendChild(label);
  const count = document.createElement('span');
  count.className = 'muted';
  count.textContent = ` ${teams.length} teams`;
  controls.appendChild(count);
  wrap.appendChild(controls);

  // Grid
  const sorted = sortTeams(teams, sort);
  const ul = document.createElement('ul');
  ul.className = 'team-grid';
  for (const t of sorted) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#/teams/${t.id}`;
    a.appendChild(renderTeamBadge({ name: t.name, logoUrl: t.logoUrl, size: 'sm' }));
    if (t.piaaValidation) {
      const badge = renderPiaaBadge({
        validation: t.piaaValidation,
        derived: t.derivedRecord ?? null,
        piaa: t.piaa ?? null,
        hideUnmapped: false,
      });
      if (badge) {
        badge.style.marginLeft = '.35rem';
        a.appendChild(badge);
      }
    }
    a.appendChild(buildGapBadge(t));
    li.appendChild(a);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function buildGapBadge(t: TeamSeasonRecord): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'team-row__gap';
  const cov = t.coverage;
  if (!cov || cov.piaaGames === null || cov.gap === null) {
    span.textContent = '\u2014';
    span.classList.add('team-row__gap--unknown');
    span.title = 'No PIAA reference data for this team';
    return span;
  }
  const ours = cov.ourGames;
  const piaa = cov.piaaGames;
  if (cov.gap === 0) {
    span.textContent = '\u2713';
    span.classList.add('team-row__gap--complete');
    span.title = `${ours} of ${piaa} games tracked`;
  } else if (cov.gap > 0) {
    span.textContent = String(cov.gap);
    span.classList.add('team-row__gap--missing');
    span.title = `${ours} of ${piaa} games tracked (${cov.gap} missing vs PIAA)`;
  } else {
    span.textContent = `+${Math.abs(cov.gap)}`;
    span.classList.add('team-row__gap--extra');
    span.title = `${ours} games tracked vs ${piaa} on PIAA (extra: scrimmages or non-varsity)`;
  }
  return span;
}

function buildRecentGamesTable(games: Game[], teamById: Map<number, Team>): HTMLElement {
  if (games.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No games yet.';
    return p;
  }

  const sorted = [...games].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });

  const table = document.createElement('table');
  table.className = 'stat recent-games';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Date', 'Matchup', 'Score']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const g of sorted) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'link');
    const go = (): void => {
      window.location.hash = `#/games/${g.id}`;
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(g.date);
    tr.appendChild(tdDate);

    const away = teamById.get(g.awayTeamId);
    const home = teamById.get(g.homeTeamId);
    const tdMatch = document.createElement('td');
    const matchupWrap = document.createElement('span');
    matchupWrap.className = 'matchup';
    matchupWrap.style.cssText = 'display:inline-flex; align-items:center; gap:.4rem; flex-wrap:wrap;';
    matchupWrap.appendChild(
      renderTeamBadge({
        name: away?.name ?? `Team #${g.awayTeamId}`,
        logoUrl: away?.logoUrl ?? null,
        size: 'md',
      }),
    );
    const at = document.createElement('span');
    at.className = 'muted';
    at.textContent = '@';
    matchupWrap.appendChild(at);
    matchupWrap.appendChild(
      renderTeamBadge({
        name: home?.name ?? `Team #${g.homeTeamId}`,
        logoUrl: home?.logoUrl ?? null,
        size: 'md',
      }),
    );
    tdMatch.appendChild(matchupWrap);
    if (g.postponed || g.otPeriods > 0) {
      const note = document.createElement('span');
      note.className = 'muted';
      note.style.marginLeft = '.4rem';
      const bits: string[] = [];
      if (g.postponed) bits.push('(postponed)');
      if (g.otPeriods > 0) bits.push(`(OT${g.otPeriods > 1 ? `x${g.otPeriods}` : ''})`);
      note.textContent = bits.join(' ');
      tdMatch.appendChild(note);
    }
    tr.appendChild(tdMatch);

    const tdScore = document.createElement('td');
    tdScore.textContent = g.postponed ? '—' : `${g.awayScore}–${g.homeScore}`;
    tr.appendChild(tdScore);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function errorBlock(err: unknown, hint?: string): HTMLElement {
  const wrap = document.createElement('div');
  const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = msg;
  wrap.appendChild(p);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'muted';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}
