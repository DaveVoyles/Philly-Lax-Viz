// Line chart: date on x, points on y, dots at each game.

import { axisBottom, axisLeft } from 'd3-axis';
import { extent, max } from 'd3-array';
import { scaleLinear, scaleTime } from 'd3-scale';
import { line as d3line, curveMonotoneX } from 'd3-shape';
import { timeFormat } from 'd3-time-format';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type {
  ChartHandle,
  PerGameTrendDatum,
  PerGameTrendOptions,
} from './types.js';

const DEFAULTS: PerGameTrendOptions = {
  width: 640,
  height: 280,
  margin: { top: 24, right: 24, bottom: 48, left: 40 },
  lineColor: '#2563eb',
  dotColor: '#1d4ed8',
};

interface Point {
  date: Date;
  points: number;
  iso: string;
}

export function renderPerGameTrend(
  el: HTMLElement,
  data: ReadonlyArray<PerGameTrendDatum>,
  options?: Partial<PerGameTrendOptions>,
): ChartHandle {
  const opts: PerGameTrendOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    el,
    opts.width,
    opts.height,
    opts.margin,
  );

  const points: Point[] = data
    .map((d) => ({ date: new Date(`${d.date}T00:00:00`), points: d.points, iso: d.date }))
    .filter((p) => !Number.isNaN(p.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (points.length === 0) {
    inner
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.muted)
      .text('No games yet');
    return {
      destroy() {
        while (el.firstChild) el.removeChild(el.firstChild);
      },
    };
  }

  const [d0, d1] = extent(points, (p) => p.date) as [Date, Date];
  const x = scaleTime()
    .domain(points.length === 1 ? [new Date(d0.getTime() - 86400000), new Date(d0.getTime() + 86400000)] : [d0, d1])
    .range([0, innerWidth]);

  const yMax = max(points, (p) => p.points) ?? 0;
  const y = scaleLinear()
    .domain([0, Math.max(1, yMax)])
    .nice()
    .range([innerHeight, 0]);

  const lineGen = d3line<Point>()
    .x((p) => x(p.date))
    .y((p) => y(p.points))
    .curve(curveMonotoneX);

  const path = lineGen(points);
  if (path !== null) {
    inner
      .append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', opts.lineColor)
      .attr('stroke-width', 2);
  }

  for (const p of points) {
    inner
      .append('circle')
      .attr('cx', x(p.date))
      .attr('cy', y(p.points))
      .attr('r', 3.5)
      .attr('fill', opts.dotColor)
      .append('title')
      .text(`${p.iso}: ${p.points} pt${p.points === 1 ? '' : 's'}`);
  }

  // Axes
  const fmt = timeFormat('%b %d');
  const xAxisG = inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      axisBottom<Date>(x)
        .ticks(Math.min(6, Math.max(2, points.length)))
        .tickFormat((d) => fmt(d as Date)),
    );
  xAxisG.selectAll('text').attr('fill', theme.fg);
  xAxisG.selectAll('path,line').attr('stroke', theme.border);

  const yAxisG = inner.append('g').call(axisLeft(y).ticks(5).tickFormat((d) => String(d)));
  yAxisG.selectAll('text').attr('fill', theme.fg);
  yAxisG.selectAll('path,line').attr('stroke', theme.border);

  // Axis labels
  svg
    .append('text')
    .attr('x', opts.margin.left + innerWidth / 2)
    .attr('y', opts.height - 8)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Date');

  svg
    .append('text')
    .attr('transform', `translate(12,${opts.margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Points');

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
