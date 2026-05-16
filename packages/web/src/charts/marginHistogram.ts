import type { Game } from '@pll/shared';
import type { ChartHandle } from './types.js';

export interface MarginBucket {
  label: string;
  count: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function buildMarginBuckets(games: Game[]): MarginBucket[] {
  const buckets: MarginBucket[] = [
    { label: '1-3', count: 0 },
    { label: '4-6', count: 0 },
    { label: '7-10', count: 0 },
    { label: '11-15', count: 0 },
    { label: '16+', count: 0 },
  ];

  for (const g of games) {
    if (g.postponed) continue;
    const margin = Math.abs(g.homeScore - g.awayScore);
    if (margin <= 3) buckets[0]!.count += 1;
    else if (margin <= 6) buckets[1]!.count += 1;
    else if (margin <= 10) buckets[2]!.count += 1;
    else if (margin <= 15) buckets[3]!.count += 1;
    else buckets[4]!.count += 1;
  }

  return buckets;
}

function appendSvgText(
  svg: SVGSVGElement,
  attrs: Record<string, string>,
  text: string,
): SVGTextElement {
  const node = document.createElementNS(SVG_NS, 'text');
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text;
  svg.appendChild(node);
  return node;
}

export function renderMarginHistogram(
  container: HTMLElement,
  games: Game[],
): ChartHandle {
  container.replaceChildren();

  const buckets = buildMarginBuckets(games);
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const width = Math.max(container.clientWidth || 400, 300);
  const height = 160;
  const pad = { top: 28, right: 8, bottom: 30, left: 24 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const gap = 6;
  const barWidth = Math.max(20, Math.floor((plotWidth - gap * (buckets.length - 1)) / buckets.length));
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const topCount = Math.max(...buckets.map((bucket) => bucket.count));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Score margin distribution');

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('x1', String(pad.left));
  baseline.setAttribute('x2', String(width - pad.right));
  baseline.setAttribute('y1', String(height - pad.bottom));
  baseline.setAttribute('y2', String(height - pad.bottom));
  baseline.setAttribute('stroke', 'var(--border)');
  svg.appendChild(baseline);

  appendSvgText(
    svg,
    {
      x: String(pad.left),
      y: '16',
      'font-size': '12',
      fill: 'var(--muted)',
    },
    total > 0 ? `Score margins (${total} games)` : 'No completed games yet',
  );

  buckets.forEach((bucket, index) => {
    const barHeight = Math.round((bucket.count / maxCount) * plotHeight);
    const x = pad.left + index * (barWidth + gap);
    const y = pad.top + plotHeight - barHeight;

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(Math.max(barHeight, 0)));
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', bucket.count === topCount && topCount > 0 ? 'var(--accent)' : 'var(--muted)');
    rect.setAttribute('opacity', bucket.count === topCount && topCount > 0 ? '1' : '0.7');
    svg.appendChild(rect);

    appendSvgText(
      svg,
      {
        x: String(x + barWidth / 2),
        y: String(Math.max(y - 4, pad.top - 2)),
        'text-anchor': 'middle',
        'font-size': '11',
        fill: 'var(--fg)',
      },
      String(bucket.count),
    );

    appendSvgText(
      svg,
      {
        x: String(x + barWidth / 2),
        y: String(height - 8),
        'text-anchor': 'middle',
        'font-size': '11',
        fill: 'var(--muted)',
      },
      bucket.label,
    );
  });

  container.appendChild(svg);

  return {
    destroy() {
      svg.remove();
    },
  };
}
