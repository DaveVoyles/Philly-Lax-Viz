// Data Quality view — surfaces parser anomalies for triage.
// Single fetch on mount, then in-memory client-side filtering + aggregation.

import { ApiError, getAnomalies, getPiaaMismatches, type PiaaMismatchResponse } from '../api.js';
import type { IngestAnomaly, ParserStrategy } from '@pll/shared';

interface ViewState {
  all: IngestAnomaly[];
  kindFilter: string; // '' = all
  search: string; // case-insensitive substring on rawLine + reason
}

const RECENT_PAGE_SIZE = 25;

export function render(root: HTMLElement, _params: Record<string, string>): void {
  // Clear; build static skeleton with DOM (textContent everywhere user data lands).
  root.replaceChildren();

  const h1 = document.createElement('h1');
  h1.textContent = 'Data Quality';
  root.appendChild(h1);

  const subtitle = document.createElement('p');
  subtitle.className = 'muted anomaly-subtitle';
  subtitle.textContent = 'Loading anomalies...';
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
  summaryHeading.textContent = 'Summary';
  summarySection.appendChild(summaryHeading);
  const summaryBody = document.createElement('div');
  summaryBody.className = 'anomaly-summary-body';
  summarySection.appendChild(summaryBody);
  root.appendChild(summarySection);

  const recentSection = document.createElement('section');
  recentSection.className = 'anomaly-section';
  recentSection.hidden = true;
  const recentHeading = document.createElement('h2');
  recentHeading.textContent = 'Recent Anomalies';
  recentSection.appendChild(recentHeading);
  const recentMeta = document.createElement('p');
  recentMeta.className = 'muted anomaly-recent-meta';
  recentSection.appendChild(recentMeta);
  const recentBody = document.createElement('div');
  recentBody.className = 'anomaly-recent-body';
  recentSection.appendChild(recentBody);
  const moreWrap = document.createElement('div');
  moreWrap.className = 'anomaly-more-wrap';
  recentSection.appendChild(moreWrap);
  root.appendChild(recentSection);

  // PIAA D1 cross-check tile (Leia, W2 lane 3).
  const piaaSection = document.createElement('section');
  piaaSection.className = 'anomaly-section piaa-section';
  const piaaHeading = document.createElement('h2');
  piaaHeading.textContent = 'PIAA D1 cross-check';
  piaaSection.appendChild(piaaHeading);
  const piaaSubtitle = document.createElement('p');
  piaaSubtitle.className = 'muted';
  piaaSubtitle.textContent = 'Loading PIAA snapshot…';
  piaaSection.appendChild(piaaSubtitle);
  const piaaBody = document.createElement('div');
  piaaBody.className = 'piaa-body';
  piaaSection.appendChild(piaaBody);
  root.appendChild(piaaSection);

  void load({
    subtitle,
    status,
    controls,
    summarySection,
    summaryBody,
    recentSection,
    recentMeta,
    recentBody,
    moreWrap,
  });

  void loadPiaa(piaaSubtitle, piaaBody);
}

interface RenderTargets {
  subtitle: HTMLElement;
  status: HTMLElement;
  controls: HTMLElement;
  summarySection: HTMLElement;
  summaryBody: HTMLElement;
  recentSection: HTMLElement;
  recentMeta: HTMLElement;
  recentBody: HTMLElement;
  moreWrap: HTMLElement;
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

  // Header / subtitle: total + date range.
  const range = computeDateRange(rows);
  t.subtitle.textContent =
    `${rows.length} anomalies · ` +
    (range ? `${formatDate(range.first)} → ${formatDate(range.last)}` : 'no timestamps');

  const state: ViewState = { all: rows, kindFilter: '', search: '' };

  // Build filter controls.
  const kinds = uniqueKindsSorted(rows);
  buildControls(t.controls, kinds, state, () => renderFiltered(t, state));
  t.controls.hidden = false;

  t.summarySection.hidden = false;
  t.recentSection.hidden = false;

  renderFiltered(t, state);
}

function buildControls(
  container: HTMLElement,
  kinds: string[],
  state: ViewState,
  onChange: () => void,
): void {
  container.replaceChildren();

  const kindLabel = document.createElement('label');
  kindLabel.className = 'anomaly-control';
  const kindSpan = document.createElement('span');
  kindSpan.textContent = 'Kind:';
  kindLabel.appendChild(kindSpan);
  const kindSelect = document.createElement('select');
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = `All (${state.all.length})`;
  kindSelect.appendChild(allOpt);
  for (const k of kinds) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    kindSelect.appendChild(opt);
  }
  kindSelect.addEventListener('change', () => {
    state.kindFilter = kindSelect.value;
    onChange();
  });
  kindLabel.appendChild(kindSelect);
  container.appendChild(kindLabel);

  const searchLabel = document.createElement('label');
  searchLabel.className = 'anomaly-control';
  const searchSpan = document.createElement('span');
  searchSpan.textContent = 'Search:';
  searchLabel.appendChild(searchSpan);
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'reason or raw line…';
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    onChange();
  });
  searchLabel.appendChild(searchInput);
  container.appendChild(searchLabel);
}

function renderFiltered(t: RenderTargets, state: ViewState): void {
  const filtered = applyFilters(state.all, state);
  renderSummary(t.summaryBody, filtered, state.all.length);
  renderRecent(t.recentBody, t.recentMeta, t.moreWrap, filtered);
}

function applyFilters(rows: IngestAnomaly[], state: ViewState): IngestAnomaly[] {
  const needle = state.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (state.kindFilter && r.strategyAttempted !== state.kindFilter) return false;
    if (needle) {
      const hay = `${r.reason}\n${r.rawLine}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function renderSummary(host: HTMLElement, rows: IngestAnomaly[], totalAll: number): void {
  host.replaceChildren();

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No matches for the current filters.';
    host.appendChild(p);
    return;
  }

  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.strategyAttempted, (counts.get(r.strategyAttempted) ?? 0) + 1);
  }
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = rows.length;

  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent =
    rows.length === totalAll
      ? `Showing all ${total} anomalies grouped by parser strategy.`
      : `Showing ${total} of ${totalAll} anomalies (filtered) grouped by parser strategy.`;
  host.appendChild(meta);

  const table = document.createElement('table');
  table.className = 'anomaly-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Kind', 'Count', 'Percentage']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const [kind, count] of grouped) {
    const tr = document.createElement('tr');
    const tdKind = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = kind;
    tdKind.appendChild(code);
    tr.appendChild(tdKind);

    const tdCount = document.createElement('td');
    tdCount.textContent = String(count);
    tdCount.className = 'anomaly-num';
    tr.appendChild(tdCount);

    const tdPct = document.createElement('td');
    tdPct.textContent = `${((count / total) * 100).toFixed(1)}%`;
    tdPct.className = 'anomaly-num';
    tr.appendChild(tdPct);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  host.appendChild(table);
}

function renderRecent(
  host: HTMLElement,
  meta: HTMLElement,
  moreWrap: HTMLElement,
  rows: IngestAnomaly[],
): void {
  host.replaceChildren();
  moreWrap.replaceChildren();

  // Newest first (createdAt desc); fall back to id desc when timestamps tie/missing.
  const sorted = [...rows].sort((a, b) => {
    const cmp = b.createdAt.localeCompare(a.createdAt);
    return cmp !== 0 ? cmp : b.id - a.id;
  });

  if (sorted.length === 0) {
    meta.textContent = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No matches for the current filters.';
    host.appendChild(p);
    return;
  }

  const state = { shown: Math.min(RECENT_PAGE_SIZE, sorted.length) };

  const renderPage = (): void => {
    host.replaceChildren();
    const slice = sorted.slice(0, state.shown);

    meta.textContent = `Showing ${slice.length} of ${sorted.length} (newest first).`;

    const scroller = document.createElement('div');
    scroller.className = 'anomaly-scroll';

    const table = document.createElement('table');
    table.className = 'anomaly-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['Kind', 'Reason / snippet', 'Source post', 'Captured at']) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of slice) tbody.appendChild(renderRow(row));
    table.appendChild(tbody);
    scroller.appendChild(table);
    host.appendChild(scroller);

    moreWrap.replaceChildren();
    if (state.shown < sorted.length) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'anomaly-more';
      const remaining = sorted.length - state.shown;
      btn.textContent = `Show ${Math.min(RECENT_PAGE_SIZE, remaining)} more`;
      btn.addEventListener('click', () => {
        state.shown = Math.min(state.shown + RECENT_PAGE_SIZE, sorted.length);
        renderPage();
      });
      moreWrap.appendChild(btn);
    }
  };

  renderPage();
}

function renderRow(a: IngestAnomaly): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const tdKind = document.createElement('td');
  const kindCode = document.createElement('code');
  kindCode.textContent = a.strategyAttempted;
  tdKind.appendChild(kindCode);
  tr.appendChild(tdKind);

  const tdReason = document.createElement('td');
  tdReason.className = 'anomaly-reason';
  const reasonDiv = document.createElement('div');
  reasonDiv.className = 'anomaly-reason-text';
  reasonDiv.textContent = a.reason;
  tdReason.appendChild(reasonDiv);
  if (a.rawLine) {
    const pre = document.createElement('pre');
    pre.className = 'anomaly-raw';
    pre.textContent = a.rawLine;
    tdReason.appendChild(pre);
  }
  tr.appendChild(tdReason);

  const tdSrc = document.createElement('td');
  tdSrc.className = 'anomaly-src';
  if (a.sourceUrl) {
    const link = document.createElement('a');
    link.href = a.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = a.sourcePostId || 'source';
    tdSrc.appendChild(link);
  } else {
    tdSrc.textContent = a.sourcePostId || '—';
  }
  if (a.parentGameId !== null) {
    const sep = document.createElement('span');
    sep.className = 'muted';
    sep.textContent = ' · ';
    tdSrc.appendChild(sep);
    const gameLink = document.createElement('a');
    gameLink.href = `#/games/${a.parentGameId}`;
    gameLink.textContent = `game #${a.parentGameId}`;
    tdSrc.appendChild(gameLink);
  }
  tr.appendChild(tdSrc);

  const tdWhen = document.createElement('td');
  tdWhen.className = 'anomaly-when';
  tdWhen.textContent = formatDateTime(a.createdAt);
  tr.appendChild(tdWhen);

  return tr;
}

function uniqueKindsSorted(rows: IngestAnomaly[]): string[] {
  const seen = new Set<ParserStrategy>();
  for (const r of rows) seen.add(r.strategyAttempted);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function computeDateRange(rows: IngestAnomaly[]): { first: string; last: string } | null {
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    if (!r.createdAt) continue;
    if (first === null || r.createdAt < first) first = r.createdAt;
    if (last === null || r.createdAt > last) last = r.createdAt;
  }
  if (first === null || last === null) return null;
  return { first, last };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- PIAA D1 cross-check tile ----

async function loadPiaa(subtitle: HTMLElement, body: HTMLElement): Promise<void> {
  let resp: PiaaMismatchResponse;
  try {
    resp = await getPiaaMismatches();
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
    subtitle.textContent = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = `Failed to load PIAA cross-check: ${msg}`;
    body.replaceChildren(p);
    return;
  }

  if (resp.summary.piaaTeamCount === 0) {
    subtitle.textContent = 'No PIAA snapshot yet — run `pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts`.';
    return;
  }

  subtitle.textContent = `Snapshot: ${formatDateTime(resp.fetchedAt)} · piaad1.org`;

  body.replaceChildren();
  const summaryTable = document.createElement('table');
  summaryTable.className = 'anomaly-table';
  const sthead = document.createElement('thead');
  const shr = document.createElement('tr');
  for (const label of ['Metric', 'Value']) {
    const th = document.createElement('th');
    th.textContent = label;
    shr.appendChild(th);
  }
  sthead.appendChild(shr);
  summaryTable.appendChild(sthead);
  const stbody = document.createElement('tbody');
  const rowsToShow: [string, number][] = [
    ['Our teams', resp.summary.ourTeamCount],
    ['PIAA teams', resp.summary.piaaTeamCount],
    ['Matched (by normalized name)', resp.summary.matched],
    ['Missing in our DB (PIAA has, we don’t)', resp.summary.missingInOurDb],
    ['Extra in our DB (we have, PIAA doesn’t)', resp.summary.extraInOurDb],
    ['W/L record mismatches', resp.summary.recordMismatches],
  ];
  for (const [k, v] of rowsToShow) {
    const tr = document.createElement('tr');
    const tdK = document.createElement('td');
    tdK.textContent = k;
    tr.appendChild(tdK);
    const tdV = document.createElement('td');
    tdV.className = 'anomaly-num';
    tdV.textContent = String(v);
    tr.appendChild(tdV);
    stbody.appendChild(tr);
  }
  summaryTable.appendChild(stbody);
  body.appendChild(summaryTable);

  body.appendChild(
    renderPiaaList(`Missing in our DB (${resp.missingInOurDb.length})`, () => {
      if (resp.missingInOurDb.length === 0) return [makeMuted('All PIAA teams matched. ✨')];
      return resp.missingInOurDb.map((m) => {
        const li = document.createElement('li');
        li.textContent = `${m.nameOfficial} — ${m.classification} · ranking ${m.ranking.toFixed(3)}`;
        return li;
      });
    }),
  );

  body.appendChild(
    renderPiaaList(`Extra in our DB (${resp.extraInOurDb.length})`, () => {
      if (resp.extraInOurDb.length === 0) return [makeMuted('Every team in our DB is on the PIAA list.')];
      return resp.extraInOurDb.map((e) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `#/teams/${e.teamId}`;
        link.textContent = e.teamName;
        li.appendChild(link);
        const meta = document.createElement('span');
        meta.className = 'muted';
        meta.textContent = ` — ${e.gamesInDb} game${e.gamesInDb === 1 ? '' : 's'} in DB`;
        li.appendChild(meta);
        return li;
      });
    }),
  );

  body.appendChild(
    renderPiaaList(`Record mismatches (${resp.recordMismatches.length})`, () => {
      if (resp.recordMismatches.length === 0) return [makeMuted('All matched teams agree on W/L. 🎯')];
      return resp.recordMismatches.map((m) => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `#/teams/${m.teamId}`;
        link.textContent = m.teamName;
        li.appendChild(link);
        const meta = document.createElement('span');
        meta.className = 'muted';
        meta.textContent =
          ` — ours ${m.ours.wins}-${m.ours.losses} · PIAA ${m.piaa.wins}-${m.piaa.losses} (${m.piaa.classification})`;
        li.appendChild(meta);
        return li;
      });
    }),
  );
}

function renderPiaaList(label: string, makeItems: () => HTMLElement[]): HTMLElement {
  const details = document.createElement('details');
  details.className = 'piaa-list';
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.appendChild(summary);
  const ul = document.createElement('ul');
  for (const item of makeItems()) ul.appendChild(item);
  details.appendChild(ul);
  return details;
}

function makeMuted(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}
