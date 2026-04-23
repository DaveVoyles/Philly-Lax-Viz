// schedule.ts — Wave 16 Lane 2 (Leia). Upcoming-games view, lazy-loaded
// from main.ts. Renders a grouped-by-date list using the /api/schedule
// endpoint. Default window: from today, no upper bound (server caps at
// 1000 rows; we additionally show only the next 14 days unless the user
// expands).

import { ApiError, getSchedule, type ScheduleByDate } from '../api.js';
import { formatDate } from '../util/format.js';

let abort: AbortController | null = null;

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function destroy(): void {
  if (abort) {
    abort.abort();
    abort = null;
  }
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  destroy();
  abort = new AbortController();
  root.replaceChildren();

  const heading = document.createElement('h1');
  heading.textContent = 'Schedule — upcoming games';
  root.appendChild(heading);

  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.textContent =
    'Upcoming Boys Lacrosse games from PIAA District 1 schedule export. Refreshed by the schedule ingest.';
  root.appendChild(sub);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex; gap:0.75rem; margin:0.75rem 0 1rem; align-items:center;';
  const label = document.createElement('label');
  label.textContent = 'Window: ';
  label.style.cssText = 'font-size:0.9rem;';
  const select = document.createElement('select');
  for (const opt of [
    { v: '14', t: 'Next 14 days' },
    { v: '30', t: 'Next 30 days' },
    { v: '0', t: 'All upcoming' },
  ]) {
    const o = document.createElement('option');
    o.value = opt.v;
    o.textContent = opt.t;
    select.appendChild(o);
  }
  label.appendChild(select);
  controls.appendChild(label);
  root.appendChild(controls);

  const status = document.createElement('p');
  status.textContent = 'Loading…';
  root.appendChild(status);

  const list = document.createElement('div');
  list.className = 'schedule-list';
  root.appendChild(list);

  const reload = (): void => {
    const days = Number(select.value);
    const params: { from: string; to?: string } = { from: todayIso() };
    if (days > 0) params.to = todayPlusDays(days);
    void load(list, status, params);
  };
  select.addEventListener('change', reload);
  reload();
}

async function load(
  list: HTMLElement,
  status: HTMLElement,
  params: { from: string; to?: string },
): Promise<void> {
  list.replaceChildren();
  status.textContent = 'Loading…';
  status.className = 'muted';
  try {
    const res = await getSchedule(params);
    if (res.total === 0) {
      status.textContent =
        'No upcoming games scheduled in this window. Run `pnpm --filter @pll/ingest exec tsx src/cli/ingest.ts --schedule` to refresh.';
      return;
    }
    status.textContent = `${res.total} upcoming game${res.total === 1 ? '' : 's'}.`;
    // Wave H4 Lane 4 (Chewy): default to newest-game-first (descending by date).
    const ordered = [...res.byDate].sort((a, b) => b.date.localeCompare(a.date));
    for (const day of ordered) {
      list.appendChild(renderDay(day));
    }
  } catch (err) {
    status.className = 'error';
    status.textContent = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
  }
}

function renderDay(day: ScheduleByDate): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'schedule-day';
  wrap.style.cssText = 'margin:1.25rem 0;';

  const h = document.createElement('h2');
  h.textContent = formatDate(day.date);
  h.style.cssText = 'font-size:1.05rem; margin:0 0 0.5rem; color:var(--muted, #888);';
  wrap.appendChild(h);

  const ul = document.createElement('ul');
  ul.style.cssText = 'list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.4rem;';
  for (const g of day.games) {
    const li = document.createElement('li');
    li.style.cssText =
      'display:flex; align-items:center; justify-content:space-between; gap:0.75rem; padding:0.55rem 0.75rem; border:1px solid var(--border, #2a2a2a); border-radius:6px; background:var(--card-bg, #181818);';

    const matchup = document.createElement('div');
    matchup.style.cssText = 'display:flex; align-items:center; gap:0.5rem; font-weight:500;';
    matchup.appendChild(teamLink(g.awayTeamName, g.awayTeamSlug ?? g.awayTeamId));
    const at = document.createElement('span');
    at.textContent = ' at ';
    at.className = 'muted';
    matchup.appendChild(at);
    matchup.appendChild(teamLink(g.homeTeamName, g.homeTeamSlug ?? g.homeTeamId));

    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.style.cssText = 'font-size:0.85rem;';
    meta.textContent = g.source;

    li.appendChild(matchup);
    li.appendChild(meta);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function teamLink(name: string, idOrSlug: string | number | null): HTMLElement {
  if (idOrSlug == null) {
    const span = document.createElement('span');
    span.textContent = name;
    return span;
  }
  const a = document.createElement('a');
  a.textContent = name;
  a.href = `#/teams/${encodeURIComponent(String(idOrSlug))}`;
  return a;
}
