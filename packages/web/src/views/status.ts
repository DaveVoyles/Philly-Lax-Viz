// Wave H4 Lane 3 (Leia) — /status data freshness page.
//
// Fetches /api/freshness and /api/anomalies/summary and renders a single
// "Status" card showing last ingest timestamp (relative + absolute), counts
// of teams/games/players, the count of unresolved anomalies, and links to
// the /anomalies and /data-quality pages. Failures are rendered inline so
// the route never throws past render(); see status.test.ts.

import { apiUrl } from '../apiBase.js';
import { getFreshness } from '../api.js';

interface FreshnessResponse {
  scoreboardLast: string | null;
  recapsLast: string | null;
  rankingsLast: string | null;
  scheduleLast: string | null;
  piaaLast: string | null;
  aliasesLast: string | null;
  laxnumbersLast: string | null;
  lastIngestAt: string | null;
  counts: {
    teams: number;
    games: number;
    players: number;
    scheduleGames: number;
    playerAliases: number;
    piaaTeams: number;
    laxnumbersGames: number;
  };
  generatedAt: string;
}

interface AnomalySummaryLite {
  totalCount: number;
}

function relativeFromNow(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'unknown';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const ms = now - t;
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function absolute(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  const doc = root.ownerDocument ?? document;
  root.replaceChildren();

  const h1 = doc.createElement('h1');
  h1.textContent = 'Status';
  root.appendChild(h1);

  const sub = doc.createElement('p');
  sub.className = 'muted';
  sub.textContent = 'Data freshness, ingest counts, and outstanding anomalies.';
  root.appendChild(sub);

  const card = doc.createElement('section');
  card.className = 'tile';
  card.id = 'status-card';
  const loading = doc.createElement('p');
  loading.className = 'muted';
  loading.textContent = 'Loading…';
  card.appendChild(loading);
  root.appendChild(card);

  void loadStatus(card, doc);
}

async function loadStatus(card: HTMLElement, doc: Document): Promise<void> {
  let freshness: FreshnessResponse | null = null;
  let anomalies: AnomalySummaryLite | null = null;
  let error: string | null = null;

  try {
    freshness = await getFreshness() as FreshnessResponse;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  try {
    const aRes = await fetch(apiUrl('/api/anomalies/summary'));
    if (aRes.ok) anomalies = (await aRes.json()) as AnomalySummaryLite;
  } catch {
    // anomaly count is best-effort; freshness payload still renders.
  }

  card.replaceChildren();

  if (error && !freshness) {
    const p = doc.createElement('p');
    p.className = 'error';
    p.textContent = `Could not load freshness: ${error}`;
    card.appendChild(p);
    return;
  }

  const last = freshness?.lastIngestAt ?? null;

  const ingestHeader = doc.createElement('h2');
  ingestHeader.textContent = 'Last ingest';
  ingestHeader.style.cssText = 'margin:0 0 .25rem; font-size:1.1rem;';
  card.appendChild(ingestHeader);

  const ingestLine = doc.createElement('p');
  const rel = doc.createElement('strong');
  rel.textContent = relativeFromNow(last);
  ingestLine.appendChild(rel);
  const abs = doc.createElement('span');
  abs.className = 'muted';
  abs.textContent = `  (${absolute(last)})`;
  ingestLine.appendChild(abs);
  card.appendChild(ingestLine);

  const counts = freshness?.counts ?? { teams: 0, games: 0, players: 0 } as FreshnessResponse['counts'];
  const countsHeader = doc.createElement('h2');
  countsHeader.textContent = 'Counts';
  countsHeader.style.cssText = 'margin:1rem 0 .25rem; font-size:1.1rem;';
  card.appendChild(countsHeader);

  const ul = doc.createElement('ul');
  ul.style.cssText = 'list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:.5rem;';
  for (const [label, value] of [
    ['Teams', counts.teams],
    ['Games', counts.games],
    ['Players', counts.players],
  ] as const) {
    const li = doc.createElement('li');
    const k = doc.createElement('div');
    k.className = 'muted';
    k.textContent = label;
    const v = doc.createElement('div');
    v.style.cssText = 'font-size:1.5rem; font-weight:600;';
    v.textContent = String(value);
    li.appendChild(k);
    li.appendChild(v);
    ul.appendChild(li);
  }
  card.appendChild(ul);

  const anomalyHeader = doc.createElement('h2');
  anomalyHeader.textContent = 'Unresolved anomalies';
  anomalyHeader.style.cssText = 'margin:1rem 0 .25rem; font-size:1.1rem;';
  card.appendChild(anomalyHeader);

  const anomalyLine = doc.createElement('p');
  const count = anomalies?.totalCount ?? null;
  const strong = doc.createElement('strong');
  strong.textContent = count === null ? 'unknown' : String(count);
  anomalyLine.appendChild(strong);
  card.appendChild(anomalyLine);

  const links = doc.createElement('p');
  const a1 = doc.createElement('a');
  a1.href = '#/anomalies';
  a1.textContent = 'Browse anomalies';
  links.appendChild(a1);
  const sep = doc.createElement('span');
  sep.className = 'muted';
  sep.textContent = '  ·  ';
  links.appendChild(sep);
  const a2 = doc.createElement('a');
  a2.href = '#/data-quality';
  a2.textContent = 'Data quality dashboard';
  links.appendChild(a2);
  card.appendChild(links);

  if (freshness?.generatedAt) {
    const gen = doc.createElement('p');
    gen.className = 'muted';
    gen.style.cssText = 'margin-top:1rem; font-size:.85rem;';
    gen.textContent = `Snapshot generated at ${absolute(freshness.generatedAt)}.`;
    card.appendChild(gen);
  }
}

// Exported for unit tests.
export const __test = { relativeFromNow, absolute };
