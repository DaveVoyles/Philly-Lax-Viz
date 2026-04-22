// Helpers for constructing responsive SVGs and reading themed CSS variables.

import { select, type Selection } from 'd3-selection';
import type { ChartMargin } from '../types.js';

export interface ResponsiveSvg {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  inner: Selection<SVGGElement, unknown, null, undefined>;
  innerWidth: number;
  innerHeight: number;
}

export function createResponsiveSvg(
  el: HTMLElement,
  width: number,
  height: number,
  margin: ChartMargin,
): ResponsiveSvg {
  // Clear any prior content (without innerHTML).
  while (el.firstChild) el.removeChild(el.firstChild);

  const svg = select(el)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('width', '100%')
    .style('display', 'block')
    .style('max-width', '100%')
    .style('height', 'auto')
    .style('font-family', 'inherit')
    .style('font-size', '12px') as Selection<SVGSVGElement, unknown, null, undefined>;

  const inner = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`) as Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  >;

  return {
    svg,
    inner,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom,
  };
}

// Theme colors pulled from Han's CSS custom properties so charts honor
// prefers-color-scheme automatically.
export interface ChartTheme {
  fg: string;
  muted: string;
  border: string;
  accent: string;
  bg: string;
}

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

export function readTheme(): ChartTheme {
  return {
    fg: readVar('--fg', '#1a1a1a'),
    muted: readVar('--muted', '#6b7280'),
    border: readVar('--border', '#e5e7eb'),
    accent: readVar('--accent', '#1d4ed8'),
    bg: readVar('--bg', '#ffffff'),
  };
}

export function periodLabel(periodNumber: number): string {
  if (periodNumber <= 4) return `Q${periodNumber}`;
  if (periodNumber === 5) return 'OT';
  return `OT${periodNumber - 4}`;
}
