// RFC 05 — Team strength radar chart.
//
// A 6-axis radar that summarizes a team's season profile against the
// league population, each axis percentile-normalized so polygon shape is
// directly comparable team-to-team. Axes are fixed in order site-wide so
// a coach can read "blue team" vs. "orange team" at a glance.
//
// The metric set is intentionally constrained to fields available in the
// already-loaded `TeamSeasonRecord` payload (record + goals for/against)
// plus opponent lookup against the team list — no new server endpoint and
// no per-player aggregation. RFC 05's longer 7-axis list (faceoff %, GB/g,
// saves/g) is explicitly deferred until a `/teams/:id/profile` endpoint
// exists; this version covers the offense/defense/quality/schedule shape
// every team has data for today.
//
// Public surface:
//   renderTeamRadarChart(container, data, options?) -> { destroy() }
//
// Pure helpers exported for unit tests:
//   computeRadarAxes, percentileRank, safeDiv, gamesPlayedOf, winPctOf,
//   polygonPath, axisCoords, buildRadarSummary.

import { createResponsiveSvg, readTheme } from '../charts/internal/svg.js';
import type { ChartHandle, ChartMargin } from '../charts/types.js';

/** Minimal shape required from each entry in the league population. */
export interface TeamLike {
  id: number;
  name: string;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** Minimal shape required for opponent lookup when computing SoS. */
export interface RadarOpponentRef {
  /** Opponent team id from the focal team's perspective. */
  opponentId: number;
  /** True for postponed/forfeit/no-score games; excluded from SoS. */
  postponed: boolean;
}

export interface RadarAxis {
  /** Stable key — order matches the on-screen axis order. */
  key: string;
  /** Short label used as the axis tip. */
  label: string;
  /** Raw value in the metric's natural units (goals, %, etc). */
  rawValue: number;
  /** Pre-formatted display string for the a11y table + tooltip. */
  display: string;
  /** 0..1 percentile rank against the population; 0 = league min, 1 = max. */
  percentile: number;
}

export interface TeamRadarChartData {
  team: TeamLike;
  /** League population (typically all teams with >= minGames). */
  population: ReadonlyArray<TeamLike>;
  /** Focal team's opponents (one row per scheduled game). */
  opponents: ReadonlyArray<RadarOpponentRef>;
}

export interface TeamRadarChartOptions {
  width: number;
  height: number;
  margin: ChartMargin;
  /** Polygon stroke + fill base color. Mirrors gameFlowChart/quarterByQuarter. */
  color: string;
  /** Percentile-cutoff for the dashed median ring. */
  medianRing: number;
  /** Minimum games before a team is considered to have a stable profile. */
  minGames: number;
}

const DEFAULTS: TeamRadarChartOptions = {
  width: 480,
  height: 480,
  margin: { top: 40, right: 80, bottom: 40, left: 80 },
  color: '#f97316', // orange — matches quarterByQuarter "away" / accent palette
  medianRing: 0.5,
  minGames: 3,
};

// ---------- pure helpers ----------------------------------------------

export function safeDiv(num: number, den: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

/** wins + losses; this codebase's `TeamSeasonRecord` does not carry ties. */
export function gamesPlayedOf(t: TeamLike): number {
  return Math.max(0, t.wins) + Math.max(0, t.losses);
}

export function winPctOf(t: TeamLike): number {
  return safeDiv(t.wins, gamesPlayedOf(t));
}

/**
 * Percentile rank of `value` against `population`, in 0..1. Empty
 * population → 0.5 (neutral). Single-value population → 0.5. Stable for
 * ties (uses average of "below" + "below or equal"), and clamps to [0,1].
 */
export function percentileRank(value: number, population: ReadonlyArray<number>): number {
  if (population.length === 0) return 0.5;
  if (population.length === 1) return 0.5;
  let below = 0;
  let atOrBelow = 0;
  for (const v of population) {
    if (!Number.isFinite(v)) continue;
    if (v < value) below += 1;
    if (v <= value) atOrBelow += 1;
  }
  const denom = population.length;
  const rank = (below + atOrBelow) / 2 / denom;
  if (rank < 0) return 0;
  if (rank > 1) return 1;
  return rank;
}

/**
 * Compute the focal team's six axes plus their league-percentile rankings.
 * The "Defense" axis inverts goals-against so that higher percentile = better
 * (fewer goals allowed), keeping the polygon's "bigger is better" reading.
 */
export function computeRadarAxes(
  team: TeamLike,
  population: ReadonlyArray<TeamLike>,
  opponents: ReadonlyArray<RadarOpponentRef>,
): RadarAxis[] {
  const winPctPop = population.map(winPctOf);
  const gpgPop = population.map((t) => safeDiv(t.goalsFor, gamesPlayedOf(t)));
  // Lower is better for goals-against; we percentile-rank the negated value
  // so the percentile reads as "defensive strength".
  const defPop = population.map((t) => -safeDiv(t.goalsAgainst, gamesPlayedOf(t)));
  const marginPop = population.map((t) =>
    safeDiv(t.goalsFor - t.goalsAgainst, gamesPlayedOf(t)),
  );
  const gfVolPop = population.map((t) => t.goalsFor);

  // Strength of schedule — mean opponent winPct, computed over completed
  // (non-postponed) opponents found in the population. Falls back to 0.5
  // when nothing is resolvable so we never emit NaN into the chart.
  const popById = new Map<number, TeamLike>();
  for (const t of population) popById.set(t.id, t);
  const sosPop = population.map((t) => meanOpponentWinPct(t.id, opponents, popById));

  const teamWinPct = winPctOf(team);
  const teamGpg = safeDiv(team.goalsFor, gamesPlayedOf(team));
  const teamGapg = safeDiv(team.goalsAgainst, gamesPlayedOf(team));
  const teamMargin = safeDiv(team.goalsFor - team.goalsAgainst, gamesPlayedOf(team));
  const teamGfVol = team.goalsFor;
  const teamSos = meanOpponentWinPct(team.id, opponents, popById);

  return [
    {
      key: 'winPct',
      label: 'Win %',
      rawValue: teamWinPct,
      display: `${Math.round(teamWinPct * 100)}%`,
      percentile: percentileRank(teamWinPct, winPctPop),
    },
    {
      key: 'goalsFor',
      label: 'Goals/g',
      rawValue: teamGpg,
      display: teamGpg.toFixed(1),
      percentile: percentileRank(teamGpg, gpgPop),
    },
    {
      key: 'defense',
      label: 'Defense',
      rawValue: teamGapg,
      display: `${teamGapg.toFixed(1)} allowed/g`,
      percentile: percentileRank(-teamGapg, defPop),
    },
    {
      key: 'margin',
      label: 'Margin/g',
      rawValue: teamMargin,
      display: (teamMargin >= 0 ? '+' : '') + teamMargin.toFixed(1),
      percentile: percentileRank(teamMargin, marginPop),
    },
    {
      key: 'goalsForTotal',
      label: 'GF total',
      rawValue: teamGfVol,
      display: String(teamGfVol),
      percentile: percentileRank(teamGfVol, gfVolPop),
    },
    {
      key: 'sos',
      label: 'Sched',
      rawValue: teamSos,
      display: `${Math.round(teamSos * 100)}% opp WP`,
      percentile: percentileRank(teamSos, sosPop),
    },
  ];
}

/** Mean opponent win% across non-postponed games, ignoring unknown ids. */
function meanOpponentWinPct(
  teamId: number,
  opponents: ReadonlyArray<RadarOpponentRef>,
  popById: Map<number, TeamLike>,
): number {
  let n = 0;
  let sum = 0;
  for (const o of opponents) {
    if (o.postponed) continue;
    if (o.opponentId === teamId) continue; // defensive: never compare to self
    const opp = popById.get(o.opponentId);
    if (!opp) continue;
    sum += winPctOf(opp);
    n += 1;
  }
  if (n === 0) return 0.5;
  return sum / n;
}

export interface AxisCoord {
  x: number;
  y: number;
}

/**
 * Convert axis index → unit-circle point at `radius`. Index 0 sits at 12
 * o'clock; subsequent axes step clockwise. Polygon vertices use the same
 * helper, scaled by each axis's percentile, so the geometry is consistent.
 */
export function axisCoords(
  index: number,
  total: number,
  cx: number,
  cy: number,
  radius: number,
): AxisCoord {
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/**
 * SVG `d` attribute for the polygon connecting each axis vertex at its
 * own percentile radius. Always returns a closed path (`Z`).
 */
export function polygonPath(
  axes: ReadonlyArray<RadarAxis>,
  cx: number,
  cy: number,
  maxRadius: number,
): string {
  if (axes.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < axes.length; i += 1) {
    const ax = axes[i]!;
    const r = Math.max(0, Math.min(1, ax.percentile)) * maxRadius;
    const { x, y } = axisCoords(i, axes.length, cx, cy, r);
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * One-to-three sentence narrative summarizing the team's polygon shape.
 * Intentionally conservative: only the strongest + weakest axes by
 * percentile, plus a sample-size caveat for thin profiles.
 */
export function buildRadarSummary(
  teamName: string,
  axes: ReadonlyArray<RadarAxis>,
  gamesPlayed: number,
  minGames: number,
): string {
  if (axes.length === 0) {
    return `${teamName} has no league-comparable stats yet.`;
  }
  let strongest = axes[0]!;
  let weakest = axes[0]!;
  for (const a of axes) {
    if (a.percentile > strongest.percentile) strongest = a;
    if (a.percentile < weakest.percentile) weakest = a;
  }
  const pct = (p: number): string => `${Math.round(p * 100)}th percentile`;
  const parts: string[] = [];
  parts.push(
    `${teamName} profile: strongest in ${strongest.label} (${pct(strongest.percentile)}, ${strongest.display}); ` +
      `weakest in ${weakest.label} (${pct(weakest.percentile)}, ${weakest.display}).`,
  );
  if (gamesPlayed < minGames) {
    parts.push(
      `Low sample size (${gamesPlayed} game${gamesPlayed === 1 ? '' : 's'}) — profile may shift as the season progresses.`,
    );
  }
  return parts.join(' ');
}

// ---------- render -----------------------------------------------------

export function renderTeamRadarChart(
  el: HTMLElement,
  data: TeamRadarChartData,
  options?: Partial<TeamRadarChartOptions>,
): ChartHandle {
  const opts: TeamRadarChartOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  while (el.firstChild) el.removeChild(el.firstChild);
  el.classList.add('team-radar-chart');

  const axes = computeRadarAxes(data.team, data.population, data.opponents);
  const gamesPlayed = gamesPlayedOf(data.team);
  const lowSample = gamesPlayed < opts.minGames;

  const summary = buildRadarSummary(data.team.name, axes, gamesPlayed, opts.minGames);

  const chartHost = document.createElement('div');
  chartHost.dataset['chart'] = 'teamRadar';
  chartHost.className = 'chart-slot';
  el.appendChild(chartHost);

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    chartHost,
    opts.width,
    opts.height,
    opts.margin,
  );

  const titleText = `Team strength radar: ${data.team.name}`;
  svg.attr('aria-label', titleText);
  svg.append('title').text(titleText);
  svg.append('desc').text(summary);

  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const maxRadius = Math.max(0, Math.min(innerWidth, innerHeight) / 2 - 4);

  // Concentric grid rings at 25/50/75/100% — median ring is dashed.
  const rings = [0.25, 0.5, 0.75, 1.0];
  for (const r of rings) {
    inner
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', r * maxRadius)
      .attr('fill', 'none')
      .attr('stroke', theme.border)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', Math.abs(r - opts.medianRing) < 1e-6 ? '4 3' : null);
  }

  // Axis spokes + labels with hover tooltips explaining each metric.
  const axisDescriptions: Record<string, string> = {
    winPct: 'Win percentage: games won divided by total games played',
    goalsFor: 'Goals per game: average goals scored per game this season',
    defense: 'Defense: fewer goals allowed per game = higher rating',
    margin: 'Goal margin per game: average difference between goals scored and allowed',
    goalsForTotal: 'Total goals scored this season (volume, not per-game)',
    sos: 'Schedule strength: average win% of opponents faced this season',
  };
  for (let i = 0; i < axes.length; i += 1) {
    const ax = axes[i]!;
    const tip = axisCoords(i, axes.length, cx, cy, maxRadius);
    inner
      .append('line')
      .attr('x1', cx)
      .attr('y1', cy)
      .attr('x2', tip.x)
      .attr('y2', tip.y)
      .attr('stroke', theme.border)
      .attr('stroke-width', 1);
    const labelPos = axisCoords(i, axes.length, cx, cy, maxRadius + 14);
    const anchor =
      Math.abs(labelPos.x - cx) < 1 ? 'middle' : labelPos.x > cx ? 'start' : 'end';
    const textEl = inner
      .append('text')
      .attr('x', labelPos.x)
      .attr('y', labelPos.y)
      .attr('dy', '0.32em')
      .attr('text-anchor', anchor)
      .attr('fill', theme.fg)
      .attr('font-size', 13)
      .attr('font-weight', '600')
      .attr('cursor', 'help')
      .text(ax.label);
    const desc = axisDescriptions[ax.key] ?? ax.label;
    textEl.append('title').text(`${desc} - ${ax.display} (${Math.round(ax.percentile * 100)}th percentile)`);
  }

  // Polygon — filled, with a stroke. Dashed when sample size is thin.
  inner
    .append('path')
    .attr('d', polygonPath(axes, cx, cy, maxRadius))
    .attr('fill', opts.color)
    .attr('fill-opacity', 0.3)
    .attr('stroke', opts.color)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', lowSample ? '5 3' : null)
    .attr('stroke-linejoin', 'round');

  // Vertex dots — give each axis a click target visual anchor with tooltip.
  for (let i = 0; i < axes.length; i += 1) {
    const ax = axes[i]!;
    const r = Math.max(0, Math.min(1, ax.percentile)) * maxRadius;
    const v = axisCoords(i, axes.length, cx, cy, r);
    const dot = inner
      .append('circle')
      .attr('cx', v.x)
      .attr('cy', v.y)
      .attr('r', 5)
      .attr('fill', opts.color)
      .attr('cursor', 'help');
    const desc = axisDescriptions[ax.key] ?? ax.label;
    dot.append('title').text(`${ax.label}: ${ax.display} (${Math.round(ax.percentile * 100)}th percentile)\n${desc}`);
  }

  // Visible narrative paragraph (also serves as the sighted a11y mirror).
  const summaryEl = document.createElement('p');
  summaryEl.className = 'team-radar-summary muted';
  summaryEl.textContent = summary;
  el.appendChild(summaryEl);

  // Visually-hidden table mirror — screen readers get the underlying numbers
  // verbatim, mirroring gameFlowChart's pattern.
  const sr = document.createElement('table');
  sr.className = 'sr-only team-radar-sr';
  sr.setAttribute('aria-label', `Radar values for ${data.team.name}`);
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Axis', 'Value', 'League percentile']) {
    const th = document.createElement('th');
    th.textContent = label;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  sr.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const ax of axes) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = ax.label;
    tr.appendChild(tdName);
    const tdVal = document.createElement('td');
    tdVal.textContent = ax.display;
    tr.appendChild(tdVal);
    const tdPct = document.createElement('td');
    tdPct.textContent = `${Math.round(ax.percentile * 100)}`;
    tr.appendChild(tdPct);
    tbody.appendChild(tr);
  }
  sr.appendChild(tbody);
  el.appendChild(sr);

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
      el.classList.remove('team-radar-chart');
    },
  };
}
