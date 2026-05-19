import { max, min } from 'd3-array';
import { scaleLinear, scalePoint } from 'd3-scale';
import { curveMonotoneX, line as d3Line } from 'd3-shape';
import { timeFormat } from 'd3-time-format';
import { navigate } from '../router.js';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type { ChartHandle, SeasonArcDatum, SeasonArcOptions } from './types.js';

const DEFAULTS: SeasonArcOptions = {
  width: 640,
  height: 140,
  margin: { top: 20, right: 20, bottom: 32, left: 44 },
  winColor: '#16a34a',
  lossColor: '#dc2626',
  tieColor: '#9ca3af',
  lineColor: '#2563eb',
  nodeRadius: 10,
};

interface ArcPoint extends SeasonArcDatum {
  index: number;
  momentum: number;
  goalDiff: number;
}

const formatTooltipDate = timeFormat('%b %d, %Y');

export function renderSeasonArc(
  el: HTMLElement,
  data: ReadonlyArray<SeasonArcDatum>,
  options?: Partial<SeasonArcOptions>,
): ChartHandle {
  const opts: SeasonArcOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  el.style.position = 'relative';

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    el,
    opts.width,
    opts.height,
    opts.margin,
  );
  svg.attr('aria-label', 'Season momentum timeline');

  const tooltip = document.createElement('div');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'pointer-events:none',
    'opacity:0',
    'transform:translate(-9999px,-9999px)',
    'transition:opacity 120ms ease',
    `background:${theme.bg}`,
    `color:${theme.fg}`,
    `border:1px solid ${theme.border}`,
    'border-radius:8px',
    'padding:0.5rem 0.65rem',
    'font-size:0.8rem',
    'line-height:1.35',
    'box-shadow:0 8px 20px rgba(15, 23, 42, 0.12)',
    'white-space:nowrap',
    'z-index:2',
  ].join(';');
  el.appendChild(tooltip);

  const parsed = data
    .map((d) => ({
      ...d,
      parsedDate: new Date(`${d.date}T00:00:00`),
    }))
    .filter((d) => !Number.isNaN(d.parsedDate.getTime()))
    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime() || a.gameId - b.gameId);

  let runningMomentum = 0;
  const points: ArcPoint[] = parsed.map((d, index) => {
    if (d.result === 'win') runningMomentum += 1;
    else if (d.result === 'loss') runningMomentum -= 1;

    return {
      gameId: d.gameId,
      date: d.date,
      opponent: d.opponent,
      result: d.result,
      goalsFor: d.goalsFor,
      goalsAgainst: d.goalsAgainst,
      index,
      momentum: runningMomentum,
      goalDiff: Math.abs(d.goalsFor - d.goalsAgainst),
    };
  });

  if (points.length === 0) {
    inner
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.muted)
      .text('No completed games');
    return {
      destroy() {
        tooltip.remove();
        while (el.firstChild) el.removeChild(el.firstChild);
      },
    };
  }

  const x = scalePoint<number>()
    .domain(points.map((p) => p.index))
    .range([0, innerWidth])
    .padding(points.length === 1 ? 0 : 0.5);

  const minMomentum = min(points, (p) => p.momentum) ?? 0;
  const maxMomentum = max(points, (p) => p.momentum) ?? 0;
  const yPadding = 0.75;
  const y = scaleLinear()
    .domain([Math.min(minMomentum, 0) - yPadding, Math.max(maxMomentum, 0) + yPadding])
    .range([innerHeight, 0]);

  const maxDiff = max(points, (p) => p.goalDiff) ?? 0;
  const radiusScale = scaleLinear()
    .domain([0, Math.max(1, maxDiff)])
    .range([4, Math.max(4, Math.min(10, opts.nodeRadius))]);

  const baselineY = y(0);
  inner
    .append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', baselineY)
    .attr('y2', baselineY)
    .attr('stroke', theme.border)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 4');

  const yAxisLine = inner
    .append('line')
    .attr('x1', 0)
    .attr('x2', 0)
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', theme.border)
    .attr('stroke-width', 1);
  void yAxisLine;

  const lineGen = d3Line<ArcPoint>()
    .x((p) => x(p.index) ?? 0)
    .y((p) => y(p.momentum))
    .curve(curveMonotoneX);

  const path = lineGen(points);
  if (path !== null) {
    inner
      .append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', opts.lineColor || theme.accent)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');
  }

  const yTicks = Array.from(new Set([minMomentum, 0, maxMomentum])).sort((a, b) => a - b);
  for (const tick of yTicks) {
    inner
      .append('text')
      .attr('x', -8)
      .attr('y', y(tick))
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', tick === 0 ? theme.fg : theme.muted)
      .style('font-size', '11px')
      .text(tick > 0 ? `+${tick}` : String(tick));
  }

  svg
    .append('text')
    .attr('x', opts.margin.left + innerWidth / 2)
    .attr('y', opts.height - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Games');

  svg
    .append('text')
    .attr('transform', `translate(14,${opts.margin.top + innerHeight / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', theme.muted)
    .text('Momentum');

  const showTooltip = (event: MouseEvent, point: ArcPoint): void => {
    const parsedDate = new Date(`${point.date}T00:00:00`);
    const dateLabel = Number.isNaN(parsedDate.getTime()) ? point.date : formatTooltipDate(parsedDate);
    tooltip.innerHTML = `<strong>${dateLabel}</strong><br>${point.opponent}<br>${point.goalsFor}-${point.goalsAgainst}`;
    tooltip.style.opacity = '1';
    tooltip.setAttribute('aria-hidden', 'false');
    positionTooltip(event);
  };

  const hideTooltip = (): void => {
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translate(-9999px,-9999px)';
    tooltip.setAttribute('aria-hidden', 'true');
  };

  const positionTooltip = (event: MouseEvent): void => {
    const rect = el.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const offset = 12;
    const maxLeft = Math.max(0, rect.width - tooltipRect.width);
    const maxTop = Math.max(0, rect.height - tooltipRect.height);
    const left = Math.min(Math.max(0, event.clientX - rect.left + offset), maxLeft);
    const top = Math.min(Math.max(0, event.clientY - rect.top - tooltipRect.height - offset), maxTop);
    tooltip.style.transform = `translate(${left}px, ${top}px)`;
  };

  const nodes: Array<SVGCircleElement> = [];
  for (const point of points) {
    const fill =
      point.result === 'win' ? opts.winColor : point.result === 'loss' ? opts.lossColor : opts.tieColor;
    const circleSel = inner
      .append('circle')
      .attr('cx', x(point.index) ?? 0)
      .attr('cy', y(point.momentum))
      .attr('r', radiusScale(point.goalDiff))
      .attr('fill', fill)
      .attr('stroke', theme.bg)
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .style('opacity', '0')
      .style('transition', 'opacity 220ms ease')
      .style('transition-delay', `${point.index * 50}ms`);
    circleSel.append('title').text(`${point.opponent}: ${point.goalsFor}-${point.goalsAgainst}`);
    const circle = circleSel.node();

    if (!circle) continue;
    nodes.push(circle);
    circle.addEventListener('mouseenter', (event) => showTooltip(event, point));
    circle.addEventListener('mousemove', positionTooltip);
    circle.addEventListener('mouseleave', hideTooltip);
    circle.addEventListener('focus', () => {
      const fauxEvent = new MouseEvent('mousemove', {
        clientX: el.getBoundingClientRect().left + (x(point.index) ?? 0),
        clientY: el.getBoundingClientRect().top + y(point.momentum),
      });
      showTooltip(fauxEvent, point);
    });
    circle.addEventListener('blur', hideTooltip);
    circle.addEventListener('click', () => navigate(`/games/${point.gameId}`));
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('role', 'link');
    circle.setAttribute('aria-label', `${point.opponent} ${point.goalsFor}-${point.goalsAgainst}`);
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate(`/games/${point.gameId}`);
      }
    });
  }

  window.requestAnimationFrame(() => {
    for (const node of nodes) node.style.opacity = '1';
  });

  return {
    destroy() {
      hideTooltip();
      tooltip.remove();
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
