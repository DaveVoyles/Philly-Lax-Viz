// RFC 06 — Game flow chart (cumulative period scoring).
//
// Renders two stepped lines showing each team's running score across the
// game's periods (Q1..Q4 + any OT), plus an optional secondary score-
// difference strip and an a11y narrative summary. Pure TS; no framework.
//
// Public surface:
//   renderGameFlowChart(container, data, options?) -> { destroy() }
//
// Pure helpers exported for unit tests:
//   buildCumulativeSeries, computeMaxPeriod, buildNarrative.

import { line, curveStepAfter, area } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { axisBottom, axisLeft } from 'd3-axis';
import type { GamePeriod } from '@pll/shared';
import { createResponsiveSvg, periodLabel, readTheme } from '../charts/internal/svg.js';
import type { ChartHandle, ChartMargin } from '../charts/types.js';

export interface GameFlowChartData {
  periods: ReadonlyArray<GamePeriod>;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  finalHome: number;
  finalAway: number;
}

export interface GameFlowChartOptions {
  width: number;
  height: number;
  margin: ChartMargin;
  homeColor: string;
  awayColor: string;
  showDifferencePanel: boolean;
}

const DEFAULTS: GameFlowChartOptions = {
  width: 640,
  height: 320,
  margin: { top: 20, right: 96, bottom: 40, left: 40 },
  // Match quarterByQuarter.ts so the two charts read as a matched pair.
  homeColor: '#2563eb',
  awayColor: '#f97316',
  showDifferencePanel: true,
};

export interface CumulativePoint {
  /** x in "periods elapsed": 0 = pre-game, 1 = end of Q1, ... */
  x: number;
  /** cumulative goals through period x */
  goals: number;
}

/** Largest periodNumber present in the data, clamped to a minimum of 4 (regulation). */
export function computeMaxPeriod(periods: ReadonlyArray<GamePeriod>): number {
  let max = 4;
  for (const p of periods) {
    if (p.periodNumber > max) max = p.periodNumber;
  }
  return max;
}

/**
 * Convert per-period goal records into a cumulative running-total series
 * for one team. Missing periods are imputed as 0 goals so the line never
 * skips an x value. Always emits maxPeriod + 1 points (start through end).
 */
export function buildCumulativeSeries(
  periods: ReadonlyArray<GamePeriod>,
  teamId: number,
  maxPeriod: number,
): CumulativePoint[] {
  const byPeriod = new Map<number, number>();
  for (const p of periods) {
    if (p.teamId !== teamId) continue;
    byPeriod.set(p.periodNumber, (byPeriod.get(p.periodNumber) ?? 0) + p.goals);
  }
  const out: CumulativePoint[] = [{ x: 0, goals: 0 }];
  let running = 0;
  for (let i = 1; i <= maxPeriod; i += 1) {
    running += byPeriod.get(i) ?? 0;
    out.push({ x: i, goals: running });
  }
  return out;
}

export interface NarrativeInput {
  homeName: string;
  awayName: string;
  homeSeries: ReadonlyArray<CumulativePoint>;
  awaySeries: ReadonlyArray<CumulativePoint>;
  maxPeriod: number;
}

/**
 * Auto-generate a conservative one-to-three sentence summary of the game
 * flow. Designed for `<desc>` and a sighted narrative paragraph; never
 * editorialises beyond what the cumulative numbers strictly support.
 */
export function buildNarrative(input: NarrativeInput): string {
  const { homeName, awayName, homeSeries, awaySeries, maxPeriod } = input;
  const finalHome = homeSeries[homeSeries.length - 1]?.goals ?? 0;
  const finalAway = awaySeries[awaySeries.length - 1]?.goals ?? 0;
  const parts: string[] = [];

  // Sentence 1 — final.
  if (finalHome === finalAway) {
    parts.push(`Final: ${awayName} ${finalAway}, ${homeName} ${finalHome} (tied).`);
  } else {
    const winner = finalHome > finalAway ? homeName : awayName;
    const margin = Math.abs(finalHome - finalAway);
    parts.push(
      `Final: ${awayName} ${finalAway}, ${homeName} ${finalHome} — ${winner} won by ${margin}.`,
    );
  }

  // Sentence 2 — largest lead.
  let largestLead = 0;
  let largestLeader: string | null = null;
  let largestPeriod = 0;
  for (let i = 1; i <= maxPeriod; i += 1) {
    const h = homeSeries[i]?.goals ?? 0;
    const a = awaySeries[i]?.goals ?? 0;
    const diff = Math.abs(h - a);
    if (diff > largestLead) {
      largestLead = diff;
      largestLeader = h > a ? homeName : awayName;
      largestPeriod = i;
    }
  }
  if (largestLeader && largestLead > 0) {
    parts.push(
      `Largest lead was ${largestLead} for ${largestLeader} after ${periodLabel(largestPeriod)}.`,
    );
  } else if (largestLead === 0) {
    parts.push('The teams were even at every period break.');
  }

  // Sentence 3 — final-period swing (run of 3+ unanswered).
  if (maxPeriod >= 1) {
    const lastIdx = maxPeriod;
    const prevIdx = maxPeriod - 1;
    const homeRun = (homeSeries[lastIdx]?.goals ?? 0) - (homeSeries[prevIdx]?.goals ?? 0);
    const awayRun = (awaySeries[lastIdx]?.goals ?? 0) - (awaySeries[prevIdx]?.goals ?? 0);
    if (homeRun >= 3 && awayRun === 0) {
      parts.push(`${homeName} closed on a ${homeRun}-0 run in ${periodLabel(lastIdx)}.`);
    } else if (awayRun >= 3 && homeRun === 0) {
      parts.push(`${awayName} closed on a ${awayRun}-0 run in ${periodLabel(lastIdx)}.`);
    }
  }

  return parts.join(' ');
}

interface SeriesSpec {
  id: number;
  name: string;
  color: string;
  points: CumulativePoint[];
  isHome: boolean;
}

export function renderGameFlowChart(
  el: HTMLElement,
  data: GameFlowChartData,
  options?: Partial<GameFlowChartOptions>,
): ChartHandle {
  const opts: GameFlowChartOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  while (el.firstChild) el.removeChild(el.firstChild);
  el.classList.add('game-flow-chart');

  const maxPeriod = computeMaxPeriod(data.periods);
  const homePoints = buildCumulativeSeries(data.periods, data.homeTeamId, maxPeriod);
  const awayPoints = buildCumulativeSeries(data.periods, data.awayTeamId, maxPeriod);

  // Reconcile: if no period data, fall back to the box-score finals so the
  // chart still draws *something* meaningful (a single endpoint).
  const homeFinal = homePoints[homePoints.length - 1]?.goals ?? 0;
  const awayFinal = awayPoints[awayPoints.length - 1]?.goals ?? 0;
  const hasPeriodData = data.periods.length > 0;

  const series: SeriesSpec[] = [
    {
      id: data.awayTeamId,
      name: data.awayTeamName,
      color: opts.awayColor,
      points: awayPoints,
      isHome: false,
    },
    {
      id: data.homeTeamId,
      name: data.homeTeamName,
      color: opts.homeColor,
      points: homePoints,
      isHome: true,
    },
  ];

  // ---- Main cumulative-score chart ------------------------------------
  const mainHost = document.createElement('div');
  mainHost.dataset['chart'] = 'gameFlow';
  mainHost.className = 'chart-slot';
  el.appendChild(mainHost);

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    mainHost,
    opts.width,
    opts.height,
    opts.margin,
  );

  // A11y: title + desc.
  const titleText = `Game flow: ${data.awayTeamName} ${data.finalAway}, ${data.homeTeamName} ${data.finalHome}`;
  svg.attr('aria-label', titleText);
  svg.append('title').text(titleText);
  const narrative = buildNarrative({
    homeName: data.homeTeamName,
    awayName: data.awayTeamName,
    homeSeries: homePoints,
    awaySeries: awayPoints,
    maxPeriod,
  });
  svg.append('desc').text(narrative);

  const x = scaleLinear().domain([0, maxPeriod]).range([0, innerWidth]);
  const yMax = Math.max(homeFinal, awayFinal, data.finalHome, data.finalAway, 1);
  const y = scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

  // Quarter dividers (vertical dashed lines) at each period boundary.
  for (let i = 1; i < maxPeriod; i += 1) {
    inner
      .append('line')
      .attr('x1', x(i))
      .attr('x2', x(i))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', theme.border)
      .attr('stroke-dasharray', '2 3')
      .attr('stroke-width', 1);
  }

  // Lines (step-after curve — each goal is a discrete event).
  if (hasPeriodData) {
    const linePath = line<CumulativePoint>()
      .x((d) => x(d.x))
      .y((d) => y(d.goals))
      .curve(curveStepAfter);

    for (const s of series) {
      inner
        .append('path')
        .attr('d', linePath(s.points) ?? '')
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', s.isHome ? null : '6 3');
    }

    // Endpoint dots + final-score labels on the right.
    for (const s of series) {
      const last = s.points[s.points.length - 1];
      if (!last) continue;
      inner
        .append('circle')
        .attr('cx', x(last.x))
        .attr('cy', y(last.goals))
        .attr('r', 3.5)
        .attr('fill', s.color);
      inner
        .append('text')
        .attr('x', x(last.x) + 8)
        .attr('y', y(last.goals))
        .attr('dy', '0.32em')
        .attr('fill', s.color)
        .attr('font-weight', '600')
        .text(`${s.name} ${last.goals}`);
    }
  } else {
    inner
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', theme.muted)
      .text('No period-by-period data recorded.');
  }

  // Axes.
  const xAxisG = inner
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      axisBottom<number>(x)
        .tickValues(Array.from({ length: maxPeriod }, (_, i) => i + 1))
        .tickFormat((d) => periodLabel(Number(d))),
    );
  xAxisG.selectAll('text').attr('fill', theme.fg);
  xAxisG.selectAll('path,line').attr('stroke', theme.border);

  const yAxisG = inner.call(axisLeft(y).ticks(Math.min(6, yMax)).tickFormat((d) => String(d)));
  yAxisG.selectAll('text').attr('fill', theme.fg);
  yAxisG.selectAll('path,line').attr('stroke', theme.border);

  // ---- Optional score-difference panel --------------------------------
  if (opts.showDifferencePanel && hasPeriodData) {
    const diffHost = document.createElement('div');
    diffHost.dataset['chart'] = 'gameFlowDiff';
    diffHost.className = 'chart-slot game-flow-diff';
    el.appendChild(diffHost);

    const diffHeight = 80;
    const diffMargin: ChartMargin = { top: 8, right: opts.margin.right, bottom: 24, left: opts.margin.left };
    const {
      svg: diffSvg,
      inner: diffInner,
      innerWidth: diffW,
      innerHeight: diffH,
    } = createResponsiveSvg(diffHost, opts.width, diffHeight, diffMargin);

    // home - away over each period.
    const diffPoints: Array<{ x: number; d: number }> = [];
    for (let i = 0; i <= maxPeriod; i += 1) {
      const h = homePoints[i]?.goals ?? 0;
      const a = awayPoints[i]?.goals ?? 0;
      diffPoints.push({ x: i, d: h - a });
    }
    const dExtent = Math.max(1, ...diffPoints.map((p) => Math.abs(p.d)));
    const xd = scaleLinear().domain([0, maxPeriod]).range([0, diffW]);
    const yd = scaleLinear().domain([-dExtent, dExtent]).range([diffH, 0]);

    diffSvg.attr('aria-label', `Score difference over time (${data.homeTeamName} minus ${data.awayTeamName})`);

    // Zero baseline.
    diffInner
      .append('line')
      .attr('x1', 0)
      .attr('x2', diffW)
      .attr('y1', yd(0))
      .attr('y2', yd(0))
      .attr('stroke', theme.border)
      .attr('stroke-width', 1);

    const homeArea = area<{ x: number; d: number }>()
      .x((p) => xd(p.x))
      .y0(yd(0))
      .y1((p) => yd(Math.max(0, p.d)))
      .curve(curveStepAfter);
    const awayArea = area<{ x: number; d: number }>()
      .x((p) => xd(p.x))
      .y0(yd(0))
      .y1((p) => yd(Math.min(0, p.d)))
      .curve(curveStepAfter);

    diffInner
      .append('path')
      .attr('d', homeArea(diffPoints) ?? '')
      .attr('fill', opts.homeColor)
      .attr('fill-opacity', 0.55);
    diffInner
      .append('path')
      .attr('d', awayArea(diffPoints) ?? '')
      .attr('fill', opts.awayColor)
      .attr('fill-opacity', 0.55);

    // Period dividers on diff panel too.
    for (let i = 1; i < maxPeriod; i += 1) {
      diffInner
        .append('line')
        .attr('x1', xd(i))
        .attr('x2', xd(i))
        .attr('y1', 0)
        .attr('y2', diffH)
        .attr('stroke', theme.border)
        .attr('stroke-dasharray', '2 3')
        .attr('stroke-width', 1);
    }

    const xdAxis = diffInner
      .append('g')
      .attr('transform', `translate(0,${diffH})`)
      .call(
        axisBottom<number>(xd)
          .tickValues(Array.from({ length: maxPeriod }, (_, i) => i + 1))
          .tickFormat((d) => periodLabel(Number(d))),
      );
    xdAxis.selectAll('text').attr('fill', theme.muted);
    xdAxis.selectAll('path,line').attr('stroke', theme.border);
  }

  // ---- Visible narrative paragraph (also acts as a11y mirror) ---------
  const summary = document.createElement('p');
  summary.className = 'game-flow-summary muted';
  summary.textContent = narrative;
  el.appendChild(summary);

  // ---- Visually-hidden cumulative table (a11y) ------------------------
  if (hasPeriodData) {
    const sr = document.createElement('table');
    sr.className = 'sr-only game-flow-sr';
    sr.setAttribute('aria-label', 'Cumulative score by period');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    const thBlank = document.createElement('th');
    thBlank.textContent = 'Team';
    trh.appendChild(thBlank);
    for (let i = 1; i <= maxPeriod; i += 1) {
      const th = document.createElement('th');
      th.textContent = periodLabel(i);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    sr.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const s of series) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = s.name;
      tr.appendChild(tdName);
      for (let i = 1; i <= maxPeriod; i += 1) {
        const td = document.createElement('td');
        td.textContent = String(s.points[i]?.goals ?? 0);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    sr.appendChild(tbody);
    el.appendChild(sr);
  }

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.classList.remove('game-flow-chart');
    },
  };
}
