import { getGameCalendar, getGames, getTeams } from '../api.js';
import type { Game, Team } from '@pll/shared';
import { renderCalendarHeatmap } from '../charts/calendarHeatmap.js';
import { renderMarginHistogram } from '../charts/marginHistogram.js';
import type { ChartHandle } from '../charts/types.js';
import { mountTeamCardGlow, type GlowHandle } from '../components/teamCardGlow.js';
import type { HypeCardHandle } from '../components/hypeCard.js';
import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { ensureStreakChipStyles } from '../util/streakChip.js';
import { createSeasonSelector, getSelectedSeason } from '../components/seasonSelector.js';
import { setPageMeta } from '../util/pageMeta.js';
import { errorBlock } from './dashboard/dashboardErrors.js';
import { loadDashboardFreshness } from './dashboard/dashboardFreshness.js';
import { loadHypeCard, loadTeamHypeCard } from './dashboard/dashboardHype.js';
import { intFmt, loadLeaderPanel, makeLeaderPanel, pctFmt } from './dashboard/dashboardLeaders.js';
import {
  buildGameSignature,
  ensureDashboardLiveStyles,
  RECENT_GAME_DAYS,
  recentGamesQueryWindow,
  recentGamesWithinDays as filterRecentGamesWithinDays,
  renderGamesList,
  shouldAutoRefreshRecentGames,
  startRefresh,
  stopRefresh,
  type RecentGamesState,
  updateLastUpdated,
} from './dashboard/dashboardRecentGames.js';
import { buildPiaaLegend, renderTeamsGrid } from './dashboard/dashboardTeams.js';

export { teamGameCount } from './dashboard/dashboardTeams.js';
export { recentGamesWithinDays } from './dashboard/dashboardRecentGames.js';

let dashboardCharts: ChartHandle[] = [];
const recentGamesState: RecentGamesState = {
  poller: null,
  lastUpdated: null,
  signature: '',
};
let glowHandle: GlowHandle | null = null;
let hypeCardHandle: HypeCardHandle | null = null;
let teamHypeCardHandle: HypeCardHandle | null = null;

function destroyDashboardCharts(): void {
  stopRefresh(recentGamesState);
  for (const chart of dashboardCharts) chart.destroy();
  dashboardCharts = [];
  recentGamesState.lastUpdated = null;
  recentGamesState.signature = '';
  if (glowHandle) {
    glowHandle.destroy();
    glowHandle = null;
  }
  if (hypeCardHandle) {
    hypeCardHandle.destroy();
    hypeCardHandle = null;
  }
  if (teamHypeCardHandle) {
    teamHypeCardHandle.destroy();
    teamHypeCardHandle = null;
  }
}

export function destroy(): void {
  destroyDashboardCharts();
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  setPageMeta({
    title: 'Dashboard',
    description:
      'Philadelphia high school boys lacrosse dashboard - team standings, recent games, and stat leaders.',
  });
  destroyDashboardCharts();
  ensureStreakChipStyles();
  ensureDashboardLiveStyles();
  root.replaceChildren();

  let selectedSeason = getSelectedSeason();
  const selectorHost = document.createElement('div');
  root.appendChild(selectorHost);

  const h1 = document.createElement('h1');
  h1.textContent = 'Philly Lacrosse — Boys HS';
  h1.style.margin = '0.32em 0 0.4em';
  root.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent = 'Season scoreboard, team records, and recent games.';
  root.appendChild(sub);

  createSeasonSelector(selectorHost, (season) => {
    selectedSeason = season;
    stopRefresh(recentGamesState);
    void loadSeasonData(season);
  });

  const disclaimer = document.createElement('div');
  disclaimer.style.cssText =
    'margin-top:1rem; padding:1rem 1.25rem; border-left:4px solid var(--accent); background:var(--surface, var(--bg)); border-radius:8px; font-size:0.875rem; line-height:1.5;';
  const disclaimerIcon = document.createElement('span');
  disclaimerIcon.style.cssText = 'font-size:1.25rem; margin-right:0.5rem; vertical-align:middle;';
  disclaimerIcon.textContent = '🥍';
  const disclaimerText = document.createElement('span');
  disclaimerText.textContent =
    'Data is compiled from multiple sources (PhillyLacrosse.com, PIAA, MaxPreps) and may be incomplete or most likely contains errors. Until the region has a single source of truth (like Newsday.com for Long Island), this is the best we can do. Users can manually update values and the AI agent & admin will review and approve. Let\'s make this a community effort.';
  const author = document.createElement('p');
  author.style.cssText = 'margin-top:0.5rem; font-size:0.8rem; opacity:0.7; font-style:italic;';
  author.textContent = 'Built by Dave Voyles, a coach at Harriton HS';
  disclaimer.append(disclaimerIcon, disclaimerText, author);
  root.appendChild(disclaimer);

  const hypeRow = document.createElement('div');
  hypeRow.className = 'hype-row';
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
  gamesTitle.textContent = `Recent Games (Last ${RECENT_GAME_DAYS} Days)`;
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
    'display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1rem; margin-top:.5rem;';
  leadersSection.appendChild(panelsGrid);
  const savesPanel = makeLeaderPanel('Save Leaders', 'Top goalies by total saves (min 3 games).');
  const foPctPanel = makeLeaderPanel('Faceoff Win % Leaders', 'Best faceoff conversion rate (min 20 attempts).');
  const gbPanel = makeLeaderPanel('Ground Ball Leaders', 'Most ground balls collected (min 3 games).');
  panelsGrid.append(savesPanel.wrap, foPctPanel.wrap, gbPanel.wrap);
  root.appendChild(leadersSection);

  let loadToken = 0;

  async function loadTeamsAndGames(
    teamsTarget: HTMLElement,
    gamesTarget: HTMLElement,
    marginTarget: HTMLElement,
    timestampEl: HTMLElement,
    season: string,
    onTeamsReady: (teamById: Map<number, Team>) => void,
  ): Promise<void> {
    try {
      const teams = await getTeams({ season });
      renderTeamsGrid(teamsTarget, teams);
      const teamById = new Map<number, Team>(teams.map((team) => [team.id, team]));
      const [recentGamesResult, allGamesResult] = await Promise.allSettled([
        getGames({ ...recentGamesQueryWindow(RECENT_GAME_DAYS), season }),
        getGames({ season }),
      ]);

      if (recentGamesResult.status === 'fulfilled') {
        const games = filterRecentGamesWithinDays(recentGamesResult.value, RECENT_GAME_DAYS);
        await renderGamesList(gamesTarget, games, teamById);
        recentGamesState.signature = buildGameSignature(games);
        recentGamesState.lastUpdated = new Date();
        updateLastUpdated(timestampEl, season, recentGamesState);
      } else {
        gamesTarget.replaceChildren(errorBlock(recentGamesResult.reason));
      }

      onTeamsReady(teamById);

      if (allGamesResult.status === 'fulfilled') {
        const marginData = allGamesResult.value
          .filter((game: Game) => !game.postponed)
          .map((game: Game) => ({ margin: Math.abs(game.homeScore - game.awayScore) }))
          .filter((game) => game.margin > 0);
        dashboardCharts.push(renderMarginHistogram(marginTarget, marginData));
      } else {
        const msg = document.createElement('p');
        msg.className = 'muted';
        msg.textContent = 'Score margin data unavailable.';
        marginTarget.replaceChildren(msg);
      }
    } catch (err) {
      teamsTarget.replaceChildren(errorBlock(err));
      gamesTarget.replaceChildren(errorBlock(err));
      marginTarget.replaceChildren(errorBlock(err));
    }
  }

  async function loadSeasonData(season: string): Promise<void> {
    const token = ++loadToken;
    stopRefresh(recentGamesState);
    recentGamesState.lastUpdated = null;
    recentGamesState.signature = '';
    for (const chart of dashboardCharts) chart.destroy();
    dashboardCharts = [];
    if (glowHandle) {
      glowHandle.destroy();
      glowHandle = null;
    }
    if (hypeCardHandle) {
      hypeCardHandle.destroy();
      hypeCardHandle = null;
    }
    if (teamHypeCardHandle) {
      teamHypeCardHandle.destroy();
      teamHypeCardHandle = null;
    }
    hypeHost.replaceChildren();
    teamHypeHost.replaceChildren();
    marginChartDiv.replaceChildren();
    calDiv.replaceChildren();
    savesPanel.body.textContent = 'Loading…';
    foPctPanel.body.textContent = 'Loading…';
    gbPanel.body.textContent = 'Loading…';

    await loadTeamsAndGames(teamsBody, gamesBody, marginChartDiv, lastUpdated, season, (teamById) => {
      if (token !== loadToken) return;
      if (!shouldAutoRefreshRecentGames(season)) {
        liveIndicator.style.display = 'none';
        lastUpdated.textContent = '';
      } else {
        liveIndicator.style.display = 'inline';
        startRefresh({ gamesTarget: gamesBody, teamById, timestampEl: lastUpdated, season, state: recentGamesState });
      }
      if (shouldAnimate()) {
        teamsBody.querySelectorAll('.team-grid li').forEach((li, index) => {
          (li as HTMLElement).classList.add('card-animate');
          (li as HTMLElement).style.animationDelay = `${index * 30}ms`;
        });
      }
      if (shouldMountWebGL()) {
        const grid = teamsBody.querySelector('.team-grid');
        if (grid) {
          const colorMap = new Map<number, string>();
          grid.querySelectorAll('li').forEach((li, index) => {
            const borderColor = (li.querySelector('a') as HTMLElement | null)?.style.borderLeftColor;
            if (borderColor) colorMap.set(index, borderColor);
          });
          if (colorMap.size > 0) {
            glowHandle = mountTeamCardGlow(grid as HTMLElement, colorMap);
          }
        }
      }
    });

    if (token !== loadToken) return;

    void getGameCalendar({ season })
      .then((calDays) => {
        if (token !== loadToken) return;
        if (calDays.length > 0) {
          dashboardCharts.push(renderCalendarHeatmap(calDiv, calDays));
        } else {
          calDiv.textContent = 'No games recorded yet.';
        }
      })
      .catch(() => {
        calDiv.textContent = '';
      });
    void loadLeaderPanel(savesPanel.body, 'saves', { minGames: 3 }, intFmt, 'Saves', season, dashboardCharts);
    void loadLeaderPanel(foPctPanel.body, 'fo_pct', { minAttempts: 20 }, pctFmt, 'FO %', season, dashboardCharts);
    void loadLeaderPanel(gbPanel.body, 'ground_balls', { minGames: 3 }, intFmt, 'Ground balls', season, dashboardCharts);
    void loadHypeCard(hypeHost, season).then((handle) => {
      if (token !== loadToken) {
        handle?.destroy();
        return;
      }
      hypeCardHandle = handle;
    });
    void loadTeamHypeCard(teamHypeHost, season).then((handle) => {
      if (token !== loadToken) {
        handle?.destroy();
        return;
      }
      teamHypeCardHandle = handle;
    });
  }

  void loadSeasonData(selectedSeason);

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

  const freshnessLine = document.createElement('p');
  freshnessLine.className = 'muted';
  freshnessLine.dataset['testid'] = 'dashboard-freshness';
  freshnessLine.textContent = 'Data freshness: checking…';
  root.appendChild(freshnessLine);
  void loadDashboardFreshness(freshnessLine);
}
