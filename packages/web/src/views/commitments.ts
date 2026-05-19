import type { Commitment } from '@pll/shared';
import { ApiError, getCommitments } from '../api.js';
import { IS_STATIC, staticFetch, staticUnavailableNode } from '../staticLoader.js';
import { formatDate } from '../util/format.js';
import { setOgMeta } from '../util/ogMeta.js';
import { setPageTitle } from '../util/pageTitle.js';

const DIVISION_OPTIONS = ['All', 'D1', 'D2', 'D3', 'NAIA', 'MCLA'] as const;
const STATUS_OPTIONS = ['all', 'verbal', 'committed', 'signed', 'decommitted'] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number];

export function render(root: HTMLElement): void {
  setPageTitle('College Commitments');
  setOgMeta({
    title: 'College Commitments | PhillyLaxStats',
    description: 'Recent college commitments from Philly-area lacrosse players.',
    url: window.location.href,
  });

  root.replaceChildren();

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '← back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const heading = document.createElement('h1');
  heading.textContent = 'College Commitments';
  root.appendChild(heading);

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Track Philly-area players as they commit to the next level.';
  root.appendChild(intro);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:0.75rem;flex-wrap:wrap;align-items:end;margin:1rem 0 1.25rem;';
  const divisionSelect = buildSelect(
    'Division',
    DIVISION_OPTIONS.map((value) => ({ value, label: value })),
  );
  const statusSelect = buildSelect('Status', [
    { value: 'all', label: 'All' },
    { value: 'verbal', label: 'Verbal' },
    { value: 'committed', label: 'Committed' },
    { value: 'signed', label: 'Signed' },
    { value: 'decommitted', label: 'Decommitted' },
  ]);
  controls.append(divisionSelect.wrap, statusSelect.wrap);
  root.appendChild(controls);

  const loading = document.createElement('p');
  loading.textContent = 'Loading commitments...';
  root.appendChild(loading);

  const list = document.createElement('div');
  list.style.cssText = 'display:grid;gap:0.9rem;';
  root.appendChild(list);

  void load(loading, list, divisionSelect.select, statusSelect.select);
}

async function load(
  loading: HTMLElement,
  list: HTMLElement,
  divisionSelect: HTMLSelectElement,
  statusSelect: HTMLSelectElement,
): Promise<void> {
  let commitments: Commitment[];
  try {
    commitments = IS_STATIC
      ? await staticFetch<Commitment[]>('/data/commitments.json')
      : await getCommitments();
  } catch (error) {
    loading.remove();
    if (IS_STATIC) {
      list.replaceChildren(staticUnavailableNode('College Commitments'));
      return;
    }
    const message = error instanceof ApiError ? `${error.message} (${error.url})` : String(error);
    const failure = document.createElement('p');
    failure.className = 'error';
    failure.textContent = message;
    list.replaceChildren(failure);
    return;
  }

  loading.remove();

  const renderList = (): void => {
    const division = divisionSelect.value;
    const status = statusSelect.value as StatusFilter;
    const filtered = [...commitments]
      .filter((commitment) => division === 'All' || commitment.division === division)
      .filter((commitment) => status === 'all' || commitment.status === status)
      .sort((a, b) => sortDate(b) - sortDate(a));

    list.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No commitments match the current filters.';
      list.appendChild(empty);
      return;
    }

    for (const commitment of filtered) {
      list.appendChild(buildCard(commitment));
    }
  };

  divisionSelect.addEventListener('change', renderList);
  statusSelect.addEventListener('change', renderList);
  renderList();
}

function buildSelect(
  labelText: string,
  options: ReadonlyArray<{ value: string; label: string }>,
): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.35rem;font-size:0.9rem;';
  wrap.textContent = labelText;

  const select = document.createElement('select');
  select.style.cssText = 'min-width:140px;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid var(--border);background:var(--panel, rgba(255,255,255,0.02));color:inherit;';
  for (const option of options) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }
  wrap.appendChild(select);
  return { wrap, select };
}

function buildCard(commitment: Commitment): HTMLElement {
  const card = document.createElement('article');
  card.style.cssText = 'padding:1rem 1.1rem;border:1px solid var(--border);border-radius:14px;background:var(--bg-elev, rgba(255,255,255,0.02));display:grid;gap:0.55rem;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;flex-wrap:wrap;';

  const left = document.createElement('div');
  const playerLink = document.createElement('a');
  playerLink.href = `#/players/${commitment.playerId}`;
  playerLink.style.cssText = 'font-size:1.05rem;font-weight:700;color:inherit;text-decoration:none;';
  playerLink.textContent = commitment.playerName ?? `Player ${commitment.playerId}`;
  left.appendChild(playerLink);

  if (commitment.teamName) {
    const team = document.createElement('p');
    team.className = 'muted';
    team.style.margin = '0.2rem 0 0';
    team.textContent = commitment.teamName;
    left.appendChild(team);
  }

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;justify-content:flex-end;';
  right.appendChild(renderStatusBadge(commitment.status));
  if (commitment.verified) {
    right.appendChild(renderPill('✓ Verified', 'background:#183a21;color:#d9ffe5;'));
  }
  header.append(left, right);
  card.appendChild(header);

  const collegeLine = document.createElement('div');
  collegeLine.style.cssText = 'display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;';
  const college = document.createElement('strong');
  college.textContent = commitment.college;
  collegeLine.appendChild(college);
  if (commitment.division) {
    collegeLine.appendChild(renderPill(commitment.division, 'background:rgba(255,255,255,0.08);color:inherit;'));
  }
  card.appendChild(collegeLine);

  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.style.margin = '0';
  meta.textContent = commitment.commitDate
    ? `Committed on ${formatDate(commitment.commitDate)}`
    : `Added ${formatDate(commitment.createdAt)}`;
  card.appendChild(meta);

  return card;
}

function renderStatusBadge(status: Commitment['status']): HTMLElement {
  const styles: Record<Commitment['status'], string> = {
    verbal: 'background:#8a6b14;color:#fff4cc;',
    committed: 'background:#1f7a37;color:#e9ffef;',
    signed: 'background:#1d5fbf;color:#eef5ff;',
    decommitted: 'background:#8a2432;color:#ffe9ec;',
  };
  return renderPill(status, styles[status]);
}

function renderPill(text: string, style: string): HTMLElement {
  const pill = document.createElement('span');
  pill.textContent = text;
  pill.style.cssText = `display:inline-flex;align-items:center;padding:0.25rem 0.55rem;border-radius:999px;font-size:0.76rem;font-weight:700;text-transform:capitalize;${style}`;
  return pill;
}

function sortDate(commitment: Commitment): number {
  return Date.parse(commitment.commitDate ?? commitment.createdAt);
}
