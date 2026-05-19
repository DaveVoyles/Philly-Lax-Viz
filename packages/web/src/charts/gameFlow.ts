import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear } from 'd3-scale';
import { line, curveStepAfter } from 'd3-shape';
import { createResponsiveSvg, periodLabel, readTheme } from './internal/svg.js';

export interface Period {
  gameId: number;
  teamId: number;
  periodNumber: number;
  goals: number;
}

interface TeamRef {
  id: number;
  name: string;
}

interface Point {
  x: number;
  goals: number;
}

const HOME_COLOR = '#2563eb';
const AWAY_COLOR = '#f97316';
const HEIGHT = 200;
const MARGIN = { top: 16, right: 128, bottom: 40, left: 40 };

function getMaxPeriod(periods: readonly Period[]): number {
  return Math.max(
    4,
    ...periods.map((period) => period.periodNumber),
  );
}

function buildCumulativeSeries(
  periods: readonly Period[],
  teamId: number,
  maxPeriod: number,
): Point[] {
  const totalsByPeriod = new Map<number, number>();
  for (const period of periods) {
    if (period.teamId !== teamId) continue;
    totalsByPeriod.set(
      period.periodNumber,
      (totalsByPeriod.get(period.periodNumber) ?? 0) + period.goals,
    );
  }

  const points: Point[] = [{ x: 0, goals: 0 }];
  let runningTotal = 0;
  for (let periodNumber = 1; periodNumber <= maxPeriod; periodNumber += 1) {
    runningTotal += totalsByPeriod.get(periodNumber) ?? 0;
    points.push({ x: periodNumber, goals: runningTotal });
  }

  return points;
}

function tickLabel(periodNumber: number): string {
  if (periodNumber === 0) return 'Start';
  return periodLabel(periodNumber);
}

export function renderGameFlow(
  container: HTMLElement,
  periods: Period[],
  homeTeam: TeamRef,
  awayTeam: TeamRef,
): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  if (periods.length === 0) return;

  const heading = document.createElement('h2');
  heading.textContent = 'Game Flow';
  container.appendChild(heading);

  const chartHost = document.createElement('div');
  chartHost.className = 'chart-slot';
  chartHost.dataset['chart'] = 'gameFlow';
  container.appendChild(chartHost);

  const theme = readTheme();
  const width = Math.max(container.clientWidth || 0, 320);
  const maxPeriod = getMaxPeriod(periods);
  const homeSeries = buildCumulativeSeries(periods, homeTeam.id, maxPeriod);
  const awaySeries = buildCumulativeSeries(periods, awayTeam.id, maxPeriod);
  const homeFinal = homeSeries[homeSeries.length - 1]?.goals ?? 0;
  const awayFinal = awaySeries[awaySeries.length - 1]?.goals ?? 0;
  const maxGoals = Math.max(homeFinal, awayFinal);

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    chartHost,
    width,
    HEIGHT,
    MARGIN,
  );

  svg.attr('aria-label', `Game flow: ${awayTeam.name} ${awayFinal}, ${homeTeam.name} ${homeFinal}`);
  svg.append('title').text(`Game flow: ${awayTeam.name} ${awayFinal}, ${homeTeam.name} ${homeFinal}`);

  const x = scaleLinear().domain([0, maxPeriod]).range([0, innerWidth]);
  const y = scaleLinear()
    .domain([0, Math.max(1, maxGoals + 1)])
    .range([innerHeight, 0]);

  for (let boundary = 1; boundary < maxPeriod; boundary += 1) {
    inner
      .append('line')
      .attr('x1', x(boundary))
      .attr('x2', x(boundary))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', theme.border)
      .attr('stroke-dasharray', '4 4');
  }

  const lineGenerator = line<Point>()
    .x((point) => x(point.x))
    .y((point) => y(point.goals))
    .curve(curveStepAfter);

  inner
    .append('path')
    .attr('d', lineGenerator(homeSeries) ?? '')
    .attr('fill', 'none')
    .attr('stroke', HOME_COLOR)
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');

  inner
    .append('path')
    .attr('d', lineGenerator(awaySeries) ?? '')
    .attr('fill', 'none')
    .attr('stroke', AWAY_COLOR)
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');

  const finalLabels = [
    { team: homeTeam, score: homeFinal, color: HOME_COLOR, yOffset: homeFinal === awayFinal ? -10 : 0 },
    { team: awayTeam, score: awayFinal, color: AWAY_COLOR, yOffset: homeFinal === awayFinal ? 12 : 0 },
  ];

  for (const label of finalLabels) {
    inner
      .append('text')
      .attr('x', x(maxPeriod) + 8)
      .attr('y', y(label.score) + label.yOffset)
      .attr('dy', '0.32em')
      .attr('fill', label.color)
      .style('font-size', '12px')
      .style('font-weight', '600')
      .text(`${label.team.name} ${label.score}`);
  }

  const xAxis = inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      axisBottom(x)
        .tickValues(Array.from({ length: maxPeriod + 1 }, (_, index) => index))
        .tickFormat((value) => tickLabel(Number(value))),
    );
  xAxis.selectAll('text').attr('fill', theme.fg);
  xAxis.selectAll('path,line').attr('stroke', theme.border);

  const yAxis = inner
    .append('g')
    .call(
      axisLeft(y)
        .ticks(Math.min(6, maxGoals + 1))
        .tickFormat((value) => String(Math.round(Number(value)))),
    );
  yAxis.selectAll('text').attr('fill', theme.fg);
  yAxis.selectAll('path,line').attr('stroke', theme.border);

  svg
    .append('text')
    .attr('x', MARGIN.left + innerWidth / 2)
    .attr('y', HEIGHT - 8)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Period');

  svg
    .append('text')
    .attr('transform', `translate(14,${MARGIN.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Cumulative Goals');
}
