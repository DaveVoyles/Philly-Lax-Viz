import {
  ApiError,
  getFreshness,
  getGameCalendar,
  getGames,
  getTeams,
  getRecentGames,
  getPlayerLeaders,
  getPostImages,
  type PlayerLeaderRow,
  type PlayerLeaderMetric,
  type PostImage,
  type TeamSeasonRecord,
} from '../api.js';
import type { Game, Team } from '@pll/shared';
import { formatDate } from '../util/format.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { renderPiaaBadge } from '../components/piaaBadge.js';
import { renderGameThumb } from '../components/postImage.js';
import { renderHorizontalLeaderboard } from '../charts/index.js';
import { renderMarginHistogram } from '../charts/marginHistogram.js';
import { renderCalendarHeatmap } from '../charts/calendarHeatmap.js';
import type { ChartHandle } from '../charts/types.js';
import { renderEmptyState } from '../components/emptyState.js';
import { wrapResponsive } from '../util/responsiveTable.js';

type SortKey = 'name' | 'gap' | 'wins';
type SortDir = 'asc' | 'desc';
interface TeamSort { key: SortKey; dir: SortDir; }
interface TeamFilter { hideLowGames: boolean; minGames: number; }

const RECENT_GAME_LIMIT = 25;
const LEADER_PANEL_LIMIT = 10;
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const REFRESH_STATUS_INTERVAL_MS = 30 * 1000;

// Dashboard chart handles, tracked so route teardown can clean up SVGs.
let dashboardCharts: ChartHandle[] = [];
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let refreshStatusInterval: ReturnType<typeof setInterval> | null = null;
let lastRefreshed: Date | null = null;
let isRefreshEnabled = false;
let refreshFailed = false;
let recentGamesSignature = '';

function stopRefresh(): void {
  if (refreshInterval !== null) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (refreshStatusInterval !== null) {
    clearInterval(refreshStatusInterval);
    refreshStatusInterval = null;
  }
}

function updateRefreshStatus(statusEl: HTMLElement): void {
  if (!isRefreshEnabled) {
    statusEl.textContent = '';
    return;
  }
  if (refreshFailed) {
    statusEl.textContent = 'Refresh failed - will retry';
    return;
  }
  if (lastRefreshed === null) {
    statusEl.textContent = 'Live - waiting for initial load';
    return;
  }

  const minutes = Math.floor((Date.now() - lastRefreshed.getTime()) / 60_000);
  statusEl.textContent =
    minutes <= 0
      ? 'Live - last updated just now'
      : `Live - last updated ${minutes} min ago`;
}

function startRefresh(
  gamesTarget: HTMLElement,
  teamById: Map<number, Team>,
  statusEl: HTMLElement,
): void {
  stopRefresh();
  refreshStatusInterval = setInterval(() => {
    updateRefreshStatus(statusEl);
  }, REFRESH_STATUS_INTERVAL_MS);
  refreshInterval = setInterval(() => {
    void refreshGames(gamesTarget, teamById, statusEl);
  }, REFRESH_INTERVAL_MS);
  void refreshGames(gamesTarget, teamById, statusEl);
}

function destroyDashboardCharts(): void {
  stopRefresh();
  for (const c of dashboardCharts) c.destroy();
  dashboardCharts = [];
  lastRefreshed = null;
  isRefreshEnabled = false;
  refreshFailed = false;
  recentGamesSignature = '';
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

  const disclaimer = document.createElement('p');
  disclaimer.className = 'muted';
  disclaimer.style.cssText = 'font-size:0.85rem; margin-top:0.25rem;';
  disclaimer.textContent =
    'Data is compiled from multiple sources (PhillyLacrosse.com, PIAA, MaxPreps) and may be incomplete or contain errors.';
  root.appendChild(disclaimer);

  const teamsSection = document.createElement('section');
  const teamsHeader = document.createElement('h2');
  teamsHeader.textContent = 'All Teams';
  teamsSection.appendChild(teamsHeader);
  teamsSection.appendChild(buildPiaaLegend());
  const teamsBody = document.createElement('div');
  teamsBody.id = 'teams-body';
  teamsBody.textContent = 'Loading…';
  teamsSection.appendChild(teamsBody);
  root.appendChild(teamsSection);

  const gamesSection = document.createElement('section');
  const gamesHeader = document.createElement('h2');
  gamesHeader.textContent = 'Recent Games';
  gamesSection.appendChild(gamesHeader);

  const refreshBar = document.createElement('div');
  refreshBar.style.cssText = 'display:flex; align-items:center; gap:0.75rem; margin:0.25rem 0 0.75rem; font-size:0.85rem;';

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = 'Enable auto-refresh';
  toggleBtn.style.cssText =
    'font-size:0.8rem; padding:0.2rem 0.6rem; border:1px solid var(--border); ' +
    'border-radius:4px; background:none; color:var(--accent); cursor:pointer;';

  const refreshStatus = document.createElement('span');
  refreshStatus.className = 'muted';

  refreshBar.appendChild(toggleBtn);
  refreshBar.appendChild(refreshStatus);
  gamesSection.appendChild(refreshBar);

  const gamesBody = document.createElement('div');
  gamesBody.id = 'games-body';
  gamesBody.textContent = 'Loading…';
  gamesSection.appendChild(gamesBody);
  root.appendChild(gamesSection);

  const marginSection = document.createElement('section');
  const marginHeader = document.createElement('h2');
  marginHeader.textContent = 'Score Margins';
  marginSection.appendChild(marginHeader);
  const marginSub = document.createElement('p');
  marginSub.className = 'muted';
  marginSub.style.fontSize = '0.875rem';
  marginSub.textContent = 'Distribution of final score margins for the season.';
  marginSection.appendChild(marginSub);
  const marginChartDiv = document.createElement('div');
  marginChartDiv.id = 'margin-histogram';
  marginSection.appendChild(marginChartDiv);
  root.appendChild(marginSection);

  const calSection = document.createElement('section');
  const calH2 = document.createElement('h2');
  calH2.textContent = 'Season Calendar';
  calSection.appendChild(calH2);
  const calSub = document.createElement('p');
  calSub.className = 'muted';
  calSub.style.fontSize = '0.875rem';
  calSub.textContent = 'Games played per day. Hover a cell to see the date and game count.';
  calSection.appendChild(calSub);
  const calDiv = document.createElement('div');
  calDiv.id = 'season-calendar';
  calSection.appendChild(calDiv);
  root.appendChild(calSection);

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

  let currentTeamById: Map<number, Team> | null = null;
  toggleBtn.addEventListener('click', () => {
    isRefreshEnabled = !isRefreshEnabled;
    refreshFailed = false;
    toggleBtn.textContent = isRefreshEnabled ? 'Disable auto-refresh' : 'Enable auto-refresh';
    if (!isRefreshEnabled) {
      stopRefresh();
      refreshStatus.textContent = '';
      return;
    }
    if (currentTeamById) {
      startRefresh(gamesBody, currentTeamById, refreshStatus);
    } else {
      updateRefreshStatus(refreshStatus);
    }
  });

  void loadTeamsAndGames(teamsBody, gamesBody, marginChartDiv, refreshStatus, (teamById) => {
    currentTeamById = teamById;
    if (isRefreshEnabled) startRefresh(gamesBody, currentTeamById, refreshStatus);
  });

  void getGameCalendar()
    .then((calDays) => {
      if (calDays.length > 0) {
        const handle = renderCalendarHeatmap(calDiv, calDays);
        dashboardCharts.push(handle);
      } else {
        calDiv.textContent = 'No games recorded yet.';
      }
    })
    .catch(() => {
      calDiv.textContent = '';
    });
  void loadLeaderPanel(savesPanel.body, 'saves', { minGames: 3 }, intFmt, 'Saves');
  void loadLeaderPanel(foPctPanel.body, 'fo_pct', { minAttempts: 20 }, pctFmt, 'FO %');
  void loadLeaderPanel(gbPanel.body, 'ground_balls', { minGames: 3 }, intFmt, 'Ground balls');

  // Wave H4 Lane 3 (Leia) — "Data updated X ago" footer line at the very
  // bottom of the dashboard. Sourced from /api/freshness; silent on failure
  // so a server outage never breaks the dashboard.
  const freshnessLine = document.createElement('p');
  freshnessLine.className = 'muted';
  freshnessLine.dataset['testid'] = 'dashboard-freshness';
  freshnessLine.textContent = 'Data freshness: checking…';
  root.appendChild(freshnessLine);
  void loadDashboardFreshness(freshnessLine);
}

async function loadDashboardFreshness(target: HTMLElement): Promise<void> {
  try {
    const data = await getFreshness();
    if (!data.lastIngestAt) {
      target.textContent = 'Data freshness: unknown';
      return;
    }
    const t = Date.parse(data.lastIngestAt);
    if (Number.isNaN(t)) {
      target.textContent = 'Data freshness: unknown';
      return;
    }
    const ms = Date.now() - t;
    const min = Math.round(ms / 60_000);
    const rel =
      min < 60
        ? `${min} minutes`
        : min < 24 * 60
          ? `${Math.round(min / 60)} hours`
          : `${Math.round(min / 60 / 24)} days`;
    target.textContent = `Data updated ${rel} ago.`;
  } catch {
    target.textContent = '';
  }
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
      el.appendChild(renderEmptyState({ subject: 'qualifying players' }));
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
      { valueFormat: format, xAxisLabel: axisLabel, height: 360, margin: { top: 16, right: 56, bottom: 36, left: 170 } },
    );
    dashboardCharts.push(handle);
  } catch (err) {
    el.replaceChildren(errorBlock(err));
  }
}

// PIAA validation badge legend. Explains the ✅/⚠️/🔴/⚪ icons next to team
// names and reminds the reader that PIAA always wins on conflict (decision
// 2026-04-23, enforced server-side in routes/teams.ts).
const PIAA_LEGEND_ROWS: ReadonlyArray<{
  icon: string;
  status: string;
  meaning: string;
}> = [
  { icon: '✅', status: 'match',     meaning: 'Our derived W-L matches the official PIAA record exactly.' },
  { icon: '⚠️', status: 'close',     meaning: 'Off by 1-2 games. Displayed record uses PIAA; the small gap is flagged for follow-up.' },
  { icon: '🔴', status: 'divergent', meaning: 'Material disagreement. Displayed record uses PIAA — investigate our coverage gap.' },
  { icon: '⚪', status: 'unmapped',  meaning: 'No PIAA mapping (private/out-of-state, or not yet linked). Displayed record falls back to PhillyLacrosse-derived.' },
];

function buildPiaaLegend(): HTMLElement {
  const details = document.createElement('details');
  details.className = 'piaa-legend';
  const summary = document.createElement('summary');
  summary.textContent = 'What do the icons and numbers mean?';
  details.appendChild(summary);

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent =
    'When the official PIAA record disagrees with our PhillyLacrosse-scraped record, ' +
    'PIAA always wins. Hover any team badge for the exact diff; click through to see the source.';
  details.appendChild(note);

  const table = document.createElement('table');
  table.className = 'piaa-legend__table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of ['Icon', 'Status', 'Meaning']) {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of PIAA_LEGEND_ROWS) {
    const tr = document.createElement('tr');
    const iconCell = document.createElement('td');
    iconCell.className = 'piaa-legend__icon';
    iconCell.textContent = row.icon;
    const statusCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = row.status;
    statusCell.appendChild(code);
    const meaningCell = document.createElement('td');
    meaningCell.textContent = row.meaning;
    tr.appendChild(iconCell);
    tr.appendChild(statusCell);
    tr.appendChild(meaningCell);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);

  // Gap number legend
  const gapHeading = document.createElement('p');
  gapHeading.style.cssText = 'margin: 0.75rem 0 0.25rem; font-weight: 600; font-size: 0.9rem;';
  gapHeading.textContent = 'The number on the right of each team row:';
  details.appendChild(gapHeading);

  const gapRows: { label: string; meaning: string }[] = [
    { label: '✓',   meaning: 'All games accounted for — our count matches PIAA exactly.' },
    { label: '2, 3, …', meaning: 'We are missing that many games compared to the official PIAA total. The score or summary may not have been published yet.' },
    { label: '+1, +4, …', meaning: 'We have more games on file than PIAA lists — usually pre-season scrimmages or junior-varsity games picked up by the scraper.' },
    { label: '—',   meaning: 'No PIAA reference data available for this team.' },
  ];

  const gapTable = document.createElement('table');
  gapTable.className = 'piaa-legend__table';
  const gapTbody = document.createElement('tbody');
  for (const row of gapRows) {
    const tr = document.createElement('tr');
    const labelCell = document.createElement('td');
    labelCell.className = 'piaa-legend__icon';
    labelCell.style.fontVariantNumeric = 'tabular-nums';
    labelCell.textContent = row.label;
    const meaningCell = document.createElement('td');
    meaningCell.setAttribute('colspan', '2');
    meaningCell.textContent = row.meaning;
    tr.appendChild(labelCell);
    tr.appendChild(meaningCell);
    gapTbody.appendChild(tr);
  }
  gapTable.appendChild(gapTbody);
  details.appendChild(gapTable);

  return details;
}

async function loadTeamsAndGames(
  teamsTarget: HTMLElement,
  gamesTarget: HTMLElement,
  marginTarget: HTMLElement,
  refreshStatus: HTMLElement,
  onTeamsReady: (teamById: Map<number, Team>) => void,
): Promise<void> {
  let teams: TeamSeasonRecord[];
  try {
    teams = await getTeams();
  } catch (err) {
    teamsTarget.replaceChildren(errorBlock(err));
    gamesTarget.replaceChildren(errorBlock(err));
    marginTarget.replaceChildren(errorBlock(err));
    return;
  }

  const sort: TeamSort = { key: 'wins', dir: 'desc' };
  // Out-of-area teams typically appear in our DB only if they played a single
  // crossover/showcase against a Philly team. Hide them by default so the
  // grid focuses on teams with real season presence.
  const filter: TeamFilter = { hideLowGames: true, minGames: 6 };
  const renderGrid = (): void => {
    teamsTarget.replaceChildren(buildTeamsGrid(teams, sort, filter, {
      onSort: (next) => {
        sort.key = next.key;
        sort.dir = next.dir;
        renderGrid();
      },
      onFilter: (next) => {
        filter.hideLowGames = next.hideLowGames;
        filter.minGames = next.minGames;
        renderGrid();
      },
    }));
  };
  renderGrid();

  const teamById = new Map<number, Team>(teams.map((t) => [t.id, t]));
  onTeamsReady(teamById);

  const [recentGamesResult, allGamesResult] = await Promise.allSettled([
    getRecentGames(RECENT_GAME_LIMIT),
    getGames(),
  ]);

  if (recentGamesResult.status === 'fulfilled') {
    const games = recentGamesResult.value;
    await renderGamesList(gamesTarget, games, teamById);
    recentGamesSignature = buildGameSignature(games);
    lastRefreshed = new Date();
    refreshFailed = false;
    if (isRefreshEnabled) updateRefreshStatus(refreshStatus);
  } else {
    gamesTarget.replaceChildren(errorBlock(recentGamesResult.reason));
  }

  if (allGamesResult.status === 'fulfilled') {
    const handle = renderMarginHistogram(marginTarget, allGamesResult.value);
    dashboardCharts.push(handle);
  } else {
    const msg = document.createElement('p');
    msg.className = 'muted';
    msg.textContent = 'Score margin data unavailable.';
    marginTarget.replaceChildren(msg);
  }
}

function sortTeams(teams: TeamSeasonRecord[], sort: TeamSort): TeamSeasonRecord[] {
  const out = [...teams];
  const factor = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'name') {
    out.sort((a, b) => factor * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }
  if (sort.key === 'wins') {
    out.sort((a, b) => {
      const aw = a.wins ?? 0;
      const bw = b.wins ?? 0;
      if (aw !== bw) return factor * (bw - aw); // higher wins first when desc
      // tiebreak: win% (wins / total games)
      const ag = (a.wins ?? 0) + (a.losses ?? 0);
      const bg = (b.wins ?? 0) + (b.losses ?? 0);
      const apct = ag > 0 ? aw / ag : 0;
      const bpct = bg > 0 ? bw / bg : 0;
      if (apct !== bpct) return factor * (bpct - apct);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
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
  { value: 'wins-desc', key: 'wins', dir: 'desc', label: 'Wins (most first)' },
  { value: 'wins-asc', key: 'wins', dir: 'asc', label: 'Wins (least first)' },
  { value: 'name-asc', key: 'name', dir: 'asc', label: 'Name (A-Z)' },
  { value: 'name-desc', key: 'name', dir: 'desc', label: 'Name (Z-A)' },
  { value: 'gap-asc', key: 'gap', dir: 'asc', label: 'Data gap (smallest first)' },
  { value: 'gap-desc', key: 'gap', dir: 'desc', label: 'Data gap (largest first)' },
];

function buildTeamsGrid(
  teams: TeamSeasonRecord[],
  sort: TeamSort,
  filter: TeamFilter,
  callbacks: {
    onSort: (next: TeamSort) => void;
    onFilter: (next: TeamFilter) => void;
  },
): HTMLElement {
  const wrap = document.createElement('div');

  if (teams.length === 0) {
    wrap.appendChild(
      renderEmptyState({
        subject: 'teams',
        hint: 'Try a different season, or run `pnpm ingest` to populate the database.',
      }),
    );
    return wrap;
  }

  // Sort + filter controls
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
    if (picked) callbacks.onSort({ key: picked.key, dir: picked.dir });
  });
  label.appendChild(select);
  controls.appendChild(label);

  // Min-games filter. Hides out-of-area teams that only show up because they
  // played a single Philly opponent in a showcase / non-conference game.
  const filterLabel = document.createElement('label');
  filterLabel.className = 'muted teams-filter';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = filter.hideLowGames;
  cb.addEventListener('change', () => {
    callbacks.onFilter({ hideLowGames: cb.checked, minGames: filter.minGames });
  });
  filterLabel.appendChild(cb);
  filterLabel.append(' Hide teams with fewer than ');
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.min = '1';
  minInput.max = '50';
  minInput.value = String(filter.minGames);
  minInput.className = 'teams-filter__min';
  minInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(50, Number.parseInt(minInput.value, 10) || filter.minGames));
    callbacks.onFilter({ hideLowGames: filter.hideLowGames, minGames: n });
  });
  filterLabel.appendChild(minInput);
  filterLabel.append(' games');
  controls.appendChild(filterLabel);

  // Apply the filter so we can render an accurate "X of Y" count.
  const visible = filter.hideLowGames
    ? teams.filter((t) => teamGameCount(t) >= filter.minGames)
    : teams;

  const count = document.createElement('span');
  count.className = 'muted';
  count.textContent =
    visible.length === teams.length
      ? ` ${teams.length} teams`
      : ` ${visible.length} of ${teams.length} teams`;
  controls.appendChild(count);
  wrap.appendChild(controls);

  // Grid
  const sorted = sortTeams(visible, sort);
  const ul = document.createElement('ul');
  ul.className = 'team-grid';
  for (const t of sorted) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#/teams/${t.id}`;
    if (isValidHexColor(t.primaryColor)) {
      a.style.borderLeft = `4px solid ${t.primaryColor}`;
    }
    a.appendChild(renderTeamBadge({ name: t.name, logoUrl: t.logoUrl, primaryColor: t.primaryColor, size: 'sm' }));
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
    // W-L record chip
    if ((t.wins ?? 0) + (t.losses ?? 0) > 0) {
      const rec = document.createElement('span');
      rec.className = 'team-row__record';
      rec.textContent = `${t.wins ?? 0}–${t.losses ?? 0}`;
      rec.title = `${t.wins ?? 0} wins, ${t.losses ?? 0} losses`;
      a.appendChild(rec);
    }
    const streakChip = buildStreakChip(t);
    if (streakChip) a.appendChild(streakChip);
    li.appendChild(a);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function isValidHexColor(color: string | null | undefined): color is string {
  return !!color && /^#[0-9a-fA-F]{3,6}$/.test(color);
}

// Total games we have for a team this season. Prefer the explicit coverage
// count (server-computed from the games table) and fall back to W+L when
// coverage isn't populated.
export function teamGameCount(t: TeamSeasonRecord): number {
  const ours = t.coverage?.ourGames;
  if (typeof ours === 'number') return ours;
  return (t.wins ?? 0) + (t.losses ?? 0);
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

function buildStreakChip(t: TeamSeasonRecord): HTMLSpanElement | null {
  if (t.streak === null || t.streak === undefined) return null;

  const span = document.createElement('span');
  span.className = 'team-row__streak';
  span.style.cssText =
    'display:inline-flex; align-items:center; justify-content:center; min-width:2rem; padding:0.15rem 0.45rem; border-radius:999px; font-size:0.75rem; font-weight:700; line-height:1;';

  if (t.streak > 0) {
    span.textContent = `W${t.streak}`;
    span.title = `${t.streak}-game win streak`;
    span.style.background = 'rgba(34, 197, 94, 0.15)';
    span.style.color = '#166534';
    return span;
  }

  if (t.streak < 0) {
    span.textContent = `L${Math.abs(t.streak)}`;
    span.title = `${Math.abs(t.streak)}-game losing streak`;
    span.style.background = 'rgba(239, 68, 68, 0.15)';
    span.style.color = '#991b1b';
    return span;
  }

  span.textContent = 'T';
  span.title = 'Last game was a tie';
  span.style.background = 'rgba(107, 114, 128, 0.18)';
  span.style.color = '#374151';
  return span;
}

function buildGameSignature(games: Game[]): string {
  return [...games]
    .sort((a, b) => a.id - b.id)
    .map((g) => `${g.id}:${g.awayScore}:${g.homeScore}:${g.postponed ? 1 : 0}`)
    .join('|');
}

async function loadRecentGameImages(games: Game[]): Promise<Record<string, PostImage>> {
  try {
    const slugs = games.map((g) => g.sourcePostId).filter((slug): slug is string => !!slug);
    return slugs.length > 0 ? await getPostImages(slugs) : {};
  } catch {
    return {};
  }
}

async function renderGamesList(
  container: HTMLElement,
  games: Game[],
  teamById: Map<number, Team>,
): Promise<void> {
  const images = await loadRecentGameImages(games);
  container.replaceChildren(buildRecentGamesTable(games, teamById, images));
}

async function refreshGames(
  container: HTMLElement,
  teamById: Map<number, Team>,
  statusEl: HTMLElement,
): Promise<void> {
  try {
    const games = await getRecentGames(RECENT_GAME_LIMIT);
    const nextSignature = buildGameSignature(games);
    if (nextSignature !== recentGamesSignature) {
      await renderGamesList(container, games, teamById);
      recentGamesSignature = nextSignature;
    }
    lastRefreshed = new Date();
    refreshFailed = false;
    updateRefreshStatus(statusEl);
  } catch {
    refreshFailed = true;
    updateRefreshStatus(statusEl);
  }
}

function buildRecentGamesTable(
  games: Game[],
  teamById: Map<number, Team>,
  images: Record<string, PostImage> = {},
): HTMLElement {
  if (games.length === 0) {
    return renderEmptyState({ subject: 'games' });
  }

  const sorted = [...games].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });

  const table = document.createElement('table');
  table.className = 'stat recent-games';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const headerCols: { label: string; secondary?: boolean }[] = [
    { label: '', secondary: true },
    { label: 'Date' },
    { label: 'Matchup' },
    { label: 'Score' },
  ];
  for (const col of headerCols) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.secondary) th.classList.add('col-secondary');
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
      window.location.hash = `#/game/${g.id}`;
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });

    // Wave 17 Lane 2 (Han) -- tiny recap thumbnail (60x40) if we have one.
    const tdImg = document.createElement('td');
    tdImg.style.width = '64px';
    tdImg.classList.add('col-secondary');
    const img = images[g.sourcePostId];
    if (img) {
      tdImg.appendChild(renderGameThumb(img.imageUrl, img.altText));
    }
    tr.appendChild(tdImg);

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
    if (g.postponed) {
      tdScore.textContent = '—';
    } else {
      const margin = (g.awayScore ?? 0) - (g.homeScore ?? 0);
      const abs = Math.abs(margin);
      tdScore.textContent = `${g.awayScore}–${g.homeScore}`;
      const marginSpan = document.createElement('span');
      marginSpan.className = 'score-margin muted';
      marginSpan.textContent = ` (${abs === 0 ? 'OT' : margin > 0 ? `+${abs}` : `-${abs}`})`;
      marginSpan.title = abs === 0 ? 'Tied (likely overtime)' : `Margin of ${abs}`;
      tdScore.appendChild(marginSpan);
    }
    tr.appendChild(tdScore);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return wrapResponsive(table);
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
