import { ApiError, getGames, getRivalries, type RivalryNode } from '../api.js';
import { renderTeamBadge } from '../components/teamBadge.js';
import { navigate } from '../router.js';

const STYLE_ID = 'rivalries-view-styles';
const CLOSE_GAME_MARGIN = 2;

interface RivalryCardData {
  a: RivalryNode;
  b: RivalryNode;
  aWins: number;
  bWins: number;
  ties: number;
  meetings: number;
  closeGames: number;
  closeRatio: number;
  lastMeeting: {
    date: string;
    aScore: number;
    bScore: number;
  } | null;
}

let renderToken = 0;

function ensureStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .rivalries-view {
      display: grid;
      gap: 1rem;
    }
    .rivalries-view__subtitle {
      margin-top: -0.5rem;
      color: var(--muted);
    }
    .rivalries-view__list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .rivalry-card {
      width: 100%;
      border: 1px solid var(--border);
      padding: 1rem;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg) 92%, white 8%);
      color: var(--fg);
      text-align: left;
      cursor: pointer;
      opacity: 0;
      transform: translateY(14px);
      transition:
        opacity 320ms ease,
        transform 320ms ease,
        border-color 180ms ease,
        box-shadow 180ms ease;
    }
    .rivalry-card.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .rivalry-card:hover,
    .rivalry-card:focus-visible {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
      outline: none;
    }
    .rivalry-card__matchup {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.9rem;
    }
    .rivalry-card__team {
      display: flex;
      opacity: 0;
      transition: opacity 360ms ease, transform 360ms ease;
      min-width: 0;
    }
    .rivalry-card__team--a {
      justify-content: flex-start;
      transform: translateX(-18px);
    }
    .rivalry-card__team--b {
      justify-content: flex-end;
      transform: translateX(18px);
    }
    .rivalry-card.is-visible .rivalry-card__team {
      opacity: 1;
      transform: translateX(0);
    }
    .rivalry-card__team .team-badge,
    .rivalry-card__team .team-badge-link {
      max-width: 100%;
    }
    .rivalry-card__team .team-badge {
      min-width: 0;
    }
    .rivalry-card__team .team-badge__name {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rivalry-card__vs {
      color: var(--muted);
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .rivalry-card__record {
      text-align: center;
      font-size: 1.6rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
    }
    .rivalry-card__meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.85rem;
    }
    .rivalry-card__stat {
      display: grid;
      gap: 0.2rem;
      padding: 0.6rem 0.7rem;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg) 88%, white 12%);
    }
    .rivalry-card__stat-label {
      font-size: 0.74rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .rivalry-card__stat-value {
      font-size: 1rem;
      font-weight: 700;
    }
    .rivalry-card__intensity {
      display: grid;
      gap: 0.4rem;
    }
    .rivalry-card__intensity-row {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .rivalry-card__track {
      height: 8px;
      border-radius: 999px;
      background: var(--table-stripe);
      overflow: hidden;
    }
    .rivalry-card__fill {
      height: 100%;
      width: 0;
      background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, white));
      border-radius: inherit;
      transition: width 500ms ease;
    }
    .rivalry-card.is-visible .rivalry-card__fill {
      width: var(--fill-width, 0%);
    }
    .rivalries-view__state {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
    }
    .rivalries-view__state--error {
      border-color: color-mix(in srgb, #ef4444 55%, var(--border));
      color: #fca5a5;
    }
    @media (max-width: 720px) {
      .rivalry-card__matchup {
        grid-template-columns: 1fr;
        justify-items: center;
      }
      .rivalry-card__team,
      .rivalry-card__team--a,
      .rivalry-card__team--b {
        justify-content: center;
      }
      .rivalry-card__meta {
        grid-template-columns: 1fr;
      }
    }
  `;
  doc.head.appendChild(style);
}

function completedGame(game: { postponed: boolean; homeScore: number; awayScore: number }): boolean {
  return !game.postponed && Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function toLogoPath(logo: string | null): string | null {
  if (!logo) return null;
  return logo.startsWith('/logos/') ? logo : `/logos/${logo.replace(/^\/+/, '')}`;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatIntensity(closeGames: number, meetings: number): string {
  if (meetings <= 0) return '0%';
  return `${Math.round((closeGames / meetings) * 100)}%`;
}

function buildCards(nodes: RivalryNode[], games: Array<{ id: number; date: string; homeTeamId: number; awayTeamId: number; homeScore: number; awayScore: number; postponed: boolean }>): RivalryCardData[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const rivalryMap = new Map<string, RivalryCardData>();

  for (const game of games) {
    if (!completedGame(game) || game.homeTeamId === game.awayTeamId) continue;
    const aId = Math.min(game.homeTeamId, game.awayTeamId);
    const bId = Math.max(game.homeTeamId, game.awayTeamId);
    const aNode = nodeMap.get(aId);
    const bNode = nodeMap.get(bId);
    if (!aNode || !bNode) continue;

    const key = pairKey(aId, bId);
    let rivalry = rivalryMap.get(key);
    if (!rivalry) {
      rivalry = {
        a: aNode,
        b: bNode,
        aWins: 0,
        bWins: 0,
        ties: 0,
        meetings: 0,
        closeGames: 0,
        closeRatio: 0,
        lastMeeting: null,
      };
      rivalryMap.set(key, rivalry);
    }

    rivalry.meetings += 1;
    const aScore = game.homeTeamId === aId ? game.homeScore : game.awayScore;
    const bScore = game.homeTeamId === bId ? game.homeScore : game.awayScore;
    if (aScore > bScore) rivalry.aWins += 1;
    else if (bScore > aScore) rivalry.bWins += 1;
    else rivalry.ties += 1;
    if (Math.abs(aScore - bScore) <= CLOSE_GAME_MARGIN) rivalry.closeGames += 1;

    if (!rivalry.lastMeeting || game.date > rivalry.lastMeeting.date) {
      rivalry.lastMeeting = {
        date: game.date,
        aScore,
        bScore,
      };
    }
  }

  return [...rivalryMap.values()]
    .map((rivalry) => ({
      ...rivalry,
      closeRatio: rivalry.meetings > 0 ? rivalry.closeGames / rivalry.meetings : 0,
    }))
    .sort((left, right) => {
      if (right.meetings !== left.meetings) return right.meetings - left.meetings;
      if (right.closeRatio !== left.closeRatio) return right.closeRatio - left.closeRatio;
      const pairName = `${left.a.name} ${left.b.name}`.localeCompare(`${right.a.name} ${right.b.name}`);
      return pairName;
    });
}

function buildState(message: string, isError = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `rivalries-view__state${isError ? ' rivalries-view__state--error' : ''}`;
  el.textContent = message;
  return el;
}

function buildCard(card: RivalryCardData, index: number): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rivalry-card';
  button.style.transitionDelay = `${index * 55}ms`;
  button.setAttribute('aria-label', `${card.a.name} versus ${card.b.name}`);
  button.addEventListener('click', () => {
    navigate(`/h2h?mode=teams&a=${card.a.id}&b=${card.b.id}`);
  });

  const matchup = document.createElement('div');
  matchup.className = 'rivalry-card__matchup';

  const teamA = document.createElement('div');
  teamA.className = 'rivalry-card__team rivalry-card__team--a';
  teamA.style.transitionDelay = `${index * 55 + 80}ms`;
  teamA.appendChild(
    renderTeamBadge({
      name: card.a.name,
      logoUrl: toLogoPath(card.a.logo),
      size: 'md',
    }),
  );

  const versus = document.createElement('div');
  versus.className = 'rivalry-card__vs';
  versus.textContent = 'vs';

  const teamB = document.createElement('div');
  teamB.className = 'rivalry-card__team rivalry-card__team--b';
  teamB.style.transitionDelay = `${index * 55 + 140}ms`;
  teamB.appendChild(
    renderTeamBadge({
      name: card.b.name,
      logoUrl: toLogoPath(card.b.logo),
      size: 'md',
    }),
  );

  matchup.append(teamA, versus, teamB);
  button.appendChild(matchup);

  const record = document.createElement('div');
  record.className = 'rivalry-card__record';
  record.textContent = card.ties > 0 ? `${card.aWins}-${card.bWins}-${card.ties}` : `${card.aWins}-${card.bWins}`;
  button.appendChild(record);

  const meta = document.createElement('div');
  meta.className = 'rivalry-card__meta';

  meta.appendChild(makeStat('Meetings', String(card.meetings)));
  meta.appendChild(
    makeStat(
      'Last meeting',
      card.lastMeeting ? `${formatDate(card.lastMeeting.date)} - ${card.lastMeeting.aScore}-${card.lastMeeting.bScore}` : 'N/A',
    ),
  );
  meta.appendChild(makeStat('Series', `${card.a.name.split(' ')[0]} ${card.aWins} - ${card.bWins} ${card.b.name.split(' ')[0]}`));
  button.appendChild(meta);

  const intensity = document.createElement('div');
  intensity.className = 'rivalry-card__intensity';

  const intensityRow = document.createElement('div');
  intensityRow.className = 'rivalry-card__intensity-row';
  const intensityLabel = document.createElement('span');
  intensityLabel.textContent = 'Intensity';
  const intensityValue = document.createElement('span');
  intensityValue.textContent = `${formatIntensity(card.closeGames, card.meetings)} close games (${card.closeGames}/${card.meetings})`;
  intensityRow.append(intensityLabel, intensityValue);

  const track = document.createElement('div');
  track.className = 'rivalry-card__track';
  const fill = document.createElement('div');
  fill.className = 'rivalry-card__fill';
  fill.style.setProperty('--fill-width', `${Math.round(card.closeRatio * 100)}%`);
  track.appendChild(fill);

  intensity.append(intensityRow, track);
  button.appendChild(intensity);

  return button;
}

function makeStat(label: string, value: string): HTMLElement {
  const stat = document.createElement('div');
  stat.className = 'rivalry-card__stat';

  const statLabel = document.createElement('div');
  statLabel.className = 'rivalry-card__stat-label';
  statLabel.textContent = label;

  const statValue = document.createElement('div');
  statValue.className = 'rivalry-card__stat-value';
  statValue.textContent = value;

  stat.append(statLabel, statValue);
  return stat;
}

function revealCards(cards: HTMLButtonElement[]): void {
  requestAnimationFrame(() => {
    for (const card of cards) card.classList.add('is-visible');
  });
}

export function destroy(): void {
  renderToken += 1;
}

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  destroy();
  const myToken = renderToken;
  ensureStyles();
  root.replaceChildren();

  const shell = document.createElement('section');
  shell.className = 'rivalries-view';

  const title = document.createElement('h1');
  title.textContent = 'Top Rivalries';
  shell.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'rivalries-view__subtitle';
  subtitle.textContent = 'Most-played matchups in Philadelphia lacrosse';
  shell.appendChild(subtitle);

  const list = document.createElement('div');
  list.className = 'rivalries-view__list';
  shell.appendChild(list);
  root.appendChild(shell);

  try {
    const [{ nodes }, games] = await Promise.all([getRivalries(), getGames()]);
    if (myToken !== renderToken) return;

    const cards = buildCards(nodes, games);
    if (cards.length === 0) {
      list.appendChild(buildState('No rivalry data available yet.'));
      return;
    }

    const cardEls = cards.map((card, index) => buildCard(card, index));
    list.replaceChildren(...cardEls);
    revealCards(cardEls);
  } catch (error) {
    if (myToken !== renderToken) return;
    const message = error instanceof ApiError ? `${error.status} - ${error.message}` : error instanceof Error ? error.message : 'Unknown error';
    root.replaceChildren(buildState(`Unable to load rivalries: ${message}`, true));
  }
}
