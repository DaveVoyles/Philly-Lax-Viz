// Player detail view: header, season totals, per-game trend chart, per-game table.

import { ApiError, getPlayerDetail, type PlayerDetail, type PlayerPerGameStat } from '../api.js';
import { formatDate } from '../util/format.js';
import { renderConfidenceBadge } from '../util/confidence.js';
import { isOutlier } from '../util/zscore.js';
import { renderPerGameTrend } from '../charts/index.js';
import type { PerGameTrendDatum } from '../charts/index.js';
import { ensureShareCss, getShareButtonHtml, initShareButtons } from '../util/share.js';

export function render(root: HTMLElement, params: Record<string, string>): void {
  ensureShareCss();
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

  const headingWrap = document.createElement('div');
  headingWrap.style.cssText = 'display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;';
  const heading = document.createElement('h1');
  heading.textContent = detail.player.name;
  heading.insertAdjacentHTML('beforeend', getShareButtonHtml(`${detail.player.name} - Philly Lax Stats`));
  headingWrap.appendChild(heading);
  root.appendChild(headingWrap);
  initShareButtons();

  // Wave H8 L1 (Han) — quick-start the compare view from this player.
  const compareP = document.createElement('p');
  const compareBtn = document.createElement('a');
  compareBtn.href = `#/compare/players?ids=${detail.player.id}`;
  compareBtn.textContent = 'Compare with…';
  compareBtn.className = 'compare-link';
  compareP.appendChild(compareBtn);
  root.appendChild(compareP);

  if (detail.team) {
    const teamP = document.createElement('p');
    teamP.className = 'muted';
    const teamLink = document.createElement('a');
    teamLink.href = `#/teams/${detail.team.id}`;
    teamLink.textContent = detail.team.name;
    teamP.appendChild(teamLink);
    root.appendChild(teamP);
  }

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
  const goalsSeries = stats.map((s) => s.goals);

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
      // Wave H6 Lane 2 (Yoda) — replaces Han's H4 hardcoded `goals > 12`
      // heuristic with a data-driven 3σ check against the player's own
      // season. Skips for sample sizes <3 (see isOutlier). Floor in the
      // helper guards against tiny-stdev false positives.
      if (i === 0 && isOutlier(ps.goals, goalsSeries)) {
        const warn = document.createElement('span');
        warn.className = 'anomaly-inline';
        warn.title = 'Suspicious: per-game goals look implausibly high';
        warn.setAttribute('aria-label', 'data anomaly');
        warn.textContent = '⚠️ ';
        td.appendChild(warn);
        td.appendChild(document.createTextNode(value));
      } else {
        td.textContent = value;
      }
      if (i === 0) {
        const badge = renderConfidenceBadge(ps.confidence);
        if (badge) td.appendChild(badge);
      }
      if (i > 0) td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
