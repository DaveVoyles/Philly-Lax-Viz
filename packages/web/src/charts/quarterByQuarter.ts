// Grouped bar chart: x = period (Q1..Q4 + OTs), y = goals, two side-by-side
// series for away and home. Consumes the `periods` payload from
// `/api/games/:id` plus the two team names + ids.

import { axisBottom, axisLeft } from 'd3-axis';
import { max } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import { createResponsiveSvg, periodLabel, readTheme } from './internal/svg.js';
import type {
  ChartHandle,
  QuarterByQuarterDatum,
  QuarterByQuarterOptions,
} from './types.js';

const DEFAULTS: QuarterByQuarterOptions = {
  width: 640,
  height: 320,
  margin: { top: 32, right: 16, bottom: 56, left: 48 },
  awayColor: '#f97316',
  homeColor: '#2563eb',
};

export function renderQuarterByQuarter(
  el: HTMLElement,
  data: QuarterByQuarterDatum,
  options?: Partial<QuarterByQuarterOptions>,
): ChartHandle {
  const opts: QuarterByQuarterOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  // Collect distinct period numbers and aggregate goals per (period, team).
  const periodSet = new Set<number>();
  for (const p of data.periods) periodSet.add(p.periodNumber);
  // Always show Q1..Q4 even if missing.
  for (let i = 1; i <= 4; i += 1) periodSet.add(i);
  const periodNums = [...periodSet].sort((a, b) => a - b);

  const lookup = new Map<string, number>();
  for (const p of data.periods) {
    lookup.set(`${p.teamId}|${p.periodNumber}`, p.goals);
  }

  const teams: ReadonlyArray<{ id: number; name: string; color: string; key: 'away' | 'home' }> = [
    { id: data.awayTeamId, name: data.awayTeamName, color: opts.awayColor, key: 'away' },
    { id: data.homeTeamId, name: data.homeTeamName, color: opts.homeColor, key: 'home' },
  ];

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    el,
    opts.width,
    opts.height,
    opts.margin,
  );

  const x0 = scaleBand<number>()
    .domain(periodNums)
    .range([0, innerWidth])
    .paddingInner(0.2)
    .paddingOuter(0.1);

  const x1 = scaleBand<string>()
    .domain(teams.map((t) => t.key))
    .range([0, x0.bandwidth()])
    .padding(0.05);

  const yMax =
    max(periodNums, (pn) =>
      max(teams, (t) => lookup.get(`${t.id}|${pn}`) ?? 0) ?? 0,
    ) ?? 0;

  const y = scaleLinear()
    .domain([0, Math.max(1, yMax)])
    .nice()
    .range([innerHeight, 0]);

  // Bars
  for (const pn of periodNums) {
    const groupX = x0(pn) ?? 0;
    for (const team of teams) {
      const goals = lookup.get(`${team.id}|${pn}`) ?? 0;
      const bx = x1(team.key) ?? 0;
      inner
        .append('rect')
        .attr('x', groupX + bx)
        .attr('y', y(goals))
        .attr('width', x1.bandwidth())
        .attr('height', innerHeight - y(goals))
        .attr('fill', team.color)
        .append('title')
        .text(`${team.name} ${periodLabel(pn)}: ${goals}`);
    }
  }

  // Axes
  const xAxisG = inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(axisBottom(x0).tickFormat((d) => periodLabel(d)));
  xAxisG.selectAll('text').attr('fill', theme.fg);
  xAxisG.selectAll('path,line').attr('stroke', theme.border);

  const yAxisG = inner.call(axisLeft(y).ticks(5).tickFormat((d) => String(d)));
  yAxisG.selectAll('text').attr('fill', theme.fg);
  yAxisG.selectAll('path,line').attr('stroke', theme.border);

  // Axis labels
  svg
    .append('text')
    .attr('x', opts.margin.left + innerWidth / 2)
    .attr('y', opts.height - 14)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Period');

  svg
    .append('text')
    .attr('transform', `translate(14,${opts.margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Goals');

  // Legend (top)
  const legend = svg
    .append('g')
    .attr('transform', `translate(${opts.margin.left},12)`);
  let lx = 0;
  for (const team of teams) {
    const g = legend.append('g').attr('transform', `translate(${lx},0)`);
    g.append('rect').attr('width', 12).attr('height', 12).attr('fill', team.color);
    const label = g
      .append('text')
      .attr('x', 16)
      .attr('y', 10)
      .attr('fill', theme.fg)
      .text(team.name);
    const node = label.node();
    const w = node ? node.getComputedTextLength() : team.name.length * 7;
    lx += 16 + w + 16;
  }

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
