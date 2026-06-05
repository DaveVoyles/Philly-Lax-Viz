// Wave H8 Lane 1 (Han) — side-by-side player comparison view.
// Route: #/compare/players?ids=12,34[,56[,78]]
//
// Layout:
//   - Picker bar at top: remove-pill per current id + player search input
//   - Row of N "player cards", each with header + season totals callouts +
//     per-game points trend canvas (reuses charts/perGameTrend).
//
// Graceful failure modes:
//   - Whole API call rejects → show error message, leave picker visible so
//     the user can edit ids without reloading.
//   - Single id missing from response → render its card with a "not found"
//     placeholder (the server omits unknown ids per the documented choice).

import {
  ApiError,
  getComparePlayers,
  type PlayerDetail,
  type PlayerPerGameStat,
  searchAll,
  type SearchHit,
} from '../api.js';
import { renderPerGameTrend, type PerGameTrendDatum } from '../charts/index.js';

const MIN_IDS = 2;
const MAX_IDS = 4;
const SEARCH_DEBOUNCE_MS = 200;

/** Pure helper — extracted for unit testing without a DOM. */
export function parseIdsFromHash(hash: string): number[] {
  // Accept any of: "#/compare/players?ids=1,2", "/compare/players?ids=1,2",
  // "?ids=1,2" or "ids=1,2". We only care about the query string here.
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return [];
  const qs = hash.slice(qIdx + 1);
  const usp = new URLSearchParams(qs);
  const raw = usp.get('ids');
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\d+$/.test(p))
    .map((p) => Number(p));
}

function buildHash(ids: ReadonlyArray<number>): string {
  return `#/compare/players?ids=${ids.join(',')}`;
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '← back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const heading = document.createElement('h1');
  heading.textContent = 'Compare Players';
  root.appendChild(heading);

  const ids = parseIdsFromHash(window.location.hash);

  // Picker is always rendered first (even on error) so the user can edit.
  root.appendChild(buildPicker(ids));

  if (ids.length < MIN_IDS) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = `Add at least ${MIN_IDS} player ids (max ${MAX_IDS}) to compare.`;
    root.appendChild(note);
    return;
  }
  if (ids.length > MAX_IDS) {
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = `Too many ids — max ${MAX_IDS}.`;
    root.appendChild(err);
    return;
  }

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  void load(root, status, ids);
}

async function load(
  root: HTMLElement,
  status: HTMLElement,
  ids: ReadonlyArray<number>,
): Promise<void> {
  let res: { players: PlayerDetail[] };
  try {
    res = await getComparePlayers([...ids]);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    status.className = 'error';
    status.textContent = msg;
    return;
  }
  status.remove();

  // Index returned players by id so we can render in request order and
  // surface a "not found" placeholder for any id the server omitted.
  const byId = new Map<number, PlayerDetail>();
  for (const p of res.players) byId.set(p.player.id, p);

  const grid = document.createElement('div');
  grid.className = 'compare-grid';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${ids.length}, minmax(0, 1fr))`;
  grid.style.gap = '1rem';

  for (const id of ids) {
    const detail = byId.get(id);
    grid.appendChild(detail ? buildPlayerCard(detail) : buildMissingCard(id));
  }
  root.appendChild(grid);
}

function buildPicker(ids: ReadonlyArray<number>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'compare-picker';
  wrap.style.display = 'flex';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '0.5rem';
  wrap.style.alignItems = 'center';
  wrap.style.margin = '0.5rem 0 1rem';

  for (const id of ids) {
    const pill = document.createElement('span');
    pill.className = 'compare-pill';
    pill.style.padding = '0.25rem 0.5rem';
    pill.style.border = '1px solid #ccc';
    pill.style.borderRadius = '999px';
    pill.textContent = `#${id} `;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `Remove player ${id}`);
    x.style.marginLeft = '0.25rem';
    x.style.cursor = 'pointer';
    x.addEventListener('click', () => {
      const next = ids.filter((n) => n !== id);
      window.location.hash = next.length >= MIN_IDS
        ? buildHash(next)
        : '#/compare/players';
    });
    pill.appendChild(x);
    wrap.appendChild(pill);
  }
 
  const searchWrap = document.createElement('div');
  searchWrap.style.position = 'relative';
  searchWrap.style.display = 'inline-block';
 
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search player name…';
  input.setAttribute('aria-label', 'Search player name');
  input.autocomplete = 'off';
  input.disabled = ids.length >= MAX_IDS;
  input.style.width = '16rem';
  input.style.maxWidth = '100%';
  input.style.padding = '0.35rem 0.6rem';
  input.style.borderRadius = '4px';
  input.style.border = '1px solid #888';
 
  const list = document.createElement('ul');
  list.style.position = 'absolute';
  list.style.top = '100%';
  list.style.left = '0';
  list.style.right = '0';
  list.style.margin = '0.25rem 0 0 0';
  list.style.padding = '0';
  list.style.listStyle = 'none';
  list.style.background = '#fff';
  list.style.color = '#111';
  list.style.border = '1px solid #ccc';
  list.style.borderRadius = '4px';
  list.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  list.style.maxHeight = '320px';
  list.style.overflowY = 'auto';
  list.style.zIndex = '100';
  list.style.display = 'none';
  list.setAttribute('role', 'listbox');
 
  let currentHits: SearchHit[] = [];
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let activeRequest = 0;

  function hide(): void {
    activeRequest += 1;
    list.style.display = 'none';
    list.innerHTML = '';
    currentHits = [];
  }
 
  function selectHit(hit: SearchHit): void {
    if (ids.length >= MAX_IDS || ids.includes(hit.id)) return;
    input.value = '';
    hide();
    window.location.hash = buildHash([...ids, hit.id]);
  }
 
  function renderHits(hits: SearchHit[]): void {
    currentHits = hits;
    list.innerHTML = '';
    if (hits.length === 0) {
      list.style.display = 'none';
      return;
    }
 
    for (const hit of hits) {
      const li = document.createElement('li');
      li.style.padding = '0.45rem 0.75rem';
      li.style.cursor = 'pointer';
      li.style.borderBottom = '1px solid #eee';
      li.setAttribute('role', 'option');
      li.textContent = hit.teamName ? `${hit.name} — ${hit.teamName}` : hit.name;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectHit(hit);
      });
      list.appendChild(li);
    }
 
    list.style.display = 'block';
  }
 
  async function runQuery(q: string): Promise<void> {
    const requestId = activeRequest + 1;
    activeRequest = requestId;
    try {
      const hits = (await searchAll(q)).filter(
        (hit) => hit.kind === 'player' && !ids.includes(hit.id),
      );
      if (requestId !== activeRequest) return;
      renderHits(hits);
    } catch {
      if (requestId !== activeRequest) return;
      hide();
    }
  }
 
  input.addEventListener('input', () => {
    if (debounceHandle) clearTimeout(debounceHandle);
    const q = input.value.trim();
    if (input.disabled || q.length < 2) {
      hide();
      return;
    }
    debounceHandle = setTimeout(() => {
      void runQuery(q);
    }, SEARCH_DEBOUNCE_MS);
  });
 
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hide();
      input.blur();
      return;
    }
    if (e.key === 'Enter' && currentHits.length > 0) {
      e.preventDefault();
      const first = currentHits[0];
      if (first) selectHit(first);
    }
  });
 
  document.addEventListener('mousedown', (e) => {
    if (!searchWrap.contains(e.target as Node)) hide();
  });
 
  searchWrap.append(input, list);
  wrap.appendChild(searchWrap);
  return wrap;
}

function buildPlayerCard(detail: PlayerDetail): HTMLElement {
  const card = document.createElement('section');
  card.className = 'compare-card';
  card.style.border = '1px solid #ddd';
  card.style.borderRadius = '6px';
  card.style.padding = '0.75rem';

  const name = document.createElement('h2');
  name.style.margin = '0 0 0.25rem';
  const nameLink = document.createElement('a');
  nameLink.href = `#/players/${detail.player.id}`;
  nameLink.textContent = detail.player.name;
  name.appendChild(nameLink);
  card.appendChild(name);

  if (detail.team) {
    const teamP = document.createElement('p');
    teamP.className = 'muted';
    teamP.style.margin = '0 0 0.5rem';
    const teamLink = document.createElement('a');
    teamLink.href = `#/teams/${detail.team.id}`;
    teamLink.textContent = detail.team.name;
    teamP.appendChild(teamLink);
    card.appendChild(teamP);
  }

  card.appendChild(buildSeasonCallouts(detail));

  const trendHeader = document.createElement('h3');
  trendHeader.style.fontSize = '0.95rem';
  trendHeader.style.margin = '0.75rem 0 0.25rem';
  trendHeader.textContent = 'Per-Game Points (G + A)';
  card.appendChild(trendHeader);

  const trendSlot = document.createElement('div');
  trendSlot.className = 'chart-slot';
  trendSlot.dataset['chart'] = 'perGameTrend';
  card.appendChild(trendSlot);

  const trendData: PerGameTrendDatum[] = detail.perGame
    .map((p: PlayerPerGameStat) => ({ date: p.date, points: p.goals + p.assists }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (trendData.length > 0) {
    try {
      renderPerGameTrend(trendSlot, trendData);
    } catch (err) {
      // Match Yoda's H7 graceful-degrade pattern (logged warn + empty placeholder).
      console.warn('[compare] per-game trend render failed', err);
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Trend unavailable.';
      card.appendChild(empty);
    }
  } else {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No per-game stats logged yet.';
    card.appendChild(empty);
  }

  return card;
}

function buildMissingCard(id: number): HTMLElement {
  const card = document.createElement('section');
  card.className = 'compare-card compare-card--missing';
  card.style.border = '1px dashed #ccc';
  card.style.borderRadius = '6px';
  card.style.padding = '0.75rem';

  const name = document.createElement('h2');
  name.style.margin = '0 0 0.25rem';
  name.textContent = `Player #${id}`;
  card.appendChild(name);

  const note = document.createElement('p');
  note.className = 'error';
  note.textContent = 'Not found.';
  card.appendChild(note);
  return card;
}

function buildSeasonCallouts(detail: PlayerDetail): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'callout-row';
  const items: ReadonlyArray<{ label: string; value: number }> = [
    { label: 'Games', value: detail.seasonStats.games },
    { label: 'Goals', value: detail.seasonStats.goals },
    { label: 'Assists', value: detail.seasonStats.assists },
    { label: 'Points', value: detail.seasonStats.points },
    { label: 'Ground Balls', value: detail.seasonStats.groundBalls },
    { label: 'Saves', value: detail.seasonStats.saves },
  ];
  for (const it of items) {
    const c = document.createElement('div');
    c.className = 'record-callout';
    const lab = document.createElement('span');
    lab.className = 'callout-label';
    lab.textContent = it.label;
    const val = document.createElement('span');
    val.className = 'callout-value';
    val.textContent = String(it.value);
    c.append(lab, val);
    wrap.appendChild(c);
  }
  return wrap;
}
