// Wave H7 L2 (Yoda) — tiny canvas line chart for inline leader trends.
//
// Designed for ~80×24 cells in the leaders table; no axes, no labels,
// just a line scaled to the data's min/max. Empty or single-point series
// render as a flat dotted baseline so users see "yes, we have data, but
// there's nothing to chart yet".

export interface SparklineOptions {
  color?: string;
  baselineColor?: string;
  lineWidth?: number;
  /** Optional override; defaults to canvas.width / canvas.height. */
  width?: number;
  height?: number;
  /** Padding inside the canvas to keep the stroke from clipping. */
  padding?: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

const DEFAULTS = {
  color: '#2563eb',
  baselineColor: '#9ca3af',
  lineWidth: 1.25,
  padding: 2,
};

/**
 * Map a values array onto canvas coordinates.
 *
 * - Empty array → empty result.
 * - Single value → one point centered horizontally and vertically.
 * - Multi-value → x evenly spaced across [padding, w-padding];
 *   y inverted so larger values render higher on the canvas, scaled
 *   to the data's [min, max] range. If all values are equal the line
 *   sits on the vertical midline.
 */
export function normalizeForSparkline(
  values: readonly number[],
  width: number,
  height: number,
  padding = DEFAULTS.padding,
): NormalizedPoint[] {
  if (values.length === 0) return [];
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  if (values.length === 1) {
    return [{ x: padding + innerW / 2, y: padding + innerH / 2 }];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const step = innerW / (values.length - 1);

  return values.map((v, i) => {
    const x = padding + step * i;
    let y: number;
    if (range === 0) {
      y = padding + innerH / 2;
    } else {
      // Invert: larger value → smaller pixel y (closer to top).
      y = padding + innerH - ((v - min) / range) * innerH;
    }
    return { x, y };
  });
}

export function drawSparkline(
  canvas: HTMLCanvasElement,
  values: readonly number[],
  opts: SparklineOptions = {},
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = opts.width ?? canvas.width;
  const height = opts.height ?? canvas.height;
  const padding = opts.padding ?? DEFAULTS.padding;
  const color = opts.color ?? DEFAULTS.color;
  const baselineColor = opts.baselineColor ?? DEFAULTS.baselineColor;
  const lineWidth = opts.lineWidth ?? DEFAULTS.lineWidth;

  ctx.clearRect(0, 0, width, height);

  if (values.length <= 1) {
    // Flat dotted baseline across the middle so the cell isn't visually empty.
    ctx.save();
    ctx.strokeStyle = baselineColor;
    ctx.lineWidth = 1;
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash([2, 2]);
    }
    ctx.beginPath();
    ctx.moveTo(padding, height / 2);
    ctx.lineTo(width - padding, height / 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const points = normalizeForSparkline(values, width, height, padding);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}
