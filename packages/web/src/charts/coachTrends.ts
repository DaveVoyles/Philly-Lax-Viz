import { scaleLinear, scaleTime } from 'd3-scale';
import { line } from 'd3-shape';
import type { TrendPoint } from '../api.js';
import { readTheme } from './internal/svg.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 720;
const HEIGHT = 200;
const MARGIN = { top: 24, right: 20, bottom: 36, left: 40 };
const GOALS_FOR_COLOR = '#38bdf8';
const GOALS_AGAINST_COLOR = '#f87171';

function svgEl(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag);
}

function setAttrs(node: SVGElement, attrs: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
}

function appendText(parent: SVGElement, attrs: Record<string, string | number>, text: string): SVGTextElement {
  const node = svgEl('text') as SVGTextElement;
  setAttrs(node, attrs);
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function tooltipText(point: TrendPoint): string {
  return `${point.opponent}: ${point.goalsFor}-${point.goalsAgainst}`;
}

export function renderCoachTrendsChart(host: HTMLElement, data: TrendPoint[]): void {
  host.replaceChildren();

  if (!data.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No trend data available.';
    host.appendChild(empty);
    return;
  }

  const parsed = data
    .map((point) => ({ ...point, dateValue: new Date(`${point.date}T00:00:00`) }))
    .filter((point) => !Number.isNaN(point.dateValue.getTime()));

  if (!parsed.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No trend data available.';
    host.appendChild(empty);
    return;
  }

  const theme = readTheme();
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const dateValues = parsed.map((point) => point.dateValue.getTime());
  const minTime = Math.min(...dateValues);
  const maxTime = Math.max(...dateValues);
  const xDomain = minTime === maxTime
    ? [new Date(minTime - 86400000), new Date(maxTime + 86400000)]
    : [new Date(minTime), new Date(maxTime)];
  const maxGoals = Math.max(
    1,
    ...parsed.map((point) => Math.max(point.goalsFor, point.goalsAgainst)),
  );

  const x = scaleTime().domain(xDomain).range([MARGIN.left, MARGIN.left + innerWidth]);
  const y = scaleLinear().domain([0, maxGoals]).nice().range([MARGIN.top + innerHeight, MARGIN.top]);

  const svg = svgEl('svg') as SVGSVGElement;
  setAttrs(svg, {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: '100%',
    role: 'img',
    'aria-label': 'Performance trends line chart',
    style: 'display:block;max-width:100%;height:auto;font-family:inherit',
  });
  host.appendChild(svg);

  const plot = svgEl('g');
  svg.appendChild(plot);

  for (const tick of y.ticks(4)) {
    const yPos = y(tick);
    const grid = svgEl('line');
    setAttrs(grid, {
      x1: MARGIN.left,
      y1: yPos,
      x2: MARGIN.left + innerWidth,
      y2: yPos,
      stroke: theme.border,
      'stroke-width': 1,
    });
    plot.appendChild(grid);
    appendText(plot, {
      x: MARGIN.left - 8,
      y: yPos + 4,
      'text-anchor': 'end',
      fill: theme.muted,
      'font-size': 11,
    }, String(tick));
  }

  const yAxis = svgEl('line');
  setAttrs(yAxis, {
    x1: MARGIN.left,
    y1: MARGIN.top,
    x2: MARGIN.left,
    y2: MARGIN.top + innerHeight,
    stroke: theme.fg,
    'stroke-width': 1,
  });
  plot.appendChild(yAxis);

  const xAxis = svgEl('line');
  setAttrs(xAxis, {
    x1: MARGIN.left,
    y1: MARGIN.top + innerHeight,
    x2: MARGIN.left + innerWidth,
    y2: MARGIN.top + innerHeight,
    stroke: theme.fg,
    'stroke-width': 1,
  });
  plot.appendChild(xAxis);

  const xTicks = parsed.length <= 5
    ? parsed.map((point) => point.dateValue)
    : x.ticks(Math.min(5, parsed.length));
  for (const tick of xTicks) {
    const xPos = x(tick);
    const tickLine = svgEl('line');
    setAttrs(tickLine, {
      x1: xPos,
      y1: MARGIN.top + innerHeight,
      x2: xPos,
      y2: MARGIN.top + innerHeight + 6,
      stroke: theme.fg,
      'stroke-width': 1,
    });
    plot.appendChild(tickLine);
    appendText(plot, {
      x: xPos,
      y: MARGIN.top + innerHeight + 20,
      'text-anchor': 'middle',
      fill: theme.muted,
      'font-size': 11,
    }, formatShortDate(tick));
  }

  const lineGenerator = line<(TrendPoint & { dateValue: Date })>()
    .x((point) => x(point.dateValue))
    .y((point) => y(point.goalsFor));
  const againstLineGenerator = line<(TrendPoint & { dateValue: Date })>()
    .x((point) => x(point.dateValue))
    .y((point) => y(point.goalsAgainst));

  const goalsForPath = svgEl('path');
  setAttrs(goalsForPath, {
    d: lineGenerator(parsed) ?? '',
    fill: 'none',
    stroke: GOALS_FOR_COLOR,
    'stroke-width': 3,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  });
  plot.appendChild(goalsForPath);

  const goalsAgainstPath = svgEl('path');
  setAttrs(goalsAgainstPath, {
    d: againstLineGenerator(parsed) ?? '',
    fill: 'none',
    stroke: GOALS_AGAINST_COLOR,
    'stroke-width': 3,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  });
  plot.appendChild(goalsAgainstPath);

  for (const point of parsed) {
    const forDot = svgEl('circle');
    setAttrs(forDot, {
      cx: x(point.dateValue),
      cy: y(point.goalsFor),
      r: 4,
      fill: GOALS_FOR_COLOR,
    });
    const forTitle = svgEl('title');
    forTitle.textContent = `${tooltipText(point)} (GF)`;
    forDot.appendChild(forTitle);
    plot.appendChild(forDot);

    const againstDot = svgEl('circle');
    setAttrs(againstDot, {
      cx: x(point.dateValue),
      cy: y(point.goalsAgainst),
      r: 4,
      fill: GOALS_AGAINST_COLOR,
    });
    const againstTitle = svgEl('title');
    againstTitle.textContent = `${tooltipText(point)} (GA)`;
    againstDot.appendChild(againstTitle);
    plot.appendChild(againstDot);
  }

  const legend = svgEl('g');
  setAttrs(legend, { transform: `translate(${MARGIN.left},12)` });
  svg.appendChild(legend);
  for (const entry of [
    { label: 'Goals For', color: GOALS_FOR_COLOR, x: 0 },
    { label: 'Goals Against', color: GOALS_AGAINST_COLOR, x: 110 },
  ]) {
    const group = svgEl('g');
    setAttrs(group, { transform: `translate(${entry.x},0)` });
    const sample = svgEl('line');
    setAttrs(sample, {
      x1: 0,
      y1: 0,
      x2: 18,
      y2: 0,
      stroke: entry.color,
      'stroke-width': 3,
      'stroke-linecap': 'round',
    });
    group.appendChild(sample);
    appendText(group, {
      x: 24,
      y: 4,
      fill: theme.fg,
      'font-size': 12,
    }, entry.label);
    legend.appendChild(group);
  }
}
