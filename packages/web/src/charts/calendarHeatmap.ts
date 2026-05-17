import { select } from 'd3-selection';
import { createResponsiveSvg, readTheme } from './internal/svg.js';
import type { ChartHandle } from './types.js';

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  count: number;
  gameIds?: number[];
}

const CELL_SIZE = 12;
const CELL_GAP = 2;
const STEP = CELL_SIZE + CELL_GAP;
const LABEL_COL_WIDTH = 26;
const MONTH_LABEL_HEIGHT = 20;
const GRID_TOP = 4;
const GRID_HEIGHT = 7 * STEP;
const CHART_HEIGHT = MONTH_LABEL_HEIGHT + GRID_TOP + GRID_HEIGHT + 4;

function parseIsoDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function mondayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

function startOfWeekMonday(date: Date): Date {
  return addUtcDays(date, -mondayIndex(date));
}

function endOfWeekSunday(date: Date): Date {
  return addUtcDays(date, 6 - mondayIndex(date));
}

function colorForCount(count: number): string {
  if (count <= 0) return '#ffffff';
  if (count <= 2) return '#bfdbfe';
  if (count <= 4) return '#3b82f6';
  return '#1d4ed8';
}

export function renderCalendarHeatmap(container: HTMLElement, days: CalendarDay[]): ChartHandle {
  while (container.firstChild) container.removeChild(container.firstChild);

  if (days.length === 0) {
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = 'No games data available';
    container.appendChild(message);
    return {
      destroy() {
        while (container.firstChild) container.removeChild(container.firstChild);
      },
    };
  }

  const theme = readTheme();
  const countsByDate = new Map(days.map((day) => [day.date, day.count]));
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = startOfWeekMonday(parseIsoDate(sortedDays[0]!.date));
  const lastDate = endOfWeekSunday(parseIsoDate(sortedDays[sortedDays.length - 1]!.date));

  const gridDates: string[] = [];
  for (let cursor = new Date(firstDate); cursor <= lastDate; cursor = addUtcDays(cursor, 1)) {
    gridDates.push(formatIsoDate(cursor));
  }

  const weekCount = Math.max(Math.ceil(gridDates.length / 7), 1);
  const gridWidth = weekCount * STEP;
  const requestedWidth = Math.min(Math.max(container.clientWidth || 0, 320), 700);
  const width = Math.max(requestedWidth, LABEL_COL_WIDTH + gridWidth + 12);
  const margin = { top: 0, right: 8, bottom: 0, left: 0 };
  const { svg, inner } = createResponsiveSvg(container, width, CHART_HEIGHT, margin);

  svg.attr('aria-label', 'Season activity calendar heatmap');

  const root = inner.append('g').attr('transform', 'translate(0,0)');
  const labels = root.append('g');
  const cells = root.append('g');

  labels
    .selectAll('text.day-label')
    .data([
      { label: 'M', row: 0 },
      { label: 'W', row: 2 },
      { label: 'F', row: 4 },
    ])
    .enter()
    .append('text')
    .attr('class', 'day-label')
    .attr('x', LABEL_COL_WIDTH - 8)
    .attr('y', (d) => MONTH_LABEL_HEIGHT + GRID_TOP + d.row * STEP + CELL_SIZE - 2)
    .attr('text-anchor', 'end')
    .attr('fill', theme.muted)
    .style('font-size', '11px')
    .text((d) => d.label);

  const monthAnchors: Array<{ label: string; week: number }> = [];
  const seenMonths = new Set<string>();
  gridDates.forEach((dateString, index) => {
    const date = parseIsoDate(dateString);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (index === 0 || date.getUTCDate() === 1) {
      if (!seenMonths.has(key)) {
        seenMonths.add(key);
        monthAnchors.push({
          label: date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
          week: Math.floor(index / 7),
        });
      }
    }
  });

  labels
    .selectAll('text.month-label')
    .data(monthAnchors)
    .enter()
    .append('text')
    .attr('class', 'month-label')
    .attr('x', (d) => LABEL_COL_WIDTH + d.week * STEP)
    .attr('y', 12)
    .attr('fill', theme.muted)
    .style('font-size', '11px')
    .text((d) => d.label);

  const cellData = gridDates.map((dateString, index) => ({
    date: dateString,
    count: countsByDate.get(dateString) ?? 0,
    week: Math.floor(index / 7),
    row: index % 7,
  }));

  const rects = cells
    .selectAll<SVGRectElement, (typeof cellData)[number]>('rect.day-cell')
    .data(cellData)
    .enter()
    .append('rect')
    .attr('class', 'day-cell')
    .attr('x', (d) => LABEL_COL_WIDTH + d.week * STEP)
    .attr('y', (d) => MONTH_LABEL_HEIGHT + GRID_TOP + d.row * STEP)
    .attr('width', CELL_SIZE)
    .attr('height', CELL_SIZE)
    .attr('rx', 2)
    .attr('fill', (d) => colorForCount(d.count))
    .attr('stroke', theme.border)
    .attr('stroke-width', 1);

  rects
    .append('title')
    .text((d) => `${d.date}: ${d.count} game${d.count === 1 ? '' : 's'}`);

  rects
    .on('mouseenter', function onMouseEnter() {
      select(this).attr('stroke', theme.accent).attr('stroke-width', 1.5);
    })
    .on('mouseleave', function onMouseLeave() {
      select(this).attr('stroke', theme.border).attr('stroke-width', 1);
    });

  return {
    destroy() {
      while (container.firstChild) container.removeChild(container.firstChild);
    },
  };
}
