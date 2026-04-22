// Anomaly browser (W11 L3, Luke). Maintainer/diagnostic page that groups
// parser anomalies by reason and surfaces the most-frequent raw lines so
// data-quality work can happen in one screen instead of hand-querying SQLite.

import { ApiError, getAnomalySummary, type AnomalySummaryResponse } from '../api.js';
import { renderHorizontalLeaderboard } from '../charts/horizontalLeaderboard.js';

const TOP_RAW_LIMIT = 50;

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Anomaly browser';
  root.appendChild(h1);

  const subtitle = document.createElement('p');
  subtitle.className = 'muted anomaly-subtitle';
  subtitle.textContent = 'Loading anomalies…';
  root.appendChild(subtitle);

  const status = document.createElement('div');
  status.className = 'anomaly-status';
  root.appendChild(status);

  const summarySection = document.createElement('section');
  summarySection.className = 'anomaly-section';
  summarySection.hidden = true;
  const summaryHeading = document.createElement('h2');
  summaryHeading.textContent = 'Counts by reason';
  summarySection.appendChild(summaryHeading);
  const summaryChart = document.createElement('div');
  summaryChart.className = 'anomaly-summary-chart';
  summarySection.appendChild(summaryChart);
  root.appendChild(summarySection);

  const topSection = document.createElement('section');
  topSection.className = 'anomaly-section';
  topSection.hidden = true;
  const topHeading = document.createElement('h2');
  topHeading.textContent = 'Top raw lines';
  topSection.appendChild(topHeading);
  const topMeta = document.createElement('p');
  topMeta.className = 'muted';
  topSection.appendChild(topMeta);
  const topBody = document.createElement('div');
  topBody.className = 'anomaly-top-body';
  topSection.appendChild(topBody);
  root.appendChild(topSection);

  void load({ subtitle, status, summarySection, summaryChart, topSection, topMeta, topBody });
}

interface RenderTargets {
  subtitle: HTMLElement;
  status: HTMLElement;
  summarySection: HTMLElement;
  summaryChart: HTMLElement;
  topSection: HTMLElement;
  topMeta: HTMLElement;
  topBody: HTMLElement;
}

async function load(t: RenderTargets): Promise<void> {
  let data: AnomalySummaryResponse;
  try {
    data = await getAnomalySummary({ limit: TOP_RAW_LIMIT });
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    t.subtitle.textContent = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Failed to load anomalies: ${msg}`;
    t.status.replaceChildren(p);
    return;
  }

  if (data.totalCount === 0) {
    t.subtitle.textContent = '';
    const p = document.createElement('p');
    p.className = 'anomaly-empty';
    p.textContent = 'No anomalies — clean ingest 🎉';
    t.status.replaceChildren(p);
    return;
  }

  t.subtitle.textContent = `${data.totalCount.toLocaleString()} anomalies across ${data.byReason.length} distinct reason${
    data.byReason.length === 1 ? '' : 's'
  }.`;

  t.summarySection.hidden = false;
  renderSummary(t.summaryChart, data);

  t.topSection.hidden = false;
  renderTopLines(t.topBody, t.topMeta, data);
}

function renderSummary(host: HTMLElement, data: AnomalySummaryResponse): void {
  host.replaceChildren();
  const items = data.byReason.map((r, idx) => ({
    id: String(idx),
    label: shortenReason(r.reason),
    value: r.count,
  }));
  renderHorizontalLeaderboard(host, items, {
    height: Math.max(220, 44 * items.length + 80),
    valueFormat: (n: number) => n.toLocaleString(),
    xAxisLabel: 'count',
  });
}

function renderTopLines(host: HTMLElement, meta: HTMLElement, data: AnomalySummaryResponse): void {
  host.replaceChildren();

  if (data.topRawLines.length === 0) {
    meta.textContent = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No raw lines to show.';
    host.appendChild(p);
    return;
  }

  meta.textContent = `Top ${data.topRawLines.length} most-frequent (raw line, reason) pairs.`;

  const scroller = document.createElement('div');
  scroller.className = 'anomaly-scroll';

  const table = document.createElement('table');
  table.className = 'anomaly-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Count', 'Reason', 'Raw line', 'Source post']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of data.topRawLines) {
    const tr = document.createElement('tr');

    const tdCount = document.createElement('td');
    tdCount.className = 'anomaly-num';
    tdCount.textContent = String(row.count);
    tr.appendChild(tdCount);

    const tdReason = document.createElement('td');
    tdReason.className = 'anomaly-reason';
    tdReason.textContent = row.reason;
    tr.appendChild(tdReason);

    const tdRaw = document.createElement('td');
    const pre = document.createElement('pre');
    pre.className = 'anomaly-raw';
    pre.textContent = row.rawLine;
    tdRaw.appendChild(pre);
    tr.appendChild(tdRaw);

    const tdSrc = document.createElement('td');
    tdSrc.className = 'anomaly-src';
    if (row.exampleSourceUrl) {
      const link = document.createElement('a');
      link.href = row.exampleSourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'open';
      tdSrc.appendChild(link);
    } else {
      tdSrc.textContent = '—';
    }
    tr.appendChild(tdSrc);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroller.appendChild(table);
  host.appendChild(scroller);
}

function shortenReason(reason: string): string {
  if (reason.length <= 60) return reason;
  return `${reason.slice(0, 57)}…`;
}
