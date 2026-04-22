// Horizontal stacked bar: goals + assists per player. Caller passes top-N
// already sorted (we render in the order received).

import { axisBottom, axisLeft } from 'd3-axis';
import { max } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type {
  ChartHandle,
  TopScorersDatum,
  TopScorersOptions,
} from './types.js';

const DEFAULTS: TopScorersOptions = {
  width: 640,
  height: 360,
  margin: { top: 32, right: 24, bottom: 40, left: 140 },
  goalColor: '#2563eb',
  assistColor: '#7c3aed',
};

export function renderTopScorers(
  el: HTMLElement,
  data: ReadonlyArray<TopScorersDatum>,
  options?: Partial<TopScorersOptions>,
): ChartHandle {
  const opts: TopScorersOptions = { ...DEFAULTS, ...options };
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
      .text('No player stats yet');
    return {
      destroy() {
        while (el.firstChild) el.removeChild(el.firstChild);
      },
    };
  }

  const y = scaleBand<string>()
    .domain(data.map((d) => d.playerName))
    .range([0, innerHeight])
    .padding(0.2);

  const xMax = max(data, (d) => d.goals + d.assists) ?? 0;
  const x = scaleLinear()
    .domain([0, Math.max(1, xMax)])
    .nice()
    .range([0, innerWidth]);

  for (const d of data) {
    const yPos = y(d.playerName) ?? 0;
    const bandH = y.bandwidth();

    inner
      .append('rect')
      .attr('x', 0)
      .attr('y', yPos)
      .attr('width', x(d.goals))
      .attr('height', bandH)
      .attr('fill', opts.goalColor)
      .append('title')
      .text(`${d.playerName} — Goals: ${d.goals}`);

    inner
      .append('rect')
      .attr('x', x(d.goals))
      .attr('y', yPos)
      .attr('width', x(d.assists))
      .attr('height', bandH)
      .attr('fill', opts.assistColor)
      .append('title')
      .text(`${d.playerName} — Assists: ${d.assists}`);

    // Total label at end of bar
    inner
      .append('text')
      .attr('x', x(d.goals + d.assists) + 4)
      .attr('y', yPos + bandH / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', theme.fg)
      .style('font-size', '11px')
      .text(String(d.goals + d.assists));
  }

  // Axes
  const yAxisG = inner.append('g').call(axisLeft(y));
  yAxisG.selectAll('text').attr('fill', theme.fg);
  yAxisG.selectAll('path,line').attr('stroke', theme.border);

  const xAxisG = inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(axisBottom(x).ticks(5).tickFormat((d) => String(d)));
  xAxisG.selectAll('text').attr('fill', theme.fg);
  xAxisG.selectAll('path,line').attr('stroke', theme.border);

  // Axis label (x)
  svg
    .append('text')
    .attr('x', opts.margin.left + innerWidth / 2)
    .attr('y', opts.height - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Points (goals + assists)');

  // Legend (top-right)
  const legend = svg.append('g').attr('transform', `translate(${opts.margin.left},12)`);
  const items: ReadonlyArray<{ label: string; color: string }> = [
    { label: 'Goals', color: opts.goalColor },
    { label: 'Assists', color: opts.assistColor },
  ];
  let lx = 0;
  for (const item of items) {
    const g = legend.append('g').attr('transform', `translate(${lx},0)`);
    g.append('rect').attr('width', 12).attr('height', 12).attr('fill', item.color);
    const label = g
      .append('text')
      .attr('x', 16)
      .attr('y', 10)
      .attr('fill', theme.fg)
      .text(item.label);
    const node = label.node();
    const w = node ? node.getComputedTextLength() : item.label.length * 7;
    lx += 16 + w + 16;
  }

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
