import {
  ApiError,
  getFreshness,
  getGameCalendar,
  getGames,
  getTeams,
  getPlayerLeaders,
  getPostImages,
  type PlayerLeaderRow,
  type PlayerLeaderMetric,
  type PostImage,
  type TeamSeasonRecord,
} from '../api.js';
import type { Game, Team } from '@pll/shared';
import { renderCalendarHeatmap } from '../charts/calendarHeatmap.js';
import { renderHorizontalLeaderboard } from '../charts/index.js';
import { renderMarginHistogram } from '../charts/marginHistogram.js';
import type { ChartHandle } from '../charts/types.js';
import { renderEmptyState } from '../components/emptyState.js';
import { renderGameThumb } from '../components/postImage.js';
import { mountTeamCardGlow, type GlowHandle } from '../components/teamCardGlow.js';
import { mountHypeCard, type HypeCardHandle, type HypePlayerData } from '../components/hypeCard.js';
import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { IS_STATIC } from '../staticLoader.js';
import { formatDate } from '../util/format.js';
import { createPoller, isActiveSeason } from '../util/livePoller.js';
import { wrapResponsive } from '../util/responsiveTable.js';
import { buildStreakChip, ensureStreakChipStyles } from '../util/streakChip.js';
import { renderTeamBadge } from '../components/teamBadge.js';

type SortKey = 'name' | 'gap' | 'wins';
type SortDir = 'asc' | 'desc';
interface TeamSort { key: SortKey; dir: SortDir; }
interface TeamFilter { hideLowGames: boolean; minGames: number; }

const RECENT_GAME_DAYS = 7;
const LEADER_PANEL_LIMIT = 10;
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const DASHBOARD_LIVE_STYLE_ID = 'dashboard-live-poller-styles';

// Dashboard chart handles, tracked so route teardown can clean up SVGs.
let dashboardCharts: ChartHandle[] = [];
let recentGamesPoller: { stop: () => void } | null = null;
let recentGamesLastUpdated: Date | null = null;
let recentGamesSignature = '';

// WebGL effect handles — cleaned up on route teardown.
let glowHandle: GlowHandle | null = null;
let hypeCardHandle: HypeCardHandle | null = null;
let teamHypeCardHandle: HypeCardHandle | null = null;

function ensureDashboardLiveStyles(): void {
  if (document.getElementById(DASHBOARD_LIVE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DASHBOARD_LIVE_STYLE_ID;
  style.textContent = `
    .recent-games-header { display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; }
    .recent-games-header h2 { margin:0; }
    .live-dot { color:#ef4444; font-size:0.7rem; font-weight:700; animation:livePulse 1.5s ease-in-out infinite; }
    .last-updated { font-size:0.65rem; color:#9ca3af; }
    @keyframes livePulse { 0%, 100% { opacity:1; } 50% { opacity:0.4; } }
  `;
  document.head.appendChild(style);
}

function shouldAutoRefreshRecentGames(): boolean {
  return !IS_STATIC && isActiveSeason();
}

function stopRefresh(): void {
  recentGamesPoller?.stop();
  recentGamesPoller = null;
}

function updateLastUpdated(timestampEl: HTMLElement): void {
  if (!shouldAutoRefreshRecentGames() || recentGamesLastUpdated === null) {
    timestampEl.textContent = '';
    return;
  }
  timestampEl.textContent = `Updated ${recentGamesLastUpdated.toLocaleTimeString()}`;
}

function startRefresh(
  gamesTarget: HTMLElement,
  teamById: Map<number, Team>,
  timestampEl: HTMLElement,
): void {
  stopRefresh();
  if (!shouldAutoRefreshRecentGames()) {
    updateLastUpdated(timestampEl);
    return;
  }
  recentGamesPoller = createPoller(() => refreshGames(gamesTarget, teamById, timestampEl), REFRESH_INTERVAL_MS);
}

function destroyDashboardCharts(): void {
  stopRefresh();
  for (const c of dashboardCharts) c.destroy();
  dashboardCharts = [];
  recentGamesLastUpdated = null;
  recentGamesSignature = '';
  // Tear down WebGL effects
  if (glowHandle) { glowHandle.destroy(); glowHandle = null; }
  if (hypeCardHandle) { hypeCardHandle.destroy(); hypeCardHandle = null; }
  if (teamHypeCardHandle) { teamHypeCardHandle.destroy(); teamHypeCardHandle = null; }
}

export function destroy(): void {
  destroyDashboardCharts();
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  destroyDashboardCharts();
  ensureStreakChipStyles();
  ensureDashboardLiveStyles();
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Philly Lacrosse — Boys HS';
  h1.style.margin = '0.4em 0';
  root.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent = 'Season scoreboard, team records, and recent games.';
  root.appendChild(sub);

  const disclaimer = document.createElement('div');
  disclaimer.style.cssText =
    'margin-top:1rem; padding:1rem 1.25rem; border-left:4px solid var(--accent); background:var(--surface, var(--bg)); border-radius:8px; font-size:0.875rem; line-height:1.5;';

  const disclaimerIcon = document.createElement('span');
  disclaimerIcon.style.cssText = 'font-size:1.25rem; margin-right:0.5rem; vertical-align:middle;';
  disclaimerIcon.textContent = '\uD83E\uDD4D'; // lacrosse emoji

  const disclaimerText = document.createElement('span');
  disclaimerText.textContent =
    'Data is compiled from multiple sources (PhillyLacrosse.com, PIAA, MaxPreps) and may be incomplete or most likely contains errors. Until the region has a single source of truth (like Newsday.com for Long Island), this is the best we can do. Users can manually update values and the AI agent & admin will review and approve. Let\'s make this a community effort.';

  const author = document.createElement('p');
  author.style.cssText = 'margin-top:0.5rem; font-size:0.8rem; opacity:0.7; font-style:italic;';
  author.textContent = 'Built by Dave Voyles, a coach at Harriton HS';

  disclaimer.append(disclaimerIcon, disclaimerText, author);
  root.appendChild(disclaimer);

  // Hype cards row — Team of the Week + Player of the Week, side by side
  const hypeRow = document.createElement('div');
  hypeRow.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin:1.5rem 0; align-items:stretch;';
  const teamHypeHost = document.createElement('div');
  teamHypeHost.id = 'team-hype-host';
  const hypeHost = document.createElement('div');
  hypeHost.id = 'hype-card-host';
  hypeRow.append(teamHypeHost, hypeHost);
  root.appendChild(hypeRow);

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
  const gamesHeader = document.createElement('div');
  gamesHeader.className = 'recent-games-header';
  const gamesTitle = document.createElement('h2');
  gamesTitle.textContent = 'Recent Games (Last 7 Days)';
  const liveIndicator = document.createElement('span');
  liveIndicator.id = 'live-indicator';
  liveIndicator.className = 'live-dot';
  liveIndicator.style.display = 'none';
  liveIndicator.title = 'Auto-refreshing every 2 minutes';
  liveIndicator.textContent = '● LIVE';
  const lastUpdated = document.createElement('span');
  lastUpdated.id = 'last-updated';
  lastUpdated.className = 'last-updated';
  gamesHeader.append(gamesTitle, liveIndicator, lastUpdated);
  gamesSection.appendChild(gamesHeader);

  const gamesBody = document.createElement('div');
  gamesBody.id = 'recent-games-list';
  gamesBody.textContent = 'Loading…';
  gamesSection.appendChild(gamesBody);
  root.appendChild(gamesSection);

  const marginSection = document.createElement('section');
  marginSection.className = 'dashboard-section margin-hist-section';
  const marginHeader = document.createElement('h3');
  marginHeader.textContent = 'Game Competitiveness';
  marginSection.appendChild(marginHeader);
  const marginSub = document.createElement('p');
  marginSub.className = 'section-subtitle muted';
  marginSub.style.fontSize = '0.875rem';
  marginSub.textContent = 'Score margin distribution - all games this season';
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

  void loadTeamsAndGames(teamsBody, gamesBody, marginChartDiv, lastUpdated, (teamById) => {
    if (!shouldAutoRefreshRecentGames()) {
      liveIndicator.style.display = 'none';
      lastUpdated.textContent = '';
    } else {
      liveIndicator.style.display = 'inline';
      startRefresh(gamesBody, teamById, lastUpdated);
    }
    // Stagger card fade-in animations
    if (shouldAnimate()) {
      const cards = teamsBody.querySelectorAll('.team-grid li');
      cards.forEach((li, i) => {
        (li as HTMLElement).classList.add('card-animate');
        (li as HTMLElement).style.animationDelay = `${i * 30}ms`;
      });
    }
    // Mount WebGL glow strips behind team cards
    if (shouldMountWebGL()) {
      const grid = teamsBody.querySelector('.team-grid');
      if (grid) {
        const colorMap = new Map<number, string>();
        const items = grid.querySelectorAll('li');
        items.forEach((li, i) => {
          const borderColor = (li.querySelector('a') as HTMLElement | null)?.style.borderLeftColor;
          if (borderColor) colorMap.set(i, borderColor);
        });
        if (colorMap.size > 0) {
          glowHandle = mountTeamCardGlow(grid as HTMLElement, colorMap);
        }
      }
    }
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

  // Hype card — show the week's top goal scorer
  void loadHypeCard(hypeHost);
  // Team of the Week — top team by wins
  void loadTeamHypeCard(teamHypeHost);

  // Scroll-reveal for leader panels
  if (shouldAnimate()) {
    leadersSection.classList.add('scroll-reveal');
    marginSection.classList.add('scroll-reveal');
    calSection.classList.add('scroll-reveal');
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.1 });
    observer.observe(leadersSection);
    observer.observe(marginSection);
    observer.observe(calSection);
  }

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

async function loadHypeCard(host: HTMLElement): Promise<void> {
  try {
    const resp = await getPlayerLeaders({ metric: 'goals', limit: 1, minGames: 3 });
    const top = resp.rows[0];
    if (!top) return;
    const data: HypePlayerData = {
      playerName: top.playerName,
      teamName: top.teamName,
      teamLogoUrl: top.teamLogoUrl ?? undefined,
      statLabel: 'Goals this season',
      statValue: top.value,
      secondaryStat: top.assists > 0 ? { label: 'Assists', value: top.assists } : undefined,
      playerHref: `#/players/${top.playerId}`,
    };
    if (shouldMountWebGL()) {
      hypeCardHandle = mountHypeCard(host, data);
    } else {
      const card = document.createElement('a');
      card.href = data.playerHref;
      card.style.cssText = 'display:block; padding:1rem 1.25rem; border-radius:12px; background:#0e1119; border:2px solid #ffd166; text-decoration:none; color:inherit;';
      card.innerHTML = `<span style="color:#ffd166;font-weight:700;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">&#128293; Player of the Week</span>
        <div style="font-size:1.1rem;font-weight:700;color:#e5e7eb;margin-top:0.25rem;">${data.playerName}</div>
        <div style="font-size:0.8rem;color:#9ca3af;">${data.teamName}</div>
        <div style="font-size:1.5rem;font-weight:700;color:#ffd166;margin-top:0.4rem;">${Math.round(data.statValue)} <span style="font-size:0.8rem;font-weight:400;color:#9ca3af;">${data.statLabel}</span></div>`;
      host.appendChild(card);
    }
  } catch {
    // Silent — hype card is optional enhancement
  }
}

// Helper: extract wins/losses from either top-level (live API) or derivedRecord (static export)
function teamWins(t: TeamSeasonRecord): number {
  if (typeof t.wins === 'number' && t.wins > 0) return t.wins;
  const dr = (t as unknown as { derivedRecord?: { wins?: number } }).derivedRecord;
  return dr?.wins ?? 0;
}
function teamLosses(t: TeamSeasonRecord): number {
  if (typeof t.losses === 'number' && t.losses > 0) return t.losses;
  const dr = (t as unknown as { derivedRecord?: { losses?: number } }).derivedRecord;
  return dr?.losses ?? 0;
}

async function loadTeamHypeCard(host: HTMLElement): Promise<void> {
  try {
    const teams = await getTeams();
    if (!teams.length) return;
    // Find the team with the best win record (most wins, fewest losses as tiebreak)
    const ranked = teams
      .filter((t) => teamWins(t) + teamLosses(t) >= 3)
      .sort((a, b) => {
        const aWins = teamWins(a);
        const bWins = teamWins(b);
        if (bWins !== aWins) return bWins - aWins;
        return teamLosses(a) - teamLosses(b);
      });
    const top = ranked[0];
    if (!top) return;
    const wins = teamWins(top);
    const losses = teamLosses(top);
    const data: HypePlayerData = {
      playerName: top.name,
      teamName: `${wins}-${losses} Record`,
      teamLogoUrl: top.logoUrl ?? undefined,
      statLabel: 'Wins',
      statValue: wins,
      secondaryStat: losses > 0 ? { label: 'Losses', value: losses } : undefined,
      playerHref: `#/teams/${top.id}`,
    };
    if (shouldMountWebGL()) {
      teamHypeCardHandle = mountHypeCard(host, data, { kicker: '\uD83C\uDFC6 Team of the Week', accentColor: '#4ea1ff' });
    } else {
      const card = document.createElement('a');
      card.href = data.playerHref;
      card.style.cssText = 'display:block; padding:1rem 1.25rem; border-radius:12px; background:#0e1119; border:2px solid #4ea1ff; text-decoration:none; color:inherit;';
      card.innerHTML = `<span style="color:#4ea1ff;font-weight:700;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">&#127942; Team of the Week</span>
        <div style="font-size:1.1rem;font-weight:700;color:#e5e7eb;margin-top:0.25rem;">${top.name}</div>
        <div style="font-size:0.8rem;color:#9ca3af;">${wins}-${losses} Record</div>`;
      host.appendChild(card);
    }
  } catch {
    // Silent — team hype card is optional
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
  lastUpdated: HTMLElement,
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

  const [recentGamesResult, allGamesResult] = await Promise.allSettled([
    getGames(recentGamesQueryWindow()),
    getGames(),
  ]);

  if (recentGamesResult.status === 'fulfilled') {
    const games = recentGamesWithinDays(recentGamesResult.value, RECENT_GAME_DAYS);
    await renderGamesList(gamesTarget, games, teamById);
    recentGamesSignature = buildGameSignature(games);
    recentGamesLastUpdated = new Date();
    updateLastUpdated(lastUpdated);
  } else {
    gamesTarget.replaceChildren(errorBlock(recentGamesResult.reason));
  }

  onTeamsReady(teamById);

  if (allGamesResult.status === 'fulfilled') {
    const marginData = allGamesResult.value
      .filter((game) => !game.postponed)
      .map((game) => ({ margin: Math.abs(game.homeScore - game.awayScore) }))
      .filter((game) => game.margin > 0);
    const handle = renderMarginHistogram(marginTarget, marginData);
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
    a.appendChild(buildGapBadge(t));
    // W-L record chip
    if ((t.wins ?? 0) + (t.losses ?? 0) > 0) {
      const rec = document.createElement('span');
      rec.className = 'team-row__record';
      rec.textContent = `${t.wins ?? 0}–${t.losses ?? 0}`;
      rec.title = `${t.wins ?? 0} wins, ${t.losses ?? 0} losses`;
      a.appendChild(rec);
    }
    const streakChip = buildStreakChip(t.streak);
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

function buildGameSignature(games: Game[]): string {
  return [...games]
    .sort((a, b) => a.id - b.id)
    .map((g) => `${g.id}:${g.awayScore}:${g.homeScore}:${g.postponed ? 1 : 0}`)
    .join('|');
}

export function recentGamesWithinDays(
  games: Game[],
  days = RECENT_GAME_DAYS,
  now = Date.now(),
): Game[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return games.filter((game) => Date.parse(`${game.date}T00:00:00Z`) >= cutoff);
}

function recentGamesQueryWindow(days = RECENT_GAME_DAYS, now = Date.now()): { from: string; to: string } {
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
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
  timestampEl: HTMLElement,
): Promise<void> {
  try {
    const games = recentGamesWithinDays(await getGames(recentGamesQueryWindow()), RECENT_GAME_DAYS);
    const nextSignature = buildGameSignature(games);
    if (nextSignature !== recentGamesSignature) {
      await renderGamesList(container, games, teamById);
      recentGamesSignature = nextSignature;
    }
    recentGamesLastUpdated = new Date();
    updateLastUpdated(timestampEl);
  } catch {
    // Silent by design so a polling miss never breaks the dashboard.
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
    if (col.label === 'Matchup') th.style.textAlign = 'center';
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
    tdMatch.style.textAlign = 'center';
    const matchupWrap = document.createElement('span');
    matchupWrap.className = 'matchup';
    matchupWrap.style.cssText = 'display:inline-grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:.4rem; width:100%;';
    const awayBadge = renderTeamBadge({
      name: away?.name ?? `Team #${g.awayTeamId}`,
      logoUrl: away?.logoUrl ?? null,
      size: 'md',
    });
    awayBadge.style.justifySelf = 'start';
    matchupWrap.appendChild(awayBadge);
    const at = document.createElement('span');
    at.className = 'muted';
    at.textContent = '@';
    matchupWrap.appendChild(at);
    const homeBadge = renderTeamBadge({
      name: home?.name ?? `Team #${g.homeTeamId}`,
      logoUrl: home?.logoUrl ?? null,
      size: 'md',
    });
    homeBadge.style.justifySelf = 'start';
    matchupWrap.appendChild(homeBadge);
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
