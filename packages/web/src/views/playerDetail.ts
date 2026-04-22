// Player detail view: header, season totals, per-game trend chart, per-game table.

import { ApiError, getPlayerDetail, type PlayerDetail, type PlayerPerGameStat } from '../api.js';
import { formatDate } from '../util/format.js';
import { renderPerGameTrend } from '../charts/index.js';
import type { PerGameTrendDatum } from '../charts/index.js';
import { renderCommitBadge } from '../components/commitBadge.js';

interface CommitsApiRow {
  playerId: number | null;
  college: string;
  division: string | null;
}

async function renderCommitBadgeForPlayer(root: HTMLElement, playerId: string): Promise<void> {
  const numId = Number(playerId);
  if (!Number.isFinite(numId) || numId <= 0) return;
  try {
    const res = await fetch(`/api/commits?season=all&limit=2000`);
    if (!res.ok) return;
    const body = (await res.json()) as { rows: CommitsApiRow[] };
    const match = body.rows.find((r) => r.playerId === numId);
    if (!match) return;
    const wrap = document.createElement('p');
    wrap.style.margin = '.25rem 0 .75rem';
    wrap.appendChild(renderCommitBadge({ college: match.college, division: match.division }));
    root.appendChild(wrap);
  } catch {
    // Silent — badge is enrichment, not critical.
  }
}

export function render(root: HTMLElement, params: Record<string, string>): void {
  root.replaceChildren();

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '← back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const id = params['id'] ?? '';
  if (!id) {
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = 'Missing player id';
    root.appendChild(err);
    return;
  }

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  void load(root, status, id);
}

async function load(root: HTMLElement, status: HTMLElement, id: string): Promise<void> {
  let detail: PlayerDetail;
  try {
    detail = await getPlayerDetail(id);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    status.className = 'error';
    status.textContent = msg;
    return;
  }
  status.remove();

  const heading = document.createElement('h1');
  heading.textContent = detail.player.name;
  root.appendChild(heading);

  if (detail.team) {
    const teamP = document.createElement('p');
    teamP.className = 'muted';
    const teamLink = document.createElement('a');
    teamLink.href = `#/teams/${detail.team.id}`;
    teamLink.textContent = detail.team.name;
    teamP.appendChild(teamLink);
    root.appendChild(teamP);
  }

  // Wave 15 Lane 3 (Han 🧑‍🚀🍔) — show "🎓 Committed to X" badge if a
  // commits row exists for this player. Fire-and-forget; absence/error
  // silently no-ops so the rest of the view always renders.
  void renderCommitBadgeForPlayer(root, id);

  root.appendChild(buildSeasonCallouts(detail));

  // Per-game trend chart slot. Points = goals + assists per game (documented choice).
  const trendHeader = document.createElement('h2');
  trendHeader.textContent = 'Per-Game Points (G + A)';
  root.appendChild(trendHeader);

  const trendSlot = document.createElement('div');
  trendSlot.dataset['chart'] = 'perGameTrend';
  trendSlot.className = 'chart-slot';
  root.appendChild(trendSlot);

  const trendData: PerGameTrendDatum[] = detail.perGame
    .map((p) => ({ date: p.date, points: p.goals + p.assists }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (trendData.length > 0) {
    renderPerGameTrend(trendSlot, trendData);
  } else {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No per-game stats logged yet.';
    root.appendChild(empty);
  }

  const tableHeader = document.createElement('h2');
  tableHeader.textContent = 'Per-Game Stats';
  root.appendChild(tableHeader);

  if (detail.perGame.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No per-game stats logged yet.';
    root.appendChild(empty);
    return;
  }

  root.appendChild(buildPerGameTable(detail.perGame));
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

function buildPerGameTable(stats: PlayerPerGameStat[]): HTMLElement {
  const sorted = [...stats].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const table = document.createElement('table');
  table.className = 'stat per-game-stats';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Date', 'G', 'A', 'Pts', 'GB', 'CT', 'Saves', 'FO']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const ps of sorted) {
    const tr = document.createElement('tr');
    tr.className = 'row-link';
    tr.tabIndex = 0;
    tr.setAttribute('role', 'link');
    const go = (): void => {
      window.location.hash = `#/games/${ps.gameId}`;
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });

    const cells: Array<string> = [
      formatDate(ps.date),
      String(ps.goals),
      String(ps.assists),
      String(ps.goals + ps.assists),
      String(ps.groundBalls),
      String(ps.causedTurnovers),
      String(ps.saves),
      ps.foTaken > 0 ? `${ps.foWon}/${ps.foTaken}` : '–',
    ];
    cells.forEach((value, i) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (i > 0) td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
