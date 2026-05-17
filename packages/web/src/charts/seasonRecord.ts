// Donut chart of W/L/T with counts in the legend.

import { arc, pie, type PieArcDatum } from 'd3-shape';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type {
  ChartHandle,
  SeasonRecordDatum,
  SeasonRecordOptions,
} from './types.js';

const DEFAULTS: SeasonRecordOptions = {
  width: 360,
  height: 220,
  margin: { top: 16, right: 16, bottom: 16, left: 16 },
  winColor: '#16a34a',
  lossColor: '#dc2626',
  tieColor: '#9ca3af',
};

interface Slice {
  key: 'wins' | 'losses' | 'ties';
  label: string;
  value: number;
  color: string;
}

export function renderSeasonRecord(
  el: HTMLElement,
  data: SeasonRecordDatum,
  options?: Partial<SeasonRecordOptions>,
): ChartHandle {
  const opts: SeasonRecordOptions = { ...DEFAULTS, ...options };
  const theme = readTheme();

  const { svg, inner, innerWidth, innerHeight } = createResponsiveSvg(
    el,
    opts.width,
    opts.height,
    opts.margin,
  );

  // Donut occupies left half; legend right half.
  const donutWidth = Math.min(innerWidth * 0.55, innerHeight);
  const radius = donutWidth / 2;
  const cx = radius;
  const cy = innerHeight / 2;

  const slices: Slice[] = [
    { key: 'wins', label: 'Wins', value: data.wins, color: opts.winColor },
    { key: 'losses', label: 'Losses', value: data.losses, color: opts.lossColor },
    { key: 'ties', label: 'Ties', value: data.ties, color: opts.tieColor },
  ];
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  const donutG = inner.append('g').attr('transform', `translate(${cx},${cy})`);

  if (total === 0) {
    donutG
      .append('circle')
      .attr('r', radius)
      .attr('fill', 'none')
      .attr('stroke', theme.border)
      .attr('stroke-width', 2);
    donutG
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', theme.muted)
      .text('No games');
  } else {
    const pieGen = pie<Slice>()
      .value((d) => d.value)
      .sort(null);
    const arcGen = arc<PieArcDatum<Slice>>()
      .innerRadius(radius * 0.55)
      .outerRadius(radius);

    const arcs = pieGen(slices.filter((s) => s.value > 0));
    for (const a of arcs) {
      const path = arcGen(a);
      if (path === null) continue;
      donutG
        .append('path')
        .attr('d', path)
        .attr('fill', a.data.color)
        .attr('stroke', theme.bg)
        .attr('stroke-width', 1)
        .append('title')
        .text(`${a.data.label}: ${a.data.value}`);
    }

    // Center total
    donutG
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('dy', '-0.3em')
      .attr('fill', theme.fg)
      .style('font-size', '24px')
      .style('font-weight', '600')
      .text(String(total));
    donutG
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('dy', '1em')
      .attr('fill', theme.muted)
      .text('games');
  }

  // Legend
  const legendX = donutWidth + 24;
  const legend = inner.append('g').attr('transform', `translate(${legendX},${(innerHeight - slices.length * 22) / 2})`);
  slices.forEach((s, i) => {
    const row = legend.append('g').attr('transform', `translate(0,${i * 22})`);
    row.append('rect').attr('width', 12).attr('height', 12).attr('fill', s.color);
    row
      .append('text')
      .attr('x', 18)
      .attr('y', 10)
      .attr('fill', theme.fg)
      .text(`${s.label}: ${s.value}`);
  });

  // Anchor svg variable so tree-shaking keeps it (and to silence unused warnings).
  void svg;

  return {
    destroy() {
      while (el.firstChild) el.removeChild(el.firstChild);
    },
  };
}
