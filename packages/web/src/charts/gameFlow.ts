import { scaleLinear } from 'd3-scale';
import { curveStepAfter, line } from 'd3-shape';
import { readTheme } from './internal/svg.js';

export interface GameFlowData {
  homeTeam: string;
  awayTeam: string;
  periods: Array<{ period: number; homeGoals: number; awayGoals: number }>;
}

interface SeriesPoint {
  period: number;
  goals: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 600;
const HEIGHT = 300;
const MARGIN = { top: 48, right: 24, bottom: 48, left: 52 };
const AWAY_COLOR = '#4ecdc4';

function homeColor(): string {
  if (typeof window === 'undefined') return '#e94560';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return accent || '#e94560';
}

function svgEl(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag);
}

function setAttrs(node: SVGElement, attrs: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
}

function appendSvgText(
  parent: SVGElement,
  attrs: Record<string, string | number>,
  text: string,
): SVGTextElement {
  const node = svgEl('text') as SVGTextElement;
  setAttrs(node, attrs);
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function buildSeries(
  periods: GameFlowData['periods'],
  key: 'homeGoals' | 'awayGoals',
): SeriesPoint[] {
  const series: SeriesPoint[] = [{ period: 0, goals: 0 }];
  let runningGoals = 0;
  for (const period of periods) {
    runningGoals += period[key];
    series.push({ period: period.period, goals: runningGoals });
  }
  return series;
}

function buildGoalTicks(maxGoals: number): number[] {
  const top = Math.max(1, maxGoals);
  const step = Math.max(1, Math.ceil(top / 5));
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return ticks;
}

function renderLegend(svg: SVGSVGElement, homeTeam: string, awayTeam: string, homeStroke: string): void {
  const legend = svgEl('g');
  setAttrs(legend, { transform: `translate(${MARGIN.left},20)` });
  svg.appendChild(legend);

  const entries = [
    { name: homeTeam, color: homeStroke, x: 0 },
    { name: awayTeam, color: AWAY_COLOR, x: 176 },
  ];

  for (const entry of entries) {
    const group = svgEl('g');
    setAttrs(group, { transform: `translate(${entry.x},0)` });

    const sample = svgEl('line');
    setAttrs(sample, {
      x1: 0,
      y1: 0,
      x2: 20,
      y2: 0,
      stroke: entry.color,
      'stroke-width': 3,
      'stroke-linecap': 'round',
    });
    group.appendChild(sample);

    appendSvgText(
      group,
      {
        x: 28,
        y: 4,
        fill: readTheme().fg,
        'font-size': 12,
      },
      entry.name,
    );

    legend.appendChild(group);
  }
}

function renderAxisLine(parent: SVGElement, attrs: Record<string, string | number>): void {
  const node = svgEl('line');
  setAttrs(node, attrs);
  parent.appendChild(node);
}

export function renderGameFlow(container: HTMLElement, data: GameFlowData): void {
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!data.periods?.length) {
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = 'No period data available';
    container.appendChild(message);
    return;
  }

  const theme = readTheme();
  const homeStroke = homeColor();
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxPeriod = Math.max(...data.periods.map((period) => period.period), 1);
  const homeSeries = buildSeries(data.periods, 'homeGoals');
  const awaySeries = buildSeries(data.periods, 'awayGoals');
  const maxGoals = Math.max(
    homeSeries[homeSeries.length - 1]?.goals ?? 0,
    awaySeries[awaySeries.length - 1]?.goals ?? 0,
    1,
  );

  const x = scaleLinear().domain([0, maxPeriod]).range([MARGIN.left, MARGIN.left + innerWidth]);
  const y = scaleLinear().domain([0, maxGoals]).nice().range([MARGIN.top + innerHeight, MARGIN.top]);

  const svg = svgEl('svg') as SVGSVGElement;
  setAttrs(svg, {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: '100%',
    role: 'img',
    'aria-label': `Game flow for ${data.awayTeam} at ${data.homeTeam}`,
    style: 'display:block;max-width:100%;height:auto;font-family:inherit',
  });
  container.appendChild(svg);

  const title = svgEl('title');
  title.textContent = `Game flow for ${data.awayTeam} at ${data.homeTeam}`;
  svg.appendChild(title);

  renderLegend(svg, data.homeTeam, data.awayTeam, homeStroke);

  const plot = svgEl('g');
  svg.appendChild(plot);

  for (const goalTick of buildGoalTicks(Math.ceil(y.domain()[1] ?? maxGoals))) {
    const yPos = y(goalTick);
    renderAxisLine(plot, {
      x1: MARGIN.left,
      y1: yPos,
      x2: MARGIN.left + innerWidth,
      y2: yPos,
      stroke: theme.border,
      'stroke-width': 1,
    });
    appendSvgText(
      plot,
      {
        x: MARGIN.left - 10,
        y: yPos + 4,
        'text-anchor': 'end',
        fill: theme.muted,
        'font-size': 11,
      },
      String(goalTick),
    );
  }

  renderAxisLine(plot, {
    x1: MARGIN.left,
    y1: MARGIN.top,
    x2: MARGIN.left,
    y2: MARGIN.top + innerHeight,
    stroke: theme.fg,
    'stroke-width': 1,
  });
  renderAxisLine(plot, {
    x1: MARGIN.left,
    y1: MARGIN.top + innerHeight,
    x2: MARGIN.left + innerWidth,
    y2: MARGIN.top + innerHeight,
    stroke: theme.fg,
    'stroke-width': 1,
  });

  for (let period = 1; period <= maxPeriod; period += 1) {
    const xPos = x(period);
    renderAxisLine(plot, {
      x1: xPos,
      y1: MARGIN.top + innerHeight,
      x2: xPos,
      y2: MARGIN.top + innerHeight + 6,
      stroke: theme.fg,
      'stroke-width': 1,
    });
    appendSvgText(
      plot,
      {
        x: xPos,
        y: MARGIN.top + innerHeight + 20,
        'text-anchor': 'middle',
        fill: theme.muted,
        'font-size': 11,
      },
      String(period),
    );
  }

  const lineGenerator = line<SeriesPoint>()
    .x((point) => x(point.period))
    .y((point) => y(point.goals))
    .curve(curveStepAfter);

  const series = [
    { name: data.homeTeam, color: homeStroke, points: homeSeries, key: 'home' },
    { name: data.awayTeam, color: AWAY_COLOR, points: awaySeries, key: 'away' },
  ] as const;

  for (const entry of series) {
    const path = svgEl('path');
    setAttrs(path, {
      d: lineGenerator(entry.points) ?? '',
      fill: 'none',
      stroke: entry.color,
      'stroke-width': 3,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      class: `game-flow-line game-flow-line--${entry.key}`,
    });
    plot.appendChild(path);

    for (const point of entry.points) {
      const circle = svgEl('circle');
      setAttrs(circle, {
        cx: x(point.period),
        cy: y(point.goals),
        r: 4,
        fill: entry.color,
        class: `game-flow-point game-flow-point--${entry.key}`,
        'data-period': point.period,
      });
      plot.appendChild(circle);
    }
  }

  appendSvgText(
    svg,
    {
      x: MARGIN.left + innerWidth / 2,
      y: HEIGHT - 10,
      'text-anchor': 'middle',
      fill: theme.muted,
      'font-size': 12,
    },
    'Period',
  );
  appendSvgText(
    svg,
    {
      x: 18,
      y: MARGIN.top + innerHeight / 2,
      transform: `rotate(-90 18 ${MARGIN.top + innerHeight / 2})`,
      'text-anchor': 'middle',
      fill: theme.muted,
      'font-size': 12,
    },
    'Goals',
  );
}
