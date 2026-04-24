// Generalized horizontal bar chart: rank items by a numeric value.
// Caller passes data already sorted descending; we render in given order.

import { axisBottom, axisLeft } from 'd3-axis';
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
  margin: { top: 32, right: 56, bottom: 40, left: 180 },
  barColor: '#2563eb',
  valueFormat: (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)),
  xAxisLabel: '',
};

export function renderHorizontalLeaderboard(
  el: HTMLElement,
  data: ReadonlyArray<HorizontalLeaderboardDatum>,
  options?: Partial<HorizontalLeaderboardOptions>,
): ChartHandle {
  const opts: HorizontalLeaderboardOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
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
    .padding(0.2);

  const xMax = max(data, (d) => d.value) ?? 0;
  const x = scaleLinear()
    .domain([0, Math.max(1, xMax)])
    .nice()
    .range([0, innerWidth]);

  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    const yPos = y(i) ?? 0;
    const bandH = y.bandwidth();

    const barW = x(d.value);

    const tip = d.sublabel
      ? `${d.label} (${d.sublabel}) — ${opts.valueFormat(d.value)}`
      : `${d.label} — ${opts.valueFormat(d.value)}`;

    if (d.href) {
      const a = inner.append('a').attr('href', d.href);
      a.append('rect')
        .attr('x', 0)
        .attr('y', yPos)
        .attr('width', barW)
        .attr('height', bandH)
        .attr('fill', opts.barColor)
        .style('cursor', 'pointer')
        .append('title')
        .text(tip);
    } else {
      inner
        .append('rect')
        .attr('x', 0)
        .attr('y', yPos)
        .attr('width', barW)
        .attr('height', bandH)
        .attr('fill', opts.barColor)
        .append('title')
        .text(tip);
    }

    // Value label at end of bar
    inner
      .append('text')
      .attr('x', barW + 4)
      .attr('y', yPos + bandH / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', theme.fg)
      .style('font-size', '13px')
      .text(opts.valueFormat(d.value));
  }

  // Axes
  const yAxisG = inner.append('g').call(
    axisLeft(y).tickFormat((i) => {
      const d = data[i as number];
      return d ? d.label : '';
    }),
  );
  yAxisG.selectAll('text').attr('fill', theme.fg).style('font-size', '13px');
  yAxisG.selectAll('path,line').attr('stroke', theme.border);

  const xAxisG = inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(axisBottom(x).ticks(5).tickFormat((d) => String(d)));
  xAxisG.selectAll('text').attr('fill', theme.fg).style('font-size', '12px');
  xAxisG.selectAll('path,line').attr('stroke', theme.border);

  if (opts.xAxisLabel) {
    svg
      .append('text')
      .attr('x', opts.margin.left + innerWidth / 2)
      .attr('y', opts.height - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.muted)
      .text(opts.xAxisLabel);
  }

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
