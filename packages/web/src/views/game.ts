// Wave 14 Lane 3 (Leia) — per-game replay scrubber view.
//
// Pixi.js v8 canvas (~800x300) divided into 4 quarter segments. Each
// synthesized scoring event renders as a colored circle (home blue, away
// red) bucketed into its quarter. A scrubber slider beneath the canvas
// fades goals in and updates the running score in real time.
//
// Source data has NO per-goal timestamps; events are derived from team
// quarter totals + per-game player goal/assist totals. The disclaimer
// banner makes that explicit. See packages/server/src/queries/games.ts.
//
// Lazy-loaded via dynamic import() from main.ts so pixi.js stays out of
// the entry chunk for users who never visit a game page.

import { Application, Container, Graphics, Text, FederatedPointerEvent } from 'pixi.js';
import { ApiError, getGameDetail, type GameDetail, type ScoringEvent } from '../api.js';
import type { Team } from '@pll/shared';
import { formatDate } from '../util/format.js';
import { renderTeamBadge } from '../components/teamBadge.js';

type DetailWithEvents = GameDetail & {
  homeTeam: Team | null;
  awayTeam: Team | null;
  scoringEvents: ScoringEvent[];
  scoringEventsHeuristic: string;
};

interface ActiveView {
  destroy: () => void;
}

let active: ActiveView | null = null;

const CANVAS_W = 800;
const CANVAS_H = 300;
const PAD_X = 40;
const PAD_TOP = 40;
const PAD_BOTTOM = 60;
const HOME_COLOR = 0x4ea1ff;
const AWAY_COLOR = 0xdc4028;
const BG = 0x0e1119;
const QUARTER_LINE = 0x303642;

export function destroy(): void {
  if (active) {
    active.destroy();
    active = null;
  }
}

export async function render(root: HTMLElement, params: Record<string, string>): Promise<void> {
  destroy();
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
    err.textContent = 'Missing game id';
    root.appendChild(err);
    return;
  }

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  let detail: DetailWithEvents;
  try {
    detail = (await getGameDetail(id)) as DetailWithEvents;
  } catch (err) {
    status.className = 'error';
    status.textContent = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    return;
  }
  status.remove();

  // Bail if user navigated away during fetch.
  if (!document.body.contains(root)) return;

  const homeName = detail.homeTeam?.name ?? `Team #${detail.game.homeTeamId}`;
  const awayName = detail.awayTeam?.name ?? `Team #${detail.game.awayTeamId}`;

  root.appendChild(buildHeader(detail, homeName, awayName));

  // Disclaimer banner.
  const note = document.createElement('p');
  note.className = 'muted';
  note.style.cssText = 'font-size:.85rem; margin:.25rem 0 .75rem;';
  note.textContent =
    detail.scoringEventsHeuristic ??
    'Made from team scores by quarter (no per-goal timestamps).';
  root.appendChild(note);

  // Live score readout (updates as scrubber moves).
  const scoreLine = document.createElement('div');
  scoreLine.className = 'scrubber-score';
  scoreLine.style.cssText =
    'display:flex; gap:1.5rem; align-items:baseline; font-size:1.5rem; font-weight:600; margin:.5rem 0;';
  const awayScoreEl = document.createElement('span');
  awayScoreEl.style.color = '#dc4028';
  const homeScoreEl = document.createElement('span');
  homeScoreEl.style.color = '#4ea1ff';
  const sepEl = document.createElement('span');
  sepEl.className = 'muted';
  sepEl.textContent = '–';
  scoreLine.append(awayName + ' ', awayScoreEl, sepEl, homeScoreEl, ' ' + homeName);
  awayScoreEl.textContent = '0';
  homeScoreEl.textContent = '0';
  root.appendChild(scoreLine);

  // Pixi stage.
  const stage = document.createElement('div');
  stage.className = 'scrubber-stage';
  stage.style.cssText = `position:relative; width:${CANVAS_W}px; max-width:100%; height:${CANVAS_H}px; background:#0e1119; border-radius:8px; overflow:hidden;`;
  root.appendChild(stage);

  const tooltip = document.createElement('div');
  tooltip.style.cssText =
    'position:absolute; padding:4px 8px; background:rgba(14,17,25,0.95); color:#e6e8eb; font:12px/1.4 system-ui, sans-serif; border-radius:4px; pointer-events:none; transform:translate(8px, 8px); display:none; z-index:2;';
  stage.appendChild(tooltip);

  // Scrubber slider.
  const sliderWrap = document.createElement('div');
  sliderWrap.style.cssText = 'margin:.75rem 0 1.5rem; max-width:' + CANVAS_W + 'px;';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(detail.scoringEvents.length);
  slider.value = String(detail.scoringEvents.length);
  slider.step = '1';
  slider.style.cssText = 'width:100%;';
  slider.setAttribute('aria-label', 'Game timeline scrubber');
  sliderWrap.appendChild(slider);
  const sliderLabel = document.createElement('div');
  sliderLabel.className = 'muted';
  sliderLabel.style.cssText = 'font-size:.85rem; text-align:center;';
  sliderLabel.textContent = `Showing all ${detail.scoringEvents.length} goals`;
  sliderWrap.appendChild(sliderLabel);
  root.appendChild(sliderWrap);

  // Initialise pixi app.
  const app = new Application();
  await app.init({
    background: BG,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    width: CANVAS_W,
    height: CANVAS_H,
  });
  if (!document.body.contains(stage) || active !== null) {
    app.destroy(true, { children: true, texture: true });
    return;
  }
  stage.appendChild(app.canvas);

  // Quarter axis: 4 segments, OT (>4) grouped on the right.
  const events = detail.scoringEvents;
  const maxQuarter = Math.max(4, ...events.map((e) => e.quarter));
  const usableW = CANVAS_W - PAD_X * 2;
  const segW = usableW / maxQuarter;

  const axis = new Container();
  app.stage.addChild(axis);

  // Center line.
  const center = new Graphics();
  center.moveTo(PAD_X, CANVAS_H / 2).lineTo(CANVAS_W - PAD_X, CANVAS_H / 2).stroke({ width: 1, color: QUARTER_LINE });
  axis.addChild(center);

  for (let q = 0; q <= maxQuarter; q += 1) {
    const x = PAD_X + segW * q;
    const tick = new Graphics();
    tick.moveTo(x, PAD_TOP).lineTo(x, CANVAS_H - PAD_BOTTOM).stroke({ width: 1, color: QUARTER_LINE });
    axis.addChild(tick);
    if (q < maxQuarter) {
      const label = new Text({
        text: q < 4 ? `Q${q + 1}` : `OT${q - 3}`,
        style: { fill: 0x9aa3b2, fontSize: 14, fontFamily: 'system-ui, sans-serif' },
      });
      label.x = x + segW / 2 - label.width / 2;
      label.y = CANVAS_H - PAD_BOTTOM + 6;
      axis.addChild(label);
    }
  }

  // Side legends.
  const homeLabel = new Text({ text: homeName + ' (home)', style: { fill: HOME_COLOR, fontSize: 14, fontFamily: 'system-ui, sans-serif', fontWeight: '600' } });
  homeLabel.x = PAD_X;
  homeLabel.y = CANVAS_H / 2 + 8;
  axis.addChild(homeLabel);
  const awayLabel = new Text({ text: awayName + ' (away)', style: { fill: AWAY_COLOR, fontSize: 14, fontFamily: 'system-ui, sans-serif', fontWeight: '600' } });
  awayLabel.x = PAD_X;
  awayLabel.y = CANVAS_H / 2 - 24;
  axis.addChild(awayLabel);

  // Compute per-event x position by spreading them within their quarter
  // (count goals within each quarter and slot evenly).
  const quarterCounts = new Map<number, number>();
  for (const e of events) quarterCounts.set(e.quarter, (quarterCounts.get(e.quarter) ?? 0) + 1);
  const quarterSeen = new Map<number, number>();

  const goalsLayer = new Container();
  app.stage.addChild(goalsLayer);

  interface RenderedGoal { gfx: Graphics; ev: ScoringEvent; }
  const rendered: RenderedGoal[] = [];

  for (const ev of events) {
    const total = quarterCounts.get(ev.quarter) ?? 1;
    const idx = quarterSeen.get(ev.quarter) ?? 0;
    quarterSeen.set(ev.quarter, idx + 1);
    const segStart = PAD_X + segW * (ev.quarter - 1);
    const x = segStart + (segW * (idx + 1)) / (total + 1);
    const y = ev.side === 'home' ? CANVAS_H / 2 + 30 + ((idx % 3) * 14) : CANVAS_H / 2 - 30 - ((idx % 3) * 14);
    const color = ev.side === 'home' ? HOME_COLOR : AWAY_COLOR;
    const g = new Graphics();
    g.circle(0, 0, 8).fill({ color, alpha: 0.9 });
    g.x = x;
    g.y = y;
    g.alpha = 0;
    g.eventMode = 'static';
    g.cursor = 'pointer';
    goalsLayer.addChild(g);

    g.on('pointerover', (e: FederatedPointerEvent) => {
      const lines: string[] = [];
      lines.push(`${ev.side === 'home' ? homeName : awayName} · Q${ev.quarter}`);
      lines.push(`Goal: ${ev.playerName ?? '(unattributed)'}`);
      if (ev.assistPlayerName) lines.push(`Assist: ${ev.assistPlayerName}`);
      lines.push(`Score after: ${ev.awayScoreAfter}–${ev.homeScoreAfter}`);
      tooltip.innerHTML = lines.map((l) => escapeHtml(l)).join('<br>');
      tooltip.style.display = 'block';
      const r = stage.getBoundingClientRect();
      tooltip.style.left = `${e.global.x - r.left + 0}px`;
      tooltip.style.top = `${e.global.y - r.top + 0}px`;
    });
    g.on('pointermove', (e: FederatedPointerEvent) => {
      const r = stage.getBoundingClientRect();
      tooltip.style.left = `${e.global.x - r.left}px`;
      tooltip.style.top = `${e.global.y - r.top}px`;
    });
    g.on('pointerout', () => {
      tooltip.style.display = 'none';
    });

    rendered.push({ gfx: g, ev });
  }

  // Apply scrubber position: events with sequence < cutoff visible (alpha 1),
  // event AT cutoff fades in proportionally as a hint, the rest invisible.
  function applyCutoff(cutoff: number): void {
    let lastHome = 0;
    let lastAway = 0;
    for (let i = 0; i < rendered.length; i += 1) {
      const r = rendered[i]!;
      if (i < cutoff) {
        r.gfx.alpha = 0.95;
        lastHome = r.ev.homeScoreAfter;
        lastAway = r.ev.awayScoreAfter;
      } else if (i === cutoff && cutoff < rendered.length) {
        r.gfx.alpha = 0.25;
      } else {
        r.gfx.alpha = 0;
      }
    }
    homeScoreEl.textContent = String(lastHome);
    awayScoreEl.textContent = String(lastAway);
    if (cutoff >= rendered.length) {
      sliderLabel.textContent = `Showing all ${rendered.length} goals`;
    } else {
      sliderLabel.textContent = `Showing ${cutoff} of ${rendered.length} goals`;
    }
  }
  applyCutoff(rendered.length);

  const onSlider = (): void => {
    const v = Number(slider.value);
    applyCutoff(Number.isFinite(v) ? Math.max(0, Math.min(rendered.length, Math.round(v))) : rendered.length);
  };
  slider.addEventListener('input', onSlider);

  // Player stats table.
  const statsHeader = document.createElement('h2');
  statsHeader.textContent = 'Player stats';
  root.appendChild(statsHeader);
  root.appendChild(buildPlayerStatsTable(detail.playerStats, awayName, homeName));

  active = {
    destroy(): void {
      slider.removeEventListener('input', onSlider);
      try {
        app.destroy(true, { children: true, texture: true });
      } catch {
        /* canvas may already be detached */
      }
    },
  };
}

function buildHeader(detail: DetailWithEvents, homeName: string, awayName: string): HTMLElement {
  const sb = document.createElement('div');
  sb.className = 'scoreboard';

  const sides = document.createElement('div');
  sides.className = 'scoreboard-sides';

  const awaySide = document.createElement('div');
  awaySide.className = 'scoreboard-side';
  const awayLabel = document.createElement('div');
  awayLabel.className = 'scoreboard-team';
  awayLabel.appendChild(
    renderTeamBadge({
      name: awayName,
      logoUrl: detail.awayTeam?.logoUrl ?? null,
      size: 'lg',
      href: `#/teams/${detail.game.awayTeamId}`,
    }),
  );
  const awayScore = document.createElement('div');
  awayScore.className = 'scoreboard-score';
  awayScore.textContent = detail.game.postponed ? '-' : String(detail.game.awayScore);
  awaySide.append(awayLabel, awayScore);

  const sep = document.createElement('div');
  sep.className = 'scoreboard-sep';
  sep.textContent = '@';

  const homeSide = document.createElement('div');
  homeSide.className = 'scoreboard-side';
  const homeLabel = document.createElement('div');
  homeLabel.className = 'scoreboard-team';
  homeLabel.appendChild(
    renderTeamBadge({
      name: homeName,
      logoUrl: detail.homeTeam?.logoUrl ?? null,
      size: 'lg',
      href: `#/teams/${detail.game.homeTeamId}`,
    }),
  );
  const homeScore = document.createElement('div');
  homeScore.className = 'scoreboard-score';
  homeScore.textContent = detail.game.postponed ? '-' : String(detail.game.homeScore);
  homeSide.append(homeLabel, homeScore);

  sides.append(awaySide, sep, homeSide);
  sb.appendChild(sides);

  const meta = document.createElement('div');
  meta.className = 'scoreboard-meta muted';
  let metaText = formatDate(detail.game.date);
  if (detail.game.otPeriods > 0) metaText += ` · OT${detail.game.otPeriods > 1 ? `x${detail.game.otPeriods}` : ''}`;
  meta.textContent = metaText;
  sb.appendChild(meta);

  return sb;
}

function buildPlayerStatsTable(
  stats: GameDetail['playerStats'],
  awayName: string,
  homeName: string,
): HTMLElement {
  const wrap = document.createElement('div');
  if (stats.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No player stats logged.';
    wrap.appendChild(p);
    return wrap;
  }
  const grouped = new Map<string, GameDetail['playerStats']>();
  for (const ps of stats) {
    const list = grouped.get(ps.teamName) ?? [];
    list.push(ps);
    grouped.set(ps.teamName, list);
  }
  const order: string[] = [];
  if (grouped.has(awayName)) order.push(awayName);
  if (grouped.has(homeName) && homeName !== awayName) order.push(homeName);
  for (const k of grouped.keys()) if (!order.includes(k)) order.push(k);

  for (const teamName of order) {
    const rows = grouped.get(teamName) ?? [];
    if (rows.length === 0) continue;
    const sub = document.createElement('h3');
    sub.textContent = teamName;
    wrap.appendChild(sub);
    const table = document.createElement('table');
    table.className = 'stat player-stats';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    for (const label of ['Player', 'G', 'A', 'GB', 'Saves', 'FO']) {
      const th = document.createElement('th');
      th.textContent = label;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const ps of rows) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const a = document.createElement('a');
      a.href = `#/players/${ps.playerId}`;
      a.textContent = ps.playerName;
      tdName.appendChild(a);
      tr.appendChild(tdName);
      for (const v of [ps.goals, ps.assists, ps.groundBalls, ps.saves, ps.foTaken > 0 ? `${ps.foWon}/${ps.foTaken}` : '–']) {
        const td = document.createElement('td');
        td.className = 'num';
        td.textContent = String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
  return wrap;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}
