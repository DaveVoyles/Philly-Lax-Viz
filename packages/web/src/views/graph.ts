// WebGL rivalry network graph (W12 L2, Han).
//
// Renders all teams that have played at least one completed game as a
// force-directed network: node size = games played, edge thickness =
// head-to-head games, edge color = avg score margin (blue → red).
//
// Pixi.js v8 handles the WebGL drawing; d3-force runs the layout headlessly.
// The simulation stops once it cools below `alphaMin` so we're not burning
// GPU after the layout settles. `destroy()` tears down the pixi app + DOM
// listeners so a route change frees the GPU resources.

import { Application, Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

import { ApiError, getRivalries, type RivalryEdge, type RivalryNode } from '../api.js';

interface SimNode extends SimulationNodeDatum, RivalryNode {}
interface SimEdge extends SimulationLinkDatum<SimNode> {
  games: number;
  avgMargin: number;
}

interface ActiveView {
  destroy: () => void;
}

let active: ActiveView | null = null;

const NODE_BASE_RADIUS = 4;
const NODE_FILL = 0x4ea1ff;
const NODE_FILL_HOVER = 0xffd166;
const EDGE_DIM_ALPHA = 0.08;
const EDGE_DEFAULT_ALPHA = 0.55;
const BG_COLOR = 0x0e1119;

function colorByMargin(avg: number): number {
  // Blue (close games) → red (blowouts). Anchor scale at margin 12.
  const t = Math.min(Math.max(avg / 12, 0), 1);
  const r = Math.round(60 + (220 - 60) * t);
  const g = Math.round(140 - 80 * t);
  const b = Math.round(220 - 180 * t);
  return (r << 16) | (g << 8) | b;
}

function nodeRadius(games: number): number {
  return NODE_BASE_RADIUS + Math.sqrt(Math.max(games, 0)) * 1.6;
}

function edgeWidth(games: number): number {
  return 0.6 + Math.log(games + 1) * 1.4;
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
  h1.textContent = 'Rivalry network';
  root.appendChild(h1);

  const subtitle = document.createElement('p');
  subtitle.className = 'muted';
  subtitle.textContent = 'WebGL force-directed graph of every team that has played a completed game.';
  root.appendChild(subtitle);

  const status = document.createElement('div');
  status.className = 'graph-status';
  status.textContent = 'Loading rivalries…';
  root.appendChild(status);

  const stage = document.createElement('div');
  stage.className = 'graph-stage';
  stage.style.position = 'relative';
  stage.style.width = '100%';
  stage.style.height = '70vh';
  stage.style.minHeight = '480px';
  stage.style.background = '#0e1119';
  stage.style.borderRadius = '8px';
  stage.style.overflow = 'hidden';
  stage.style.marginTop = '0.75rem';
  stage.style.touchAction = 'none';
  root.appendChild(stage);

  // Legend (HTML overlay, not pixi).
  const legend = document.createElement('div');
  legend.className = 'graph-legend';
  legend.style.position = 'absolute';
  legend.style.top = '8px';
  legend.style.left = '8px';
  legend.style.padding = '6px 10px';
  legend.style.background = 'rgba(14,17,25,0.85)';
  legend.style.color = '#e6e8eb';
  legend.style.font = '12px/1.4 system-ui, sans-serif';
  legend.style.borderRadius = '4px';
  legend.style.pointerEvents = 'none';
  legend.style.maxWidth = '320px';
  legend.innerHTML =
    'Node size = games played &nbsp;·&nbsp; Edge thickness = head-to-head games &nbsp;·&nbsp; ' +
    '<span style="color:#3c8cdc">blue</span>→<span style="color:#dc4028">red</span> = avg score margin';
  stage.appendChild(legend);

  // Tooltip (HTML overlay).
  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  tooltip.style.position = 'absolute';
  tooltip.style.padding = '4px 8px';
  tooltip.style.background = 'rgba(14,17,25,0.95)';
  tooltip.style.color = '#e6e8eb';
  tooltip.style.font = '12px/1.4 system-ui, sans-serif';
  tooltip.style.borderRadius = '4px';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.transform = 'translate(8px, 8px)';
  tooltip.style.display = 'none';
  tooltip.style.zIndex = '2';
  stage.appendChild(tooltip);

  let data: { nodes: RivalryNode[]; edges: RivalryEdge[] };
  try {
    data = await getRivalries();
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.status} — ${err.message}` : String(err);
    status.textContent = `Failed to load: ${msg}`;
    status.classList.add('error');
    return;
  }
  status.textContent = `${data.nodes.length} teams · ${data.edges.length} rivalries`;

  // Don't bother starting pixi if the route changed before the fetch landed.
  if (!document.body.contains(stage)) return;

  const width = stage.clientWidth || 800;
  const height = stage.clientHeight || 480;

  const app = new Application();
  await app.init({
    background: BG_COLOR,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio ?? 1, 2),
    autoDensity: true,
    width,
    height,
  });
  // If we got destroyed while async-initialising, bail without leaking.
  if (!document.body.contains(stage) || active !== null) {
    app.destroy(true, { children: true, texture: true });
    return;
  }
  stage.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);
  const edgeContainer = new Container();
  edgeContainer.eventMode = 'none';
  world.addChild(edgeContainer);
  const nodeContainer = new Container();
  world.addChild(nodeContainer);

  // Build sim datasets. d3-force mutates these objects with x/y in place.
  const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
  const idIndex = new Map<number, SimNode>(simNodes.map((n) => [n.id, n]));
  const simEdges: SimEdge[] = data.edges
    .filter((e) => idIndex.has(e.source) && idIndex.has(e.target))
    .map((e) => ({
      source: idIndex.get(e.source)!,
      target: idIndex.get(e.target)!,
      games: e.games,
      avgMargin: e.avgMargin,
    }));

  // Adjacency for hover highlighting.
  const incidentByNode = new Map<number, Set<number>>();
  for (let i = 0; i < simEdges.length; i += 1) {
    const e = simEdges[i]!;
    const sId = (e.source as SimNode).id;
    const tId = (e.target as SimNode).id;
    if (!incidentByNode.has(sId)) incidentByNode.set(sId, new Set());
    if (!incidentByNode.has(tId)) incidentByNode.set(tId, new Set());
    incidentByNode.get(sId)!.add(i);
    incidentByNode.get(tId)!.add(i);
  }

  // Pre-tick the simulation so the first paint is laid out.
  const sim: Simulation<SimNode, SimEdge> = forceSimulation<SimNode>(simNodes)
    .force('charge', forceManyBody<SimNode>().strength(-30))
    .force('link', forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(60).strength(0.15))
    .force('center', forceCenter<SimNode>(width / 2, height / 2))
    .alphaMin(0.01)
    .stop();

  const settleStart = performance.now();
  for (let i = 0; i < 300 && sim.alpha() > sim.alphaMin(); i += 1) sim.tick();
  const settleMs = Math.round(performance.now() - settleStart);
  // eslint-disable-next-line no-console
  console.log(`[graph] settled ${simNodes.length} nodes / ${simEdges.length} edges in ${settleMs}ms`);

  // Build node graphics.
  const nodeGfx = new Map<number, Graphics>();
  for (const n of simNodes) {
    const g = new Graphics();
    g.circle(0, 0, nodeRadius(n.games)).fill({ color: NODE_FILL, alpha: 0.95 });
    g.x = n.x ?? width / 2;
    g.y = n.y ?? height / 2;
    g.eventMode = 'static';
    g.cursor = 'pointer';
    (g as Graphics & { __id?: number }).__id = n.id;
    nodeContainer.addChild(g);
    nodeGfx.set(n.id, g);
  }

  function drawAllEdges(highlightIdx: Set<number> | null): void {
    edgeContainer.removeChildren();
    const g = new Graphics();
    for (let i = 0; i < simEdges.length; i += 1) {
      const e = simEdges[i]!;
      const s = e.source as SimNode;
      const t = e.target as SimNode;
      if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
      const dim = highlightIdx !== null && !highlightIdx.has(i);
      const alpha = dim ? EDGE_DIM_ALPHA : EDGE_DEFAULT_ALPHA;
      g.moveTo(s.x, s.y)
        .lineTo(t.x, t.y)
        .stroke({ width: edgeWidth(e.games), color: colorByMargin(e.avgMargin), alpha });
    }
    edgeContainer.addChild(g);
  }
  drawAllEdges(null);

  // Hover/click handlers on nodes.
  let hoveredId: number | null = null;
  function setHovered(id: number | null, screenX = 0, screenY = 0): void {
    if (hoveredId === id) {
      if (id !== null) {
        tooltip.style.left = `${screenX}px`;
        tooltip.style.top = `${screenY}px`;
      }
      return;
    }
    // Reset previous hovered node visuals.
    if (hoveredId !== null) {
      const prev = nodeGfx.get(hoveredId);
      const prevData = idIndex.get(hoveredId);
      if (prev && prevData) {
        prev.clear();
        prev.circle(0, 0, nodeRadius(prevData.games)).fill({ color: NODE_FILL, alpha: 0.95 });
      }
    }
    hoveredId = id;
    if (id === null) {
      drawAllEdges(null);
      tooltip.style.display = 'none';
      return;
    }
    const cur = nodeGfx.get(id);
    const curData = idIndex.get(id);
    if (cur && curData) {
      cur.clear();
      cur.circle(0, 0, nodeRadius(curData.games) * 1.4).fill({ color: NODE_FILL_HOVER, alpha: 1 });
      tooltip.textContent = `${curData.name} · ${curData.wins}-${curData.losses} · ${curData.games} games`;
      tooltip.style.left = `${screenX}px`;
      tooltip.style.top = `${screenY}px`;
      tooltip.style.display = 'block';
    }
    drawAllEdges(incidentByNode.get(id) ?? new Set());
  }

  for (const [id, g] of nodeGfx) {
    g.on('pointerover', (e: FederatedPointerEvent) => {
      setHovered(id, e.global.x, e.global.y);
    });
    g.on('pointermove', (e: FederatedPointerEvent) => {
      if (hoveredId === id) {
        tooltip.style.left = `${e.global.x}px`;
        tooltip.style.top = `${e.global.y}px`;
      }
    });
    g.on('pointerout', () => {
      if (hoveredId === id) setHovered(null);
    });
    g.on('pointertap', () => {
      window.location.hash = `#/teams/${id}`;
    });
  }

  // Pan + zoom on the world container, mouse-anchored.
  let isPanning = false;
  let panLast = { x: 0, y: 0 };
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  const onPointerDown = (e: PointerEvent): void => {
    // Only start panning when not over a node.
    if ((e.target as HTMLElement) !== app.canvas) return;
    isPanning = true;
    panLast = { x: e.clientX, y: e.clientY };
    app.canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!isPanning) return;
    world.x += e.clientX - panLast.x;
    world.y += e.clientY - panLast.y;
    panLast = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (): void => {
    isPanning = false;
    app.canvas.style.cursor = 'default';
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.min(8, Math.max(0.15, world.scale.x * factor));
    const k = newScale / world.scale.x;
    world.x = mouseX - (mouseX - world.x) * k;
    world.y = mouseY - (mouseY - world.y) * k;
    world.scale.set(newScale);
  };

  app.canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  app.canvas.addEventListener('wheel', onWheel, { passive: false });

  // Throttled resize.
  let resizeTimer: number | null = null;
  const onResize = (): void => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const w = stage.clientWidth || 800;
      const h = stage.clientHeight || 480;
      app.renderer.resize(w, h);
    }, 120);
  };
  window.addEventListener('resize', onResize);

  active = {
    destroy(): void {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      try {
        app.canvas.removeEventListener('pointerdown', onPointerDown);
        app.canvas.removeEventListener('wheel', onWheel);
      } catch {
        /* canvas may already be detached */
      }
      sim.stop();
      app.destroy(true, { children: true, texture: true });
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    },
  };
}
