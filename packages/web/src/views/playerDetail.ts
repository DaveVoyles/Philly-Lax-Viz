// Player detail view: header, season totals, per-game trend chart, per-game table.

import { ApiError, getPlayerDetail, type PlayerDetail, type PlayerPerGameStat } from '../api.js';
import { formatDate } from '../util/format.js';
import { renderConfidenceBadge } from '../util/confidence.js';
import { isOutlier } from '../util/zscore.js';
import { renderPerGameTrend } from '../charts/index.js';
import type { PerGameTrendDatum } from '../charts/index.js';
import { ensureShareCss, getShareButtonHtml, initShareButtons } from '../util/share.js';
import { openCorrectionModal, type CorrectionTarget } from '../components/correctionModal.js';

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

  root.appendChild(buildPerGameTable(detail.perGame, detail.player.name));

  const correctionNote = document.createElement('p');
  correctionNote.className = 'correction-note';
  correctionNote.style.cssText = 'font-size:0.75em;color:#888;margin-top:8px;';
  correctionNote.textContent = 'See an error? Click ✏️ to suggest a correction.';
  root.appendChild(correctionNote);
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

type CorrectablePlayerField =
  | 'goals'
  | 'assists'
  | 'ground_balls'
  | 'caused_turnovers'
  | 'saves'
  | 'fo_won'
  | 'fo_taken';

function buildPerGameTable(stats: PlayerPerGameStat[], playerName: string): HTMLElement {
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

    const dateTd = document.createElement('td');
    const dateLabel = formatDate(ps.date);
    // Wave H6 Lane 2 (Yoda) — replaces Han's H4 hardcoded `goals > 12`
    // heuristic with a data-driven 3σ check against the player's own
    // season. Skips for sample sizes <3 (see isOutlier). Floor in the
    // helper guards against tiny-stdev false positives.
    if (isOutlier(ps.goals, goalsSeries)) {
      const warn = document.createElement('span');
      warn.className = 'anomaly-inline';
      warn.title = 'Suspicious: per-game goals look implausibly high';
      warn.setAttribute('aria-label', 'data anomaly');
      warn.textContent = '⚠️ ';
      dateTd.appendChild(warn);
      dateTd.appendChild(document.createTextNode(dateLabel));
    } else {
      dateTd.textContent = dateLabel;
    }
    const badge = renderConfidenceBadge(ps.confidence);
    if (badge) dateTd.appendChild(badge);
    tr.appendChild(dateTd);

    tr.appendChild(createPlayerStatCell(ps, playerName, 'goals', 'Goals', ps.goals));
    tr.appendChild(createPlayerStatCell(ps, playerName, 'assists', 'Assists', ps.assists));

    const pointsTd = document.createElement('td');
    pointsTd.className = 'num';
    pointsTd.textContent = String(ps.goals + ps.assists);
    tr.appendChild(pointsTd);

    tr.appendChild(createPlayerStatCell(ps, playerName, 'ground_balls', 'Ground Balls', ps.groundBalls));
    tr.appendChild(
      createPlayerStatCell(ps, playerName, 'caused_turnovers', 'Caused Turnovers', ps.causedTurnovers),
    );
    tr.appendChild(createPlayerStatCell(ps, playerName, 'saves', 'Saves', ps.saves));
    tr.appendChild(createPlayerFaceoffCell(ps, playerName));

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function createPlayerStatCell(
  stat: PlayerPerGameStat,
  playerName: string,
  fieldName: CorrectablePlayerField,
  fieldLabel: string,
  currentValue: number,
): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'num';
  td.appendChild(document.createTextNode(String(currentValue)));

  const button = createPlayerCorrectionButton(stat, playerName, fieldName, fieldLabel, currentValue);
  if (button) td.appendChild(button);

  return td;
}

function createPlayerFaceoffCell(stat: PlayerPerGameStat, playerName: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'num';

  if (stat.foTaken <= 0) {
    td.textContent = '–';
    return td;
  }

  td.appendChild(document.createTextNode(String(stat.foWon)));
  const wonButton = createPlayerCorrectionButton(stat, playerName, 'fo_won', 'FO Won', stat.foWon);
  if (wonButton) td.appendChild(wonButton);

  td.appendChild(document.createTextNode('/'));
  td.appendChild(document.createTextNode(String(stat.foTaken)));
  const takenButton = createPlayerCorrectionButton(
    stat,
    playerName,
    'fo_taken',
    'FO Taken',
    stat.foTaken,
  );
  if (takenButton) td.appendChild(takenButton);

  return td;
}

function createPlayerCorrectionButton(
  stat: PlayerPerGameStat,
  playerName: string,
  fieldName: CorrectablePlayerField,
  fieldLabel: string,
  currentValue: number,
): HTMLButtonElement | null {
  if (typeof stat.id !== 'number') return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.title = 'Suggest a correction';
  button.setAttribute('aria-label', 'Suggest a correction');
  button.textContent = '✏️';
  button.style.cssText =
    'font-size: 0.75em; opacity: 0.6; cursor: pointer; background: none; border: none; padding: 0 4px;';
  button.addEventListener('mouseenter', () => {
    button.style.opacity = '1';
  });
  button.addEventListener('mouseleave', () => {
    button.style.opacity = '0.6';
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const target: CorrectionTarget = {
      entityType: 'player_stat',
      entityId: stat.id,
      fieldName,
      fieldLabel,
      currentValue,
      contextLabel: `${playerName} (${formatDate(stat.date)})`,
    };
    openCorrectionModal(target);
  });
  return button;
}
