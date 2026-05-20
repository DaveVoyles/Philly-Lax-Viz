import { getGames, getPostImages, type PostImage } from '../../api.js';
import { renderEmptyState } from '../../components/emptyState.js';
import { renderGameThumb } from '../../components/postImage.js';
import { renderTeamBadge } from '../../components/teamBadge.js';
import { formatDate } from '../../util/format.js';
import { createPoller, isActiveSeason } from '../../util/livePoller.js';
import { wrapResponsive } from '../../util/responsiveTable.js';
import type { Game, Team } from '@pll/shared';

export const RECENT_GAME_DAYS = 7;
export const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const DASHBOARD_LIVE_STYLE_ID = 'dashboard-live-poller-styles';

export interface RecentGamesState {
  poller: { stop: () => void } | null;
  lastUpdated: Date | null;
  signature: string;
}

export function ensureDashboardLiveStyles(): void {
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

export function shouldAutoRefreshRecentGames(season: string): boolean {
  return isActiveSeason() && season === String(new Date().getFullYear());
}

export function stopRefresh(state: RecentGamesState): void {
  state.poller?.stop();
  state.poller = null;
}

export function updateLastUpdated(
  timestampEl: HTMLElement,
  season: string,
  state: RecentGamesState,
): void {
  if (!shouldAutoRefreshRecentGames(season) || state.lastUpdated === null) {
    timestampEl.textContent = '';
    return;
  }
  timestampEl.textContent = `Updated ${state.lastUpdated.toLocaleTimeString()}`;
}

export function startRefresh(params: {
  gamesTarget: HTMLElement;
  teamById: Map<number, Team>;
  timestampEl: HTMLElement;
  season: string;
  state: RecentGamesState;
}): void {
  const { gamesTarget, teamById, timestampEl, season, state } = params;
  stopRefresh(state);
  if (!shouldAutoRefreshRecentGames(season)) {
    updateLastUpdated(timestampEl, season, state);
    return;
  }
  state.poller = createPoller(
    () => refreshGames({ container: gamesTarget, teamById, timestampEl, season, state }),
    REFRESH_INTERVAL_MS,
  );
}

export function buildGameSignature(games: Game[]): string {
  return [...games]
    .sort((a, b) => a.id - b.id)
    .map((game) => `${game.id}:${game.awayScore}:${game.homeScore}:${game.postponed ? 1 : 0}`)
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

export function recentGamesQueryWindow(
  days = RECENT_GAME_DAYS,
  now = Date.now(),
): { from: string; to: string } {
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

async function loadRecentGameImages(games: Game[]): Promise<Record<string, PostImage>> {
  try {
    const slugs = games.map((game) => game.sourcePostId).filter((slug): slug is string => !!slug);
    return slugs.length > 0 ? await getPostImages(slugs) : {};
  } catch {
    return {};
  }
}

export async function renderGamesList(
  container: HTMLElement,
  games: Game[],
  teamById: Map<number, Team>,
): Promise<void> {
  const images = await loadRecentGameImages(games);
  container.replaceChildren(buildRecentGamesTable(games, teamById, images));
}

export async function refreshGames(params: {
  container: HTMLElement;
  teamById: Map<number, Team>;
  timestampEl: HTMLElement;
  season: string;
  state: RecentGamesState;
}): Promise<void> {
  const { container, teamById, timestampEl, season, state } = params;
  try {
    const games = recentGamesWithinDays(
      await getGames({ ...recentGamesQueryWindow(), season }),
      RECENT_GAME_DAYS,
    );
    const nextSignature = buildGameSignature(games);
    if (nextSignature !== state.signature) {
      await renderGamesList(container, games, teamById);
      state.signature = nextSignature;
    }
    state.lastUpdated = new Date();
    updateLastUpdated(timestampEl, season, state);
  } catch {
    // Silent by design so a polling miss never breaks the dashboard.
  }
}

export function buildRecentGamesTable(
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
  for (const game of sorted) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'link');
    const go = (): void => {
      window.location.hash = `#/game/${game.id}`;
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        go();
      }
    });

    const tdImg = document.createElement('td');
    tdImg.style.width = '64px';
    tdImg.classList.add('col-secondary');
    const img = game.sourcePostId ? images[game.sourcePostId] : undefined;
    if (img) {
      tdImg.appendChild(renderGameThumb(img.imageUrl, img.altText));
    }
    tr.appendChild(tdImg);

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(game.date);
    tr.appendChild(tdDate);

    const away = teamById.get(game.awayTeamId);
    const home = teamById.get(game.homeTeamId);
    const tdMatch = document.createElement('td');
    tdMatch.style.textAlign = 'center';
    const matchupWrap = document.createElement('span');
    matchupWrap.className = 'matchup';
    matchupWrap.style.cssText = 'display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:.4rem;';
    const awayBadge = renderTeamBadge({
      name: away?.name ?? `Team #${game.awayTeamId}`,
      logoUrl: away?.logoUrl ?? null,
      size: 'md',
    });
    awayBadge.style.justifySelf = 'start';
    matchupWrap.appendChild(awayBadge);
    const at = document.createElement('span');
    at.className = 'muted';
    at.textContent = '@';
    at.style.justifySelf = 'center';
    matchupWrap.appendChild(at);
    const homeBadge = renderTeamBadge({
      name: home?.name ?? `Team #${game.homeTeamId}`,
      logoUrl: home?.logoUrl ?? null,
      size: 'md',
    });
    homeBadge.style.justifySelf = 'start';
    matchupWrap.appendChild(homeBadge);
    tdMatch.appendChild(matchupWrap);
    if (game.postponed || game.otPeriods > 0) {
      const note = document.createElement('span');
      note.className = 'muted';
      note.style.marginLeft = '.4rem';
      const bits: string[] = [];
      if (game.postponed) bits.push('(postponed)');
      if (game.otPeriods > 0) bits.push(`(OT${game.otPeriods > 1 ? `x${game.otPeriods}` : ''})`);
      note.textContent = bits.join(' ');
      tdMatch.appendChild(note);
    }
    tr.appendChild(tdMatch);

    const tdScore = document.createElement('td');
    if (game.postponed) {
      tdScore.textContent = '—';
    } else {
      const margin = (game.awayScore ?? 0) - (game.homeScore ?? 0);
      const abs = Math.abs(margin);
      tdScore.textContent = `${game.awayScore}–${game.homeScore}`;
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
