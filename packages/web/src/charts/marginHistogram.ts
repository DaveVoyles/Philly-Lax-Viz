import { max } from 'd3-array';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleBand, scaleLinear } from 'd3-scale';
import { select } from 'd3-selection';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type { ChartHandle } from './types.js';

export interface MarginDatum {
  margin: number;
}

interface MarginBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

const BUCKETS: ReadonlyArray<Omit<MarginBucket, 'count'>> = [
  { label: '1-3', min: 1, max: 3 },
  { label: '4-6', min: 4, max: 6 },
  { label: '7-10', min: 7, max: 10 },
  { label: '11-15', min: 11, max: 15 },
  { label: '16+', min: 16, max: Number.POSITIVE_INFINITY },
];

const BAR_COLOR = '#3b82f6';
const BAR_HOVER_COLOR = '#60a5fa';

export function buildMarginBuckets(games: ReadonlyArray<MarginDatum>): MarginBucket[] {
  return BUCKETS.map((bucket) => ({
    ...bucket,
    count: games.filter((game) => game.margin >= bucket.min && game.margin <= bucket.max).length,
  }));
}

export function renderMarginHistogram(
  container: HTMLElement,
  games: ReadonlyArray<MarginDatum>,
): ChartHandle {
  const width = Math.max(container.clientWidth || 400, 300);
  const height = 180;
  const chartMargin = { top: 36, right: 16, bottom: 40, left: 36 };
  const theme = readTheme();
  const buckets = buildMarginBuckets(games);
  const yMax = Math.max(max(buckets, (bucket) => bucket.count) ?? 0, 1);

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    container,
    width,
    height,
    chartMargin,
  );

  svg.attr('aria-label', 'Score margin distribution histogram');
  svg
    .append('text')
    .attr('x', chartMargin.left)
    .attr('y', 18)
    .attr('fill', theme.fg)
    .style('font-size', '14px')
    .style('font-weight', '600')
    .text('Score Margins');

  const x = scaleBand<string>()
    .domain(buckets.map((bucket) => bucket.label))
    .range([0, innerWidth])
    .padding(0.24);

  const y = scaleLinear()
    .domain([0, yMax])
    .nice()
    .range([innerHeight, 0]);

  inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(axisBottom(x).tickSizeOuter(0))
    .call((axis) => axis.selectAll('text').attr('fill', theme.muted))
    .call((axis) => axis.selectAll('path,line').attr('stroke', theme.border));

  inner
    .append('g')
    .call(axisLeft(y).ticks(Math.min(4, yMax)).tickFormat((value) => String(Math.round(Number(value)))))
    .call((axis) => axis.selectAll('text').attr('fill', theme.muted))
    .call((axis) => axis.selectAll('path,line').attr('stroke', theme.border));

  inner
    .append('text')
    .attr('x', innerWidth)
    .attr('y', -10)
    .attr('text-anchor', 'end')
    .attr('fill', theme.muted)
    .style('font-size', '12px')
    .text(`${games.length} game${games.length === 1 ? '' : 's'}`);

  const bars = inner
    .selectAll<SVGRectElement, MarginBucket>('rect.margin-bar')
    .data(buckets)
    .enter()
    .append('rect')
    .attr('class', 'margin-bar')
    .attr('x', (bucket) => x(bucket.label) ?? 0)
    .attr('y', (bucket) => y(bucket.count))
    .attr('width', x.bandwidth())
    .attr('height', (bucket) => innerHeight - y(bucket.count))
    .attr('rx', 4)
    .attr('fill', BAR_COLOR);

  bars
    .append('title')
    .text((bucket) => `${bucket.label} goals: ${bucket.count} game${bucket.count === 1 ? '' : 's'}`);

  bars
    .on('mouseenter', function mouseenter() {
      select(this).attr('fill', BAR_HOVER_COLOR);
    })
    .on('mouseleave', function mouseleave() {
      select(this).attr('fill', BAR_COLOR);
    });

  inner
    .selectAll<SVGTextElement, MarginBucket>('text.margin-count')
    .data(buckets)
    .enter()
    .append('text')
    .attr('class', 'margin-count')
    .attr('x', (bucket) => (x(bucket.label) ?? 0) + x.bandwidth() / 2)
    .attr('y', (bucket) => Math.max(y(bucket.count) - 6, 10))
    .attr('text-anchor', 'middle')
    .attr('fill', theme.fg)
    .style('font-size', '12px')
    .style('font-weight', '600')
    .text((bucket) => String(bucket.count));

  return {
    destroy() {
      while (container.firstChild) container.removeChild(container.firstChild);
    },
  };
}
