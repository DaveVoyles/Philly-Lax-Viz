// Head-to-head comparator view (#/h2h).
// Toggle between Teams and Players modes; pick two and compare side-by-side.

import {
  ApiError,
  currentSeason,
  getH2HPlayers,
  getH2HTeams,
  getPlayerList,
  getTeams,
  type H2HPlayersResponse,
  type H2HTeamsResponse,
  type TeamSeasonRecord,
} from '../api.js';
import { IS_STATIC } from '../staticLoader.js';

type Mode = 'teams' | 'players';

interface PlayerListItem {
  id: number;
  name: string;
  teamName: string;
}

let teamsCache: TeamSeasonRecord[] | null = null;
let playersCache: { season: string | null; rows: PlayerListItem[] } | null = null;

async function loadTeams(): Promise<TeamSeasonRecord[]> {
  if (teamsCache) return teamsCache;
  teamsCache = await getTeams();
  return teamsCache;
}

async function loadPlayers(season?: string | null): Promise<PlayerListItem[]> {
  const seasonKey = season ?? null;
  if (playersCache && playersCache.season === seasonKey) return playersCache.rows;
  const rows = await getPlayerList({ season: seasonKey });
  const players = rows.map((r) => ({ id: r.id, name: r.name, teamName: r.teamName }));
  playersCache = { season: seasonKey, rows: players };
  return players;
}

function readQuery(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '');
  const q = hash.indexOf('?');
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '');
}

function writeQuery(mode: Mode, a: number | null, b: number | null): void {
  const usp = new URLSearchParams();
  usp.set('mode', mode);
  if (a !== null) usp.set('a', String(a));
  if (b !== null) usp.set('b', String(b));
  const next = `#/h2h?${usp.toString()}`;
  if (window.location.hash !== next) {
    history.replaceState(null, '', next);
  }
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();

  const q = readQuery();
  const modeRaw = q.get('mode');
  const hasLegacyTeamParams = q.has('team1') || q.has('team2');
  let mode: Mode = modeRaw === 'players' ? 'players' : 'teams';
  let a: number | null = parseIdParam(q.get('a') ?? q.get('team1'));
  let b: number | null = parseIdParam(q.get('b') ?? q.get('team2'));
  if (hasLegacyTeamParams && modeRaw !== 'players') mode = 'teams';

  const h1 = document.createElement('h1');
  h1.textContent = 'Head-to-Head';
  root.appendChild(h1);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent = 'Pick two teams or two players and compare their season head-to-head.';
  root.appendChild(sub);

  // Mode toggle.
  const toggle = document.createElement('div');
  toggle.style.cssText =
    'display:flex; gap:.5rem; border-bottom:1px solid var(--border); margin: 1rem 0;';
  const teamsBtn = makeTabButton('Teams');
  const playersBtn = makeTabButton('Players');
  toggle.appendChild(teamsBtn);
  toggle.appendChild(playersBtn);
  root.appendChild(toggle);

  // Selectors row.
  const selectors = document.createElement('div');
  selectors.style.cssText =
    'display:grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0;';
  const sideA = document.createElement('div');
  const sideB = document.createElement('div');
  selectors.appendChild(sideA);
  selectors.appendChild(sideB);
  root.appendChild(selectors);

  // Output region.
  const output = document.createElement('section');
  output.style.cssText = 'margin-top: 1.5rem;';
  root.appendChild(output);

  function setMode(next: Mode): void {
    if (next === mode) return;
    mode = next;
    a = null;
    b = null;
    refresh();
  }

  teamsBtn.addEventListener('click', () => setMode('teams'));
  playersBtn.addEventListener('click', () => setMode('players'));

  function refresh(): void {
    for (const [m, btn] of [['teams', teamsBtn], ['players', playersBtn]] as const) {
      const active = m === mode;
      btn.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent';
      btn.style.color = active ? 'var(--accent)' : 'var(--fg)';
      btn.style.fontWeight = active ? '600' : '400';
    }

    sideA.replaceChildren();
    sideB.replaceChildren();
    output.replaceChildren();
    output.textContent = 'Loading…';

    if (mode === 'teams') {
      void mountTeamSelectors(sideA, sideB, a, b, (na, nb) => {
        a = na;
        b = nb;
        writeQuery(mode, a, b);
        if (IS_STATIC) {
          output.replaceChildren(staticUnavailableNode());
          return;
        }
        if (a !== null && b !== null) loadTeamsCompare(output, a, b);
      });
    } else {
      void mountPlayerSelectors(sideA, sideB, a, b, (na, nb) => {
        a = na;
        b = nb;
        writeQuery(mode, a, b);
        if (IS_STATIC) {
          output.replaceChildren(staticUnavailableNode());
          return;
        }
        if (a !== null && b !== null) loadPlayersCompare(output, a, b);
      });
    }

    writeQuery(mode, a, b);
    if (IS_STATIC) {
      output.replaceChildren(staticUnavailableNode());
      return;
    }
    if (a !== null && b !== null) {
      if (mode === 'teams') loadTeamsCompare(output, a, b);
      else loadPlayersCompare(output, a, b);
    } else {
      output.textContent = 'Pick two on each side to compare.';
    }
  }

  refresh();
}

function parseIdParam(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function makeTabButton(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText =
    'background:transparent; border:none; padding:.5rem 1rem; cursor:pointer; font-size:1rem; border-bottom:2px solid transparent;';
  return b;
}

function staticUnavailableNode(): HTMLElement {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent =
    'Head-to-head comparisons require the live data server and are not available on this static site.';
  return p;
}

async function mountTeamSelectors(
  aEl: HTMLElement,
  bEl: HTMLElement,
  a: number | null,
  b: number | null,
  onChange: (a: number | null, b: number | null) => void,
): Promise<void> {
  let teams: TeamSeasonRecord[];
  try {
    teams = await loadTeams();
  } catch (err) {
    aEl.appendChild(errorNode(err));
    return;
  }
  const sorted = [...teams].sort((x, y) => x.name.localeCompare(y.name));
  const selA = makeSelect('Team A', sorted.map((t) => ({ value: String(t.id), label: t.name })), a);
  const selB = makeSelect('Team B', sorted.map((t) => ({ value: String(t.id), label: t.name })), b);
  selA.select.addEventListener('change', () => {
    onChange(parseIdParam(selA.select.value || null), parseIdParam(selB.select.value || null));
  });
  selB.select.addEventListener('change', () => {
    onChange(parseIdParam(selA.select.value || null), parseIdParam(selB.select.value || null));
  });
  aEl.appendChild(selA.wrap);
  bEl.appendChild(selB.wrap);
}

async function mountPlayerSelectors(
  aEl: HTMLElement,
  bEl: HTMLElement,
  a: number | null,
  b: number | null,
  onChange: (a: number | null, b: number | null) => void,
): Promise<void> {
  let players: PlayerListItem[];
  try {
    const season = currentSeason();
    players = await loadPlayers(season === null ? null : String(season));
  } catch (err) {
    aEl.appendChild(errorNode(err));
    return;
  }
  const opts = players.map((p) => ({ value: String(p.id), label: `${p.name} — ${p.teamName}` }));
  const selA = makeSelect('Player A', opts, a);
  const selB = makeSelect('Player B', opts, b);
  selA.select.addEventListener('change', () => {
    onChange(parseIdParam(selA.select.value || null), parseIdParam(selB.select.value || null));
  });
  selB.select.addEventListener('change', () => {
    onChange(parseIdParam(selA.select.value || null), parseIdParam(selB.select.value || null));
  });
  aEl.appendChild(selA.wrap);
  bEl.appendChild(selB.wrap);
}

function makeSelect(
  label: string,
  options: Array<{ value: string; label: string }>,
  current: number | null,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex; flex-direction:column; gap:.25rem;';
  const lbl = document.createElement('span');
  lbl.className = 'muted';
  lbl.textContent = label;
  wrap.appendChild(lbl);
  const select = document.createElement('select');
  select.style.cssText = 'padding:.4rem; border:1px solid var(--border); border-radius:4px;';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— choose —';
  select.appendChild(blank);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (current !== null && o.value === String(current)) opt.selected = true;
    select.appendChild(opt);
  }
  wrap.appendChild(select);
  return { wrap, select };
}

async function loadTeamsCompare(
  el: HTMLElement,
  a: number,
  b: number,
): Promise<void> {
  el.replaceChildren();
  el.textContent = 'Loading…';
  let resp: H2HTeamsResponse;
  try {
    resp = await getH2HTeams(a, b);
  } catch (err) {
    el.replaceChildren(errorNode(err));
    return;
  }
  el.replaceChildren();

  if (!resp.a || !resp.b) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'One or both teams not found.';
    el.appendChild(p);
    return;
  }

  // Side-by-side cards.
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;';
  grid.appendChild(teamCard(resp.a));
  grid.appendChild(teamCard(resp.b));
  el.appendChild(grid);

  // Direct meetings.
  const meetingsTitle = document.createElement('h2');
  meetingsTitle.textContent = 'Direct meetings';
  meetingsTitle.style.marginTop = '1.5rem';
  el.appendChild(meetingsTitle);
  if (resp.directMeetings.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = `${resp.a.teamName} and ${resp.b.teamName} have not met this season.`;
    el.appendChild(p);
  } else {
    const list = document.createElement('ul');
    list.style.cssText = 'list-style:none; padding-left:0; display:flex; flex-direction:column; gap:.4rem;';
    for (const m of resp.directMeetings) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#/games/${m.gameId}`;
      const aIsHome = m.homeTeamId === resp.a.teamId;
      const aScore = aIsHome ? m.homeScore : m.awayScore;
      const bScore = aIsHome ? m.awayScore : m.homeScore;
      link.textContent = `${m.date} — ${resp.a.teamName} ${aScore}, ${resp.b.teamName} ${bScore} (${m.aResult} for ${resp.a.teamName})`;
      li.appendChild(link);
      list.appendChild(li);
    }
    el.appendChild(list);
  }

  // Common opponents.
  const oppTitle = document.createElement('h2');
  oppTitle.textContent = 'Common opponents';
  oppTitle.style.marginTop = '1.5rem';
  el.appendChild(oppTitle);
  if (resp.commonOpponents.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No common opponents this season.';
    el.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    for (const o of resp.commonOpponents) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#/teams/${o.opponentId}`;
      link.textContent = o.opponentName;
      li.appendChild(link);
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }
}

function teamCard(t: NonNullable<H2HTeamsResponse['a']>): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'border:1px solid var(--border); border-radius:6px; padding:1rem;';
  const h = document.createElement('h2');
  const link = document.createElement('a');
  link.href = `#/teams/${t.teamId}`;
  link.textContent = t.teamName;
  h.appendChild(link);
  h.style.marginTop = '0';
  card.appendChild(h);

  const tbl = document.createElement('table');
  tbl.className = 'stat';
  tbl.innerHTML = `
    <tbody>
      <tr><td>Record</td><td>${t.wins}-${t.losses}-${t.ties}</td></tr>
      <tr><td>Goals for</td><td>${t.goalsFor}</td></tr>
      <tr><td>Goals against</td><td>${t.goalsAgainst}</td></tr>
      <tr><td>Goal diff</td><td>${t.goalsFor - t.goalsAgainst}</td></tr>
      <tr><td>Games played</td><td>${t.gamesPlayed}</td></tr>
    </tbody>
  `;
  card.appendChild(tbl);
  return card;
}

async function loadPlayersCompare(
  el: HTMLElement,
  a: number,
  b: number,
): Promise<void> {
  el.replaceChildren();
  el.textContent = 'Loading…';
  let resp: H2HPlayersResponse;
  try {
    resp = await getH2HPlayers(a, b);
  } catch (err) {
    el.replaceChildren(errorNode(err));
    return;
  }
  el.replaceChildren();

  if (!resp.a || !resp.b) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'One or both players not found.';
    el.appendChild(p);
    return;
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;';
  grid.appendChild(playerCard(resp.a));
  grid.appendChild(playerCard(resp.b));
  el.appendChild(grid);

  const leadsTitle = document.createElement('h2');
  leadsTitle.textContent = 'Top categories where each leads';
  leadsTitle.style.marginTop = '1.5rem';
  el.appendChild(leadsTitle);

  const leadGrid = document.createElement('div');
  leadGrid.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;';
  leadGrid.appendChild(leadsList(resp.a.playerName, resp.aLeads));
  leadGrid.appendChild(leadsList(resp.b.playerName, resp.bLeads));
  el.appendChild(leadGrid);
}

function playerCard(p: NonNullable<H2HPlayersResponse['a']>): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText =
    'border:1px solid var(--border); border-radius:6px; padding:1rem;';
  const h = document.createElement('h2');
  const link = document.createElement('a');
  link.href = `#/players/${p.playerId}`;
  link.textContent = p.playerName;
  h.appendChild(link);
  h.style.marginTop = '0';
  card.appendChild(h);

  const team = document.createElement('p');
  team.className = 'muted';
  team.textContent = p.teamName;
  card.appendChild(team);

  const tbl = document.createElement('table');
  tbl.className = 'stat';
  tbl.innerHTML = `
    <tbody>
      <tr><td>Games played</td><td>${p.gamesPlayed}</td></tr>
      <tr><td>Goals</td><td>${p.goals}</td></tr>
      <tr><td>Assists</td><td>${p.assists}</td></tr>
      <tr><td>Points</td><td>${p.points}</td></tr>
      <tr><td>Goals/game</td><td>${fmt(p.goalsPerGame)}</td></tr>
      <tr><td>Assists/game</td><td>${fmt(p.assistsPerGame)}</td></tr>
      <tr><td>Points/game</td><td>${fmt(p.pointsPerGame)}</td></tr>
      <tr><td>Ground balls</td><td>${p.groundBalls}</td></tr>
      <tr><td>Caused TOs</td><td>${p.causedTurnovers}</td></tr>
      <tr><td>Saves</td><td>${p.saves}</td></tr>
    </tbody>
  `;
  card.appendChild(tbl);
  return card;
}

function leadsList(
  name: string,
  leads: H2HPlayersResponse['aLeads'],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'border:1px solid var(--border); border-radius:6px; padding:1rem;';
  const h = document.createElement('h3');
  h.style.marginTop = '0';
  h.textContent = `${name} leads in`;
  wrap.appendChild(h);
  if (leads.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No category leads.';
    wrap.appendChild(p);
    return wrap;
  }
  const ul = document.createElement('ul');
  for (const l of leads) {
    const li = document.createElement('li');
    li.textContent = `${l.category}: ${l.aValue} vs ${l.bValue} (+${fmtDiff(l.diff)})`;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function fmt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtDiff(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function errorNode(err: unknown): HTMLElement {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent =
    err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
  return p;
}
