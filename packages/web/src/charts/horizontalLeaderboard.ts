// Generalized horizontal bar chart: rank items by a numeric value.
// Caller passes data already sorted descending; we render in given order.

import { max } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type {
  ChartHandle,
  HorizontalLeaderboardDatum,
  HorizontalLeaderboardOptions,
} from './types.js';

const DEFAULTS: HorizontalLeaderboardOptions = {
  width: 720,
  height: 480,
  margin: { top: 32, right: 56, bottom: 40, left: 140 },
  barColor: '#2563eb',
  valueFormat: (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)),
  xAxisLabel: '',
};

// Bar colors fade slightly from rank 1 → last for visual hierarchy.
function barOpacity(rank: number, total: number): number {
  return 1 - (rank / total) * 0.4;
}

export function renderHorizontalLeaderboard(
  el: HTMLElement,
  data: ReadonlyArray<HorizontalLeaderboardDatum>,
  options?: Partial<HorizontalLeaderboardOptions>,
): ChartHandle {
  const opts: HorizontalLeaderboardOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();
  // Use theme accent so bars respect dark/light mode; fall back to default barColor.
  const barFill = theme.accent !== '#1d4ed8' ? theme.accent : opts.barColor;

  const { svg: _svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    el,
    opts.width,
    opts.height,
    opts.margin,
  );

  if (data.length === 0) {
    inner
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.muted)
      .text('No data');
    return {
      destroy() {
        while (el.firstChild) el.removeChild(el.firstChild);
      },
    };
  }

  // Use index for the band domain so duplicate labels still render.
  const y = scaleBand<number>()
    .domain(data.map((_, i) => i))
    .range([0, innerHeight])
    .padding(0.25);

  const xMax = max(data, (d) => d.value) ?? 0;
  const x = scaleLinear()
    .domain([0, Math.max(1, xMax)])
    .nice()
    .range([0, innerWidth]);

  // Alternating row background stripes for readability.
  for (let i = 0; i < data.length; i++) {
    if (i % 2 === 0) continue;
    const yPos = y(i) ?? 0;
    const bandH = y.bandwidth();
    inner
      .append('rect')
      .attr('x', -opts.margin.left)
      .attr('y', yPos - y.paddingInner() * y.step() * 0.5)
      .attr('width', opts.margin.left + innerWidth + opts.margin.right)
      .attr('height', bandH + y.paddingInner() * y.step())
      .attr('fill', theme.border)
      .attr('opacity', 0.35);
  }

  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    const yPos = y(i) ?? 0;
    const bandH = y.bandwidth();
    const barW = Math.max(x(d.value), 2); // ensure at least a sliver
    const radius = Math.min(4, bandH / 2);

    const tip = d.sublabel
      ? `${d.label} (${d.sublabel}) - ${opts.valueFormat(d.value)}`
      : `${d.label} - ${opts.valueFormat(d.value)}`;

    const appendBar = (parent: typeof inner) =>
      parent
        .append('rect')
        .attr('x', 0)
        .attr('y', yPos)
        .attr('width', barW)
        .attr('height', bandH)
        .attr('rx', radius)
        .attr('ry', radius)
        .attr('fill', barFill)
        .attr('opacity', barOpacity(i, data.length))
        .append('title')
        .text(tip);

    if (d.href) {
      const a = inner.append('a').attr('href', d.href).style('cursor', 'pointer');
      appendBar(a as unknown as typeof inner);
    } else {
      appendBar(inner);
    }

    // Rank number to the left of the bar
    inner
      .append('text')
      .attr('x', -4)
      .attr('y', yPos + bandH / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', theme.muted)
      .style('font-size', '13px')
      .text(`${i + 1}.`);

    // Value label at end of bar — bold, slightly larger
    inner
      .append('text')
      .attr('x', barW + 6)
      .attr('y', yPos + bandH / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', theme.fg)
      .style('font-size', '16px')
      .style('font-weight', '600')
      .text(opts.valueFormat(d.value));
  }

  // Y-axis: names only, no domain line or tick marks.
  inner
    .append('g')
    .call(
      (g) => {
        // Left-align labels with a small indent
        for (let i = 0; i < data.length; i++) {
          const d = data[i]!;
          const yPos = (y(i) ?? 0) + y.bandwidth() / 2;
          const label = d.sublabel ? `${d.label}` : d.label;
          g.append('text')
            .attr('x', -opts.margin.left + 20)
            .attr('y', yPos)
            .attr('dominant-baseline', 'middle')
            .attr('fill', theme.fg)
            .style('font-size', '13px')
            .text(label);
        }
      },
    );

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
