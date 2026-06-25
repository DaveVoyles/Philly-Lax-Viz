// Wave H7 Lane 3 (Leia) — small canvas line chart of GF/GA per completed game.
//
// Plotted in chronological order. Two lines (Goals For / Goals Against) with
// distinct colors and a tiny inline legend. Single-call helper, no D3, so it
// stays cheap on the team detail page where the SVG charts already pull weight.

import type { Game } from '@pll/shared';

export interface TeamScorePoint {
  date: string;
  gf: number;
  ga: number;
}

export interface RenderTeamScoreTrendOptions {
  width?: number;
  height?: number;
  gfColor?: string;
  gaColor?: string;
}

const DEFAULTS: Required<RenderTeamScoreTrendOptions> = {
  width: 640,
  height: 220,
  gfColor: '#ffffff',
  gaColor: '#dc2626',
};

/**
 * Pull completed (non-postponed) games for `teamId`, sorted oldest→newest,
 * mapped to {date, gf, ga}. Exported for testing — keeps the renderer trivial
 * and the data extraction independently verifiable.
 */
export function extractScoreTrend(games: ReadonlyArray<Game>, teamId: number): TeamScorePoint[] {
  const completed = games.filter((g) => !g.postponed && isFiniteScore(g.homeScore) && isFiniteScore(g.awayScore));
  const sorted = [...completed].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  return sorted.map((g) => {
    const isHome = g.homeTeamId === teamId;
    return {
      date: g.date,
      gf: isHome ? g.homeScore : g.awayScore,
      ga: isHome ? g.awayScore : g.homeScore,
    };
  });
}

function isFiniteScore(s: unknown): s is number {
  return typeof s === 'number' && Number.isFinite(s);
}

/**
 * Render the GF/GA trend line chart into `canvas`. Sizes the canvas to the
 * container's actual rendered width (responsive). Re-renders on resize via
 * ResizeObserver.
 *
 * Returns a destroy() handle for parity with the d3 renderers.
 */
export function renderTeamScoreTrend(
  canvas: HTMLCanvasElement,
  points: ReadonlyArray<TeamScorePoint>,
  options?: RenderTeamScoreTrendOptions,
): { destroy(): void } {
  const opts = { ...DEFAULTS, ...options };
  const aspect = opts.height / opts.width;
  let resizeObserver: ResizeObserver | undefined;

  function draw(displayWidth: number): void {
    const displayHeight = Math.round(displayWidth * aspect);
    const dpr = typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? window.devicePixelRatio
      : 1;
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    canvas.style.width = '100%';
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const padL = 32, padR = 16, padT = 24, padB = 28;
    const w = displayWidth - padL - padR;
    const h = displayHeight - padT - padB;

    if (points.length === 0) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No completed games yet', displayWidth / 2, displayHeight / 2);
      return;
    }

    const yMax = Math.max(1, ...points.flatMap((p) => [p.gf, p.ga]));
    const xStep = points.length === 1 ? 0 : w / (points.length - 1);

    // Axes (light grid).
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + h);
    ctx.lineTo(padL + w, padT + h);
    ctx.stroke();

    // Y ticks (0 and yMax).
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', padL - 4, padT + h);
    ctx.fillText(String(yMax), padL - 4, padT);

    const xAt = (i: number): number => points.length === 1 ? padL + w / 2 : padL + i * xStep;
    const yAt = (v: number): number => padT + h - (v / yMax) * h;

    drawLine(ctx, points.map((p, i) => [xAt(i), yAt(p.gf)]), opts.gfColor);
    drawLine(ctx, points.map((p, i) => [xAt(i), yAt(p.ga)]), opts.gaColor);

    // Dots.
    for (let i = 0; i < points.length; i++) {
      drawDot(ctx, xAt(i), yAt(points[i]!.gf), opts.gfColor);
      drawDot(ctx, xAt(i), yAt(points[i]!.ga), opts.gaColor);
    }

    // Legend (top-right).
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawLegendSwatch(ctx, padL + w - 110, padT - 14, opts.gfColor, 'GF');
    drawLegendSwatch(ctx, padL + w - 60, padT - 14, opts.gaColor, 'GA');
  }

  // Observe the parent container for size changes so the canvas stays
  // within its flex/grid column on all screen sizes.
  const container = canvas.parentElement;
  if (typeof ResizeObserver !== 'undefined' && container) {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      if (w > 10) draw(Math.min(w, opts.width));
    });
    resizeObserver.observe(container);
  }

  // Initial draw: use container width if available (already in DOM), otherwise
  // fall back to the default option width.
  const initialWidth = container && container.clientWidth > 10
    ? Math.min(container.clientWidth, opts.width)
    : opts.width;
  draw(initialWidth);

  return {
    destroy() {
      resizeObserver?.disconnect();
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<[number, number]>,
  color: string,
): void {
  if (pts.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
  ctx.stroke();
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawLegendSwatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 4, 10, 8);
  // Thin outline so white swatches remain visible on any background
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y - 4, 10, 8);
  ctx.fillStyle = '#6b7280';
  ctx.fillText(label, x + 14, y);
}
