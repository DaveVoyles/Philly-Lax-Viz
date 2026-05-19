// Player detail view: header, season totals, per-game trend chart, per-game table.

import {
  ApiError,
  getPlayerDetail,
  getPlayerMilestones,
  type PlayerDetail,
  type PlayerMilestones,
  type PlayerPerGameStat,
} from '../api.js';
import { formatDate } from '../util/format.js';
import { renderConfidenceBadge } from '../util/confidence.js';
import { isOutlier } from '../util/zscore.js';
import { renderPerGameTrend } from '../charts/index.js';
import type { PerGameTrendDatum } from '../charts/index.js';
import { openCorrectionModal, type CorrectionTarget } from '../components/correctionModal.js';
import { setOgMeta } from '../util/ogMeta.js';
import { ensureShareCss, getShareButtonHtml, initShareButtons } from '../util/share.js';

export function render(root: HTMLElement, params: Record<string, string>): void {
  ensureShareCss();
  setOgMeta({
    title: 'Player Stats | PhillyLaxStats',
    description: 'Season totals and per-game stats for Philly-area lacrosse players.',
    url: window.location.href,
  });
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
  let milestones: PlayerMilestones | null = null;
  try {
    [detail, milestones] = await Promise.all([
      getPlayerDetail(id),
      getPlayerMilestones(id).catch(() => null),
    ]);
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    status.className = 'error';
    status.textContent = msg;
    return;
  }
  status.remove();

  setOgMeta({
    title: `${detail.player.name} - ${detail.team?.name ?? 'Unknown Team'} | PhillyLaxStats`,
    description: `Season stats for ${detail.player.name}${detail.team ? ` from ${detail.team.name}` : ''}.`,
    image: detail.team?.logoUrl ?? undefined,
    url: window.location.href,
  });

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

  if (milestones) {
    root.appendChild(buildCareerHighlights(milestones));
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

function buildCareerHighlights(milestones: PlayerMilestones): HTMLElement {
  const section = document.createElement('section');
  section.style.cssText = 'margin:1rem 0 1.5rem; padding:1rem 1.1rem; border:1px solid var(--border); border-radius:12px; background:var(--bg-elev, rgba(255,255,255,0.02));';

  const heading = document.createElement('h2');
  heading.textContent = 'Career Highlights';
  heading.style.cssText = 'margin:0 0 .75rem; font-size:1.05rem;';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:.75rem;';

  const cards: Array<{ label: string; value: { value: number; opponent: string; date: string } | null }> = [
    { label: 'Career high goals', value: milestones.careerHighGoals },
    { label: 'Career high assists', value: milestones.careerHighAssists },
    { label: 'Career high points', value: milestones.careerHighPoints },
  ];

  for (const card of cards) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:.85rem .95rem; border-radius:10px; border:1px solid var(--border); background:rgba(255,255,255,0.02);';
    const label = document.createElement('p');
    label.className = 'muted';
    label.style.cssText = 'margin:0 0 .35rem; font-size:.78rem; text-transform:uppercase; letter-spacing:.05em;';
    label.textContent = card.label;
    const value = document.createElement('div');
    value.style.cssText = 'font-size:1.5rem; font-weight:800;';
    value.textContent = card.value ? String(card.value.value) : '0';
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.style.cssText = 'margin:.35rem 0 0; font-size:.85rem;';
    detail.textContent = card.value ? `vs ${card.value.opponent} on ${formatDate(card.value.date)}` : 'No games logged yet.';
    wrap.append(label, value, detail);
    grid.appendChild(wrap);
  }

  section.appendChild(grid);

  const totals = document.createElement('p');
  const totalPoints = milestones.careerTotals.goals + milestones.careerTotals.assists;
  totals.className = 'muted';
  totals.style.cssText = 'margin:.9rem 0 0; font-size:.9rem;';
  totals.textContent = `Career totals: ${milestones.careerTotals.goals} goals, ${milestones.careerTotals.assists} assists, ${totalPoints} points, ${milestones.careerTotals.groundBalls} ground balls across ${milestones.careerTotals.games} games.`;
  section.appendChild(totals);

  return section;
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
  for (const label of ['Date', 'Opponent', 'G', 'A', 'Pts', 'GB', 'CT', 'Saves', 'FO']) {
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

    // Opponent column
    const oppTd = document.createElement('td');
    if (ps.opponentName) {
      const oppLink = document.createElement('a');
      oppLink.href = ps.opponentId ? `#/teams/${ps.opponentId}` : '#';
      oppLink.style.cssText = 'display:inline-flex; align-items:center; gap:0.35rem; text-decoration:none; color:inherit;';
      if (ps.opponentLogoUrl) {
        const oppImg = document.createElement('img');
        oppImg.src = ps.opponentLogoUrl;
        oppImg.alt = `${ps.opponentName} logo`;
        oppImg.width = 18;
        oppImg.height = 18;
        oppImg.loading = 'lazy';
        oppImg.style.cssText = 'width:18px;height:18px;object-fit:contain;border-radius:50%;';
        oppLink.appendChild(oppImg);
      }
      const oppName = document.createElement('span');
      oppName.textContent = ps.opponentName;
      oppName.style.fontSize = '0.85rem';
      oppLink.appendChild(oppName);
      oppTd.appendChild(oppLink);
    } else {
      oppTd.textContent = '-';
      oppTd.className = 'muted';
    }
    tr.appendChild(oppTd);

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
