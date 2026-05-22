import { createAnimatedCounter } from '../components/animatedCounter.js';

import { loadPblaSeason } from './pblaLoader.js';
import type { PblaGame, PblaPlayer, PblaSeason, PblaTeam } from './pblaData.js';
import { burstAt, isCurrentRenderToken, registerCleanup, schedule } from './pblaWebGL.js';

const cleanupFns = { push: registerCleanup } as unknown as Array<() => void>;

const TEAM_ABBREV: Record<string, string> = {
  'More Dudes LC': 'MDLC',
  'Outlaws': 'Out',
  'Edge': 'Edge',
  'Thunder': 'Thd',
  'Beer Wolves': 'BW',
  'Pups LC': 'PLC',
  'Revolution': 'Rev',
};

export function teamAbbrev(team: string): string {
  return TEAM_ABBREV[team] ?? team.slice(0, 4).toUpperCase();
}

export type SortDirection = 'asc' | 'desc';
export type TeamSortKey = 'rank' | 'name' | 'gp' | 'wins' | 'losses' | 'pts' | 'pf' | 'pa' | 'diff';
export type PlayerSortKey = 'name' | 'team' | 'gp' | 'goals' | 'assists' | 'points' | 'pim';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export interface SortHeader<K extends string> {
  key: K;
  label: string;
}

const LIVE_TIMEZONE = 'America/New_York';
const LIVE_MONTH_START = 5;
const LIVE_MONTH_END = 8;
const LIVE_START_MINUTES = 19 * 60;
const LIVE_END_MINUTES = 21 * 60 + 30;
const LIVE_GAME_DAYS = new Set(['Mon', 'Wed']);
const LIVE_STATUS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: LIVE_TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const LIVE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: LIVE_TIMEZONE,
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});
const GAME_CARD_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

export function compareTeams(a: PblaTeam, b: PblaTeam): number {
  return b.pts - a.pts || b.diff - a.diff || b.pf - a.pf || a.pa - b.pa || a.name.localeCompare(b.name);
}

function toPixiColor(color: string): number {
  return parseInt(color.replace('#', ''), 16);
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function sumGoalsFor(season: PblaSeason): number {
  return season.teams.reduce((sum, team) => sum + team.pf, 0);
}

function topPoints(season: PblaSeason): number {
  return season.players.reduce((best, player) => Math.max(best, player.points), 0);
}

function topPointsPlayer(season: PblaSeason): string {
  const top = season.players.reduce<PblaPlayer | null>((best, p) => (!best || p.points > best.points) ? p : best, null);
  return top ? top.name : '';
}

function defaultSortDirection(key: string): SortDirection {
  return key === 'name' || key === 'team' ? 'asc' : 'desc';
}

function toggleSort<K extends string>(state: SortState<K>, key: K): SortState<K> {
  if (state.key === key) {
    return { key, direction: state.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: defaultSortDirection(key) };
}

function sortTeams(teams: PblaTeam[], state: SortState<TeamSortKey>): PblaTeam[] {
  return [...teams].sort((a, b) => {
    if (state.key === 'rank') {
      const ranked = compareTeams(a, b);
      return state.direction === 'asc' ? -ranked : ranked;
    }

    let result = 0;
    if (state.key === 'name') {
      result = a.name.localeCompare(b.name);
    } else {
      result = Number(a[state.key]) - Number(b[state.key]);
    }
    if (result === 0) result = compareTeams(a, b);
    return state.direction === 'asc' ? result : -result;
  });
}

function sortPlayers(players: PblaPlayer[], state: SortState<PlayerSortKey>): PblaPlayer[] {
  return [...players].sort((a, b) => {
    let result = 0;
    if (state.key === 'name' || state.key === 'team') {
      result = a[state.key].localeCompare(b[state.key]);
    } else {
      result = Number(a[state.key]) - Number(b[state.key]);
    }
    if (result === 0) result = b.points - a.points || a.name.localeCompare(b.name);
    return state.direction === 'asc' ? result : -result;
  });
}

type EasternDateParts = {
  weekday: string;
  month: number;
  day: number;
  year: number;
  hour: number;
  minute: number;
};

function getEasternDateParts(date: Date = new Date()): EasternDateParts {
  const parts = Object.fromEntries(
    LIVE_PARTS_FORMATTER
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    weekday: parts.weekday ?? 'Mon',
    month: Number(parts.month ?? '1'),
    day: Number(parts.day ?? '1'),
    year: Number(parts.year ?? '1970'),
    hour: Number(parts.hour ?? '0'),
    minute: Number(parts.minute ?? '0'),
  };
}

function isSeasonMonth(month: number): boolean {
  return month >= LIVE_MONTH_START && month <= LIVE_MONTH_END;
}

function isGameNight(weekday: string): boolean {
  return LIVE_GAME_DAYS.has(weekday);
}

function makeCalendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatCompactDate(formatter: Intl.DateTimeFormat, date: Date): string {
  return formatter.format(date).replace(',', '');
}

function isLiveNow(date: Date = new Date()): boolean {
  const { weekday, month, hour, minute } = getEasternDateParts(date);
  const minutes = hour * 60 + minute;
  return isSeasonMonth(month) && isGameNight(weekday) && minutes >= LIVE_START_MINUTES && minutes < LIVE_END_MINUTES;
}

async function getNextGameDate(date: Date = new Date()): Promise<string> {
  const current = getEasternDateParts(date);
  const currentMinutes = current.hour * 60 + current.minute;

  // If currently live, show today's date
  if (isSeasonMonth(current.month) && isGameNight(current.weekday) && currentMinutes < LIVE_END_MINUTES) {
    return formatCompactDate(LIVE_STATUS_FORMATTER, date);
  }

  // Use actual schedule dates from the current season
  const season = await loadPblaSeason();
  const nowMs = date.getTime();
  const upcoming = season.games
    .filter((g) => parseGameTimestamp(g) > nowMs)
    .sort((a, b) => parseGameTimestamp(a) - parseGameTimestamp(b));

  if (upcoming.length > 0) {
    const nextTs = parseGameTimestamp(upcoming[0]!);
    return formatCompactDate(LIVE_STATUS_FORMATTER, new Date(nextTs));
  }

  // Fallback: season is over
  return 'TBD';
}

async function updateLiveBadge(badge: HTMLAnchorElement, text: HTMLElement): Promise<void> {
  const live = isLiveNow();
  const nextGame = await getNextGameDate();
  badge.classList.toggle('pbla-live-badge--active', live);
  text.textContent = live ? 'LIVE NOW' : `Next game: ${nextGame}`;
  badge.setAttribute('aria-label', live ? 'PBLA is live now on YouTube' : `Next PBLA game ${nextGame} on YouTube`);
}

function parseGameTimestamp(game: PblaGame): number {
  const [rawYear, rawMonth, rawDay] = game.date.split('-').map(Number);
  const year = rawYear ?? 1970;
  const month = rawMonth ?? 1;
  const day = rawDay ?? 1;
  const match = game.time.match(/^(\d{1,2}):(\d{2})([ap])$/i);
  let hour = Number(match?.[1] ?? '0');
  const minute = Number(match?.[2] ?? '0');
  const meridiem = (match?.[3] ?? 'a').toLowerCase();
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  return Date.UTC(year, month - 1, day, hour, minute);
}

function formatGameCardDate(game: PblaGame): string {
  return formatCompactDate(GAME_CARD_DATE_FORMATTER, new Date(parseGameTimestamp(game)));
}

function attachBurstTarget(
  target: HTMLElement,
  host: HTMLElement,
  color: string,
  token: number,
  cleanups: Array<() => void> = cleanupFns,
): void {
  const fire = (): void => {
    if (!isCurrentRenderToken(token)) return;
    const hostRect = host.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    burstAt(
      rect.left + rect.width / 2 - hostRect.left,
      rect.top + rect.height / 2 - hostRect.top,
      toPixiColor(color),
      token,
    );
  };

  target.addEventListener('pointerenter', fire);
  target.addEventListener('focus', fire);
  cleanups.push(() => {
    target.removeEventListener('pointerenter', fire);
    target.removeEventListener('focus', fire);
  });
}

function observeOnEnter(
  element: HTMLElement,
  animate: boolean,
  callback: () => void,
  cleanups: Array<() => void> = cleanupFns,
): void {
  if (!animate || typeof IntersectionObserver === 'undefined') {
    callback();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        callback();
      }
    },
    { threshold: 0.35 },
  );

  observer.observe(element);
  cleanups.push(() => observer.disconnect());
}

function showElement(element: HTMLElement, animate: boolean, delay: number): void {
  if (!animate) {
    element.classList.add('is-visible');
    return;
  }
  element.style.setProperty('--delay', `${delay}ms`);
  schedule(() => {
    if (!element.isConnected) return;
    element.classList.add('is-visible');
  }, 16);
}

function setCounterValue(host: HTMLElement, value: number, format?: (value: number) => string): void {
  host.textContent = (format ?? ((next) => String(Math.round(next))))(value);
}

function restartCounter(host: HTMLElement, value: number, format?: (value: number) => string): void {
  if (!host.isConnected) return;
  const counter = createAnimatedCounter({ value, duration: 1100, format });
  host.replaceChildren(counter.el);
  counter.start();
}

function pulseClass(target: HTMLElement, className: string, duration = 480): void {
  target.classList.remove(className);
  void target.offsetWidth;
  target.classList.add(className);
  schedule(() => {
    if (!target.isConnected) return;
    target.classList.remove(className);
  }, duration);
}

function mountCounter(
  host: HTMLElement,
  value: number,
  animate: boolean,
  delay: number,
  format?: (value: number) => string,
): void {
  if (!animate) {
    setCounterValue(host, value, format);
    return;
  }

  schedule(() => restartCounter(host, value, format), delay);
}

function renderSortHeader<K extends string>(
  header: SortHeader<K>,
  state: SortState<K>,
  onSort: (key: K) => void,
): HTMLTableCellElement {
  const th = document.createElement('th');
  const button = document.createElement('button');
  const isActive = state.key === header.key;
  button.type = 'button';
  button.className = `pbla-sort-header${isActive ? ' pbla-sort-header--active' : ''}`;
  button.innerHTML = `<span>${header.label}</span><span class="pbla-sort-arrow${isActive && state.direction === 'desc' ? ' pbla-sort-arrow--desc' : ''}" aria-hidden="true">▲</span>`;
  button.addEventListener('click', () => onSort(header.key));
  th.setAttribute('aria-sort', isActive ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  th.appendChild(button);
  return th;
}

function createSummaryCard(label: string, value: number, note: string, animate: boolean, delay: number): HTMLElement {
  const card = document.createElement('article');
  card.className = 'pbla-summary-card';

  const labelEl = document.createElement('span');
  labelEl.className = 'pbla-summary-card__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'pbla-summary-card__value';
  mountCounter(valueEl, value, animate, delay);

  const noteEl = document.createElement('span');
  noteEl.className = 'pbla-summary-card__note';
  noteEl.textContent = note;

  card.append(labelEl, valueEl, noteEl);
  return card;
}

export {
  attachBurstTarget,
  createSummaryCard,
  formatGameCardDate,
  formatSigned,
  mountCounter,
  observeOnEnter,
  parseGameTimestamp,
  pulseClass,
  renderSortHeader,
  restartCounter,
  setCounterValue,
  showElement,
  sortPlayers,
  sortTeams,
  sumGoalsFor,
  toggleSort,
  topPoints,
  topPointsPlayer,
  updateLiveBadge,
};
