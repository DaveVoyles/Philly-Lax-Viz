// Anomaly browser. Maintainer/diagnostic page that lets you filter parser
// anomalies by `strategy_attempted` so data-quality work happens in one
// screen instead of hand-querying SQLite. Also keeps the by-reason summary
// chart so high-frequency failure modes pop visually.
//
// Wave H8 Lane 3 (Leia): added strategy filter dropdown + URL hash
// persistence so links like `#/anomalies?strategy=composite-name-detected`
// are shareable.

import { ApiError, getAnomalies } from '../api.js';
import type { IngestAnomaly } from '@pll/shared';
import { renderHorizontalLeaderboard } from '../charts/horizontalLeaderboard.js';
import {
  groupByStrategy,
  parseStrategyParam,
  buildStrategyHash,
} from './anomaliesFilter.js';

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

  const controls = document.createElement('div');
  controls.className = 'anomaly-controls';
  controls.hidden = true;
  root.appendChild(controls);

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

  const tableSection = document.createElement('section');
  tableSection.className = 'anomaly-section';
  tableSection.hidden = true;
  const tableHeading = document.createElement('h2');
  tableHeading.textContent = 'Anomalies';
  tableSection.appendChild(tableHeading);
  const tableMeta = document.createElement('p');
  tableMeta.className = 'muted';
  tableSection.appendChild(tableMeta);
  const tableBody = document.createElement('div');
  tableBody.className = 'anomaly-table-body';
  tableSection.appendChild(tableBody);
  root.appendChild(tableSection);

  void load({ subtitle, status, controls, summarySection, summaryChart, tableSection, tableMeta, tableBody });
}

interface RenderTargets {
  subtitle: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
  summarySection: HTMLElement;
  summaryChart: HTMLElement;
  tableSection: HTMLElement;
  tableMeta: HTMLElement;
  tableBody: HTMLElement;
}

interface ViewState {
  all: IngestAnomaly[];
  strategy: string | null; // null = All
}

async function load(t: RenderTargets): Promise<void> {
  let rows: IngestAnomaly[];
  try {
    rows = await getAnomalies();
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    t.subtitle.textContent = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Failed to load anomalies: ${msg}`;
    t.status.replaceChildren(p);
    return;
  }

  if (rows.length === 0) {
    t.subtitle.textContent = '';
    const p = document.createElement('p');
    p.className = 'anomaly-empty';
    p.textContent = 'No anomalies — clean ingest 🎉';
    t.status.replaceChildren(p);
    return;
  }

  const grouped = groupByStrategy(rows);
  const initial = parseStrategyParam(window.location.hash);
  const state: ViewState = {
    all: rows,
    strategy: initial !== null && grouped.has(initial) ? initial : null,
  };

  // If the URL pointed at a strategy that isn't in the dataset, normalize
  // the URL back to the bare hash so the dropdown + URL stay consistent.
  if (initial !== null && !grouped.has(initial)) {
    history.replaceState(null, '', buildStrategyHash(null));
  }

  t.subtitle.textContent = `${rows.length.toLocaleString()} anomalies across ${grouped.size} strateg${
    grouped.size === 1 ? 'y' : 'ies'
  }.`;

  buildControls(t.controls, grouped, state, () => rerender(t, state, grouped));
  t.controls.hidden = false;

  t.summarySection.hidden = false;
  t.tableSection.hidden = false;

  rerender(t, state, grouped);
}

function rerender(
  t: RenderTargets,
  state: ViewState,
  grouped: Map<string, IngestAnomaly[]>,
): void {
  const filtered = state.strategy === null ? state.all : (grouped.get(state.strategy) ?? []);
  renderSummary(t.summaryChart, filtered);
  renderTable(t.tableBody, t.tableMeta, filtered, state);
}

function buildControls(
  container: HTMLElement,
  grouped: Map<string, IngestAnomaly[]>,
  state: ViewState,
  onChange: () => void,
): void {
  container.replaceChildren();

  const label = document.createElement('label');
  label.className = 'anomaly-control';
  const span = document.createElement('span');
  span.textContent = 'Strategy:';
  label.appendChild(span);

  const select = document.createElement('select');

  const total = state.all.length;
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = `All (${total.toLocaleString()})`;
  select.appendChild(allOpt);

  // Sort strategies by count descending, tie-break alphabetically.
  const entries = [...grouped.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  for (const [strategy, rows] of entries) {
    const opt = document.createElement('option');
    opt.value = strategy;
    opt.textContent = `${strategy} (${rows.length.toLocaleString()})`;
    select.appendChild(opt);
  }

  select.value = state.strategy ?? '';

  select.addEventListener('change', () => {
    const next = select.value === '' ? null : select.value;
    state.strategy = next;
    history.replaceState(null, '', buildStrategyHash(next));
    onChange();
  });

  label.appendChild(select);
  container.appendChild(label);
}

function renderSummary(host: HTMLElement, rows: IngestAnomaly[]): void {
  host.replaceChildren();

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No anomalies for the selected strategy.';
    host.appendChild(p);
    return;
  }

  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const items = sorted.map(([reason, count], idx) => ({
    id: String(idx),
    label: shortenReason(reason),
    value: count,
  }));
  renderHorizontalLeaderboard(host, items, {
    height: Math.max(220, 44 * items.length + 80),
    valueFormat: (n: number) => n.toLocaleString(),
    xAxisLabel: 'count',
  });
}

function renderTable(
  host: HTMLElement,
  meta: HTMLElement,
  rows: IngestAnomaly[],
  state: ViewState,
): void {
  host.replaceChildren();

  if (rows.length === 0) {
    meta.textContent = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No matching anomalies.';
    host.appendChild(p);
    return;
  }

  const totalAll = state.all.length;
  meta.textContent =
    state.strategy === null
      ? `Showing all ${rows.length.toLocaleString()} anomalies.`
      : `Showing ${rows.length.toLocaleString()} of ${totalAll.toLocaleString()} anomalies (strategy: ${state.strategy}).`;

  const scroller = document.createElement('div');
  scroller.className = 'anomaly-scroll';

  const table = document.createElement('table');
  table.className = 'anomaly-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const lbl of ['Strategy', 'Reason', 'Raw line', 'Source']) {
    const th = document.createElement('th');
    th.textContent = lbl;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');

    const tdStrategy = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = row.strategyAttempted;
    tdStrategy.appendChild(code);
    tr.appendChild(tdStrategy);

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
    if (row.sourceUrl) {
      const link = document.createElement('a');
      link.href = row.sourceUrl;
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
