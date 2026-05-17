import type { ChartHandle } from './types.js';
import type { CalendarDay } from '../api.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CELL = 13;
const GAP = 2;
const STEP = CELL + GAP;
const PAD_LEFT = 24;
const PAD_TOP = 20;

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeSvgText(attrs: Record<string, string>, text: string): SVGTextElement {
  const node = document.createElementNS(SVG_NS, 'text');
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
}

function cellColor(count: number): string {
  if (count === 0) return 'var(--border)';
  if (count === 1) return '#93c5fd';
  if (count <= 3) return '#3b82f6';
  return 'var(--accent)';
}

export function renderCalendarHeatmap(
  container: HTMLElement,
  days: CalendarDay[],
): ChartHandle {
  container.replaceChildren();

  const gameMap = new Map<string, number>();
  for (const day of days) gameMap.set(day.date, day.gameCount);

  if (days.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'muted';
    msg.textContent = 'No games this season yet.';
    container.appendChild(msg);
    return { destroy: () => msg.remove() };
  }

  const sortedDates = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = new Date(`${sortedDates[0]!.date}T00:00:00`);
  const lastDate = new Date(`${sortedDates[sortedDates.length - 1]!.date}T00:00:00`);

  const startDate = new Date(firstDate);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  const endDate = new Date(lastDate);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

  const allDates: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    allDates.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks = Math.ceil(allDates.length / 7);
  const width = PAD_LEFT + weeks * STEP;
  const height = PAD_TOP + 7 * STEP + 16;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.maxWidth = '100%';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Season game calendar');

  const dowLabels: Array<[number, string]> = [[1, 'M'], [3, 'W'], [5, 'F']];
  for (const [row, label] of dowLabels) {
    svg.appendChild(makeSvgText({
      x: String(PAD_LEFT - 4),
      y: String(PAD_TOP + row * STEP + CELL - 2),
      'text-anchor': 'end',
      'font-size': '12',
      fill: 'var(--muted)',
    }, label));
  }

  let lastMonth = -1;
  allDates.forEach((dateStr, index) => {
    const weekIdx = Math.floor(index / 7);
    const dayOfWeek = index % 7;
    if (dayOfWeek === 0) {
      const date = new Date(`${dateStr}T00:00:00`);
      const month = date.getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        svg.appendChild(makeSvgText({
          x: String(PAD_LEFT + weekIdx * STEP),
          y: String(PAD_TOP - 4),
          'font-size': '12',
          fill: 'var(--muted)',
        }, date.toLocaleString('en-US', { month: 'short' })));
      }
    }

    const count = gameMap.get(dateStr) ?? 0;
    const x = PAD_LEFT + weekIdx * STEP;
    const y = PAD_TOP + dayOfWeek * STEP;

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(CELL));
    rect.setAttribute('height', String(CELL));
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', cellColor(count));

    const titleEl = document.createElementNS(SVG_NS, 'title');
    titleEl.textContent = count > 0
      ? `${dateStr}: ${count} game${count !== 1 ? 's' : ''}`
      : dateStr;
    rect.appendChild(titleEl);
    svg.appendChild(rect);
  });

  const legendY = height - 12;
  const legendItems: Array<[string, string]> = [
    ['var(--border)', 'No games'],
    ['#93c5fd', '1'],
    ['#3b82f6', '2-3'],
    ['var(--accent)', '4+'],
  ];
  let legendX = PAD_LEFT;
  for (const [color, label] of legendItems) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(legendX));
    rect.setAttribute('y', String(legendY));
    rect.setAttribute('width', '10');
    rect.setAttribute('height', '10');
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', color);
    svg.appendChild(rect);

    svg.appendChild(makeSvgText({
      x: String(legendX + 13),
      y: String(legendY + 9),
      'font-size': '12',
      fill: 'var(--muted)',
    }, label));
    legendX += 13 + label.length * 6 + 8;
  }

  container.appendChild(svg);
  return { destroy: () => svg.remove() };
}
