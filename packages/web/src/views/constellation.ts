// WebGL player constellation (W15 L2, R2).
//
// Scatter-plot of every player in the current season:
//   x = goals per game, y = assists per game, size = sqrt(points)*3,
//   color = team color (none in DB today → hashed-name hue fallback).
//
// Lazy-imported from main.ts so pixi stays in the shared chunk; the
// constellation chunk itself only contains this module + axis logic.

import { Application, Container, Graphics, Text, FederatedPointerEvent } from 'pixi.js';

import { ApiError, getConstellation, type ConstellationPlayer } from '../api.js';

interface ActiveView {
  destroy: () => void;
}

let active: ActiveView | null = null;

const BG_COLOR = 0x0e1119;
const AXIS_COLOR = 0x4a5366;
const AXIS_LABEL_COLOR = 0xb8bcc4;
const TICK_LABEL_COLOR = 0x8a909a;

const STAGE_W = 900;
const STAGE_H = 600;
const PAD_LEFT = 64;
const PAD_RIGHT = 24;
const PAD_TOP = 24;
const PAD_BOTTOM = 56;
const PLOT_W = STAGE_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = STAGE_H - PAD_TOP - PAD_BOTTOM;

// Map a team name → consistent hue. Same algorithm in legend + dots so the
// swatch and circle always match.
function hashTeamColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return hslToRgb(hue, 0.55, 0.55);
}

function hslToRgb(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

function colorForPlayer(p: ConstellationPlayer): number {
  if (p.teamColor) {
    const m = /^#?([0-9a-f]{6})$/i.exec(p.teamColor);
    if (m) return parseInt(m[1]!, 16);
  }
  return hashTeamColor(p.teamName);
}

function radiusForPoints(points: number): number {
  return Math.max(2, Math.sqrt(Math.max(points, 0)) * 3);
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  // Round up to nearest 0.5 so the scale doesn't visually clip the topmost dot.
  return Math.ceil(value * 2 + 0.001) / 2;
}

export function destroy(): void {
  if (active) {
    active.destroy();
    active = null;
  }
}

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  destroy();
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Player constellation';
  root.appendChild(h1);

  const subtitle = document.createElement('p');
  subtitle.className = 'muted';
  subtitle.textContent =
    'Every player in the season — x = goals per game, y = assists per game, dot size = total points, color = team. Click a dot to open that player.';
  root.appendChild(subtitle);

  const status = document.createElement('div');
  status.className = 'graph-status';
  status.textContent = 'Loading players…';
  root.appendChild(status);

  const stage = document.createElement('div');
  stage.className = 'constellation-stage';
  stage.style.position = 'relative';
  stage.style.width = `${STAGE_W}px`;
  stage.style.maxWidth = '100%';
  stage.style.height = `${STAGE_H}px`;
  stage.style.background = '#0e1119';
  stage.style.borderRadius = '8px';
  stage.style.overflow = 'hidden';
  stage.style.marginTop = '0.75rem';
  root.appendChild(stage);

  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  tooltip.style.position = 'absolute';
  tooltip.style.padding = '6px 10px';
  tooltip.style.background = 'rgba(14,17,25,0.95)';
  tooltip.style.color = '#e6e8eb';
  tooltip.style.font = '12px/1.4 system-ui, sans-serif';
  tooltip.style.borderRadius = '4px';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.transform = 'translate(8px, 8px)';
  tooltip.style.display = 'none';
  tooltip.style.zIndex = '2';
  tooltip.style.maxWidth = '260px';
  stage.appendChild(tooltip);

  const legend = document.createElement('div');
  legend.className = 'constellation-legend';
  legend.style.position = 'absolute';
  legend.style.top = '8px';
  legend.style.right = '8px';
  legend.style.padding = '6px 10px';
  legend.style.background = 'rgba(14,17,25,0.85)';
  legend.style.color = '#e6e8eb';
  legend.style.font = '12px/1.4 system-ui, sans-serif';
  legend.style.borderRadius = '4px';
  legend.style.pointerEvents = 'none';
  legend.style.maxWidth = '220px';
  stage.appendChild(legend);

  let data: { season: number | null; players: ConstellationPlayer[] };
  try {
    data = await getConstellation();
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.status} — ${err.message}` : String(err);
    status.textContent = `Failed to load: ${msg}`;
    status.classList.add('error');
    return;
  }

  if (!document.body.contains(stage)) return;

  const players = data.players;
  status.textContent = `${players.length} players · season ${data.season ?? 'all'}`;

  if (players.length === 0) {
    legend.style.display = 'none';
    return;
  }

  // Top 8 teams by player count for the legend.
  const teamCounts = new Map<string, number>();
  for (const p of players) {
    teamCounts.set(p.teamName, (teamCounts.get(p.teamName) ?? 0) + 1);
  }
  const topTeams = [...teamCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  legend.innerHTML = topTeams
    .map(([team, count]) => {
      const sample = players.find((p) => p.teamName === team)!;
      const c = colorForPlayer(sample).toString(16).padStart(6, '0');
      return `<div style="display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#${c};"></span>
        <span>${team}</span>
        <span class="muted" style="margin-left:auto;color:#8a909a;">${count}</span>
      </div>`;
    })
    .join('');

  const maxX = niceMax(Math.max(...players.map((p) => p.goalsPerGame), 0.5));
  const maxY = niceMax(Math.max(...players.map((p) => p.assistsPerGame), 0.5));

  const xScale = (v: number): number => PAD_LEFT + (v / maxX) * PLOT_W;
  const yScale = (v: number): number => PAD_TOP + PLOT_H - (v / maxY) * PLOT_H;

  const app = new Application();
  await app.init({
    background: BG_COLOR,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    width: STAGE_W,
    height: STAGE_H,
  });
  if (!document.body.contains(stage) || active !== null) {
    app.destroy(true, { children: true, texture: true });
    return;
  }
  stage.appendChild(app.canvas);

  // Axes layer.
  const axisLayer = new Container();
  app.stage.addChild(axisLayer);

  const axisG = new Graphics();
  axisG.moveTo(PAD_LEFT, PAD_TOP).lineTo(PAD_LEFT, PAD_TOP + PLOT_H)
       .stroke({ width: 1, color: AXIS_COLOR });
  axisG.moveTo(PAD_LEFT, PAD_TOP + PLOT_H).lineTo(PAD_LEFT + PLOT_W, PAD_TOP + PLOT_H)
       .stroke({ width: 1, color: AXIS_COLOR });
  axisLayer.addChild(axisG);

  // Tick marks every 1.0 unit (or 0.5 if max is small).
  const tickStep = maxX <= 3 ? 0.5 : 1;
  for (let v = 0; v <= maxX + 1e-6; v += tickStep) {
    const x = xScale(v);
    const tg = new Graphics();
    tg.moveTo(x, PAD_TOP + PLOT_H).lineTo(x, PAD_TOP + PLOT_H + 4)
      .stroke({ width: 1, color: AXIS_COLOR });
    axisLayer.addChild(tg);
    const t = new Text({
      text: v.toFixed(tickStep < 1 ? 1 : 0),
      style: { fill: TICK_LABEL_COLOR, fontSize: 11, fontFamily: 'system-ui' },
    });
    t.x = x - t.width / 2;
    t.y = PAD_TOP + PLOT_H + 6;
    axisLayer.addChild(t);
  }
  const yStep = maxY <= 3 ? 0.5 : 1;
  for (let v = 0; v <= maxY + 1e-6; v += yStep) {
    const y = yScale(v);
    const tg = new Graphics();
    tg.moveTo(PAD_LEFT - 4, y).lineTo(PAD_LEFT, y)
      .stroke({ width: 1, color: AXIS_COLOR });
    axisLayer.addChild(tg);
    const t = new Text({
      text: v.toFixed(yStep < 1 ? 1 : 0),
      style: { fill: TICK_LABEL_COLOR, fontSize: 11, fontFamily: 'system-ui' },
    });
    t.x = PAD_LEFT - 8 - t.width;
    t.y = y - t.height / 2;
    axisLayer.addChild(t);
  }

  // Axis titles.
  const xLabel = new Text({
    text: 'Goals per game',
    style: { fill: AXIS_LABEL_COLOR, fontSize: 13, fontFamily: 'system-ui' },
  });
  xLabel.x = PAD_LEFT + PLOT_W / 2 - xLabel.width / 2;
  xLabel.y = PAD_TOP + PLOT_H + 28;
  axisLayer.addChild(xLabel);

  const yLabel = new Text({
    text: 'Assists per game',
    style: { fill: AXIS_LABEL_COLOR, fontSize: 13, fontFamily: 'system-ui' },
  });
  yLabel.rotation = -Math.PI / 2;
  yLabel.x = 16;
  yLabel.y = PAD_TOP + PLOT_H / 2 + yLabel.width / 2;
  axisLayer.addChild(yLabel);

  // Dot layer.
  const dotLayer = new Container();
  app.stage.addChild(dotLayer);

  const dotByPlayer = new Map<number, Graphics>();
  for (const p of players) {
    const g = new Graphics();
    const r = radiusForPoints(p.points);
    const color = colorForPlayer(p);
    g.circle(0, 0, r).fill({ color, alpha: 0.85 });
    g.x = xScale(p.goalsPerGame);
    g.y = yScale(p.assistsPerGame);
    g.eventMode = 'static';
    g.cursor = 'pointer';
    dotLayer.addChild(g);
    dotByPlayer.set(p.id, g);

    const tooltipText =
      `${p.name} · ${p.teamName}\n` +
      `G ${p.goals} · A ${p.assists} · P ${p.points}\n` +
      `GPG ${p.goalsPerGame.toFixed(2)} · APG ${p.assistsPerGame.toFixed(2)} · ${p.gamesPlayed} GP`;

    g.on('pointerover', (e: FederatedPointerEvent) => {
      tooltip.textContent = tooltipText;
      tooltip.style.left = `${e.global.x}px`;
      tooltip.style.top = `${e.global.y}px`;
      tooltip.style.display = 'block';
      g.clear();
      g.circle(0, 0, r * 1.35).fill({ color, alpha: 1 });
    });
    g.on('pointermove', (e: FederatedPointerEvent) => {
      tooltip.style.left = `${e.global.x}px`;
      tooltip.style.top = `${e.global.y}px`;
    });
    g.on('pointerout', () => {
      tooltip.style.display = 'none';
      g.clear();
      g.circle(0, 0, r).fill({ color, alpha: 0.85 });
    });
    g.on('pointertap', () => {
      window.location.hash = `#/players/${p.id}`;
    });
  }

  active = {
    destroy(): void {
      app.destroy(true, { children: true, texture: true });
    },
  };
}
