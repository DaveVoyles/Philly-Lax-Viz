import type { TeamSeasonRecord } from '../../api.js';
import { renderEmptyState } from '../../components/emptyState.js';
import { renderTeamBadge } from '../../components/teamBadge.js';
import { wrapResponsive } from '../../util/responsiveTable.js';
import { buildStreakChip } from '../../util/streakChip.js';

type SortKey = 'name' | 'gap' | 'wins';
type SortDir = 'asc' | 'desc';
interface TeamSort { key: SortKey; dir: SortDir; }
interface TeamFilter { hideLowGames: boolean; minGames: number; }

export const PIAA_LEGEND_ROWS: ReadonlyArray<{
  icon: string;
  status: string;
  meaning: string;
}> = [
  { icon: '✅', status: 'match', meaning: 'Our derived W-L matches the official PIAA record exactly.' },
  { icon: '⚠️', status: 'close', meaning: 'Off by 1-2 games. Displayed record uses PIAA; the small gap is flagged for follow-up.' },
  { icon: '🔴', status: 'divergent', meaning: 'Material disagreement. Displayed record uses PIAA — investigate our coverage gap.' },
  { icon: '⚪', status: 'unmapped', meaning: 'No PIAA mapping (private/out-of-state, or not yet linked). Displayed record falls back to PhillyLacrosse-derived.' },
];

const SORT_OPTIONS: { value: string; key: SortKey; dir: SortDir; label: string }[] = [
  { value: 'wins-desc', key: 'wins', dir: 'desc', label: 'Wins (most first)' },
  { value: 'wins-asc', key: 'wins', dir: 'asc', label: 'Wins (least first)' },
  { value: 'name-asc', key: 'name', dir: 'asc', label: 'Name (A-Z)' },
  { value: 'name-desc', key: 'name', dir: 'desc', label: 'Name (Z-A)' },
  { value: 'gap-asc', key: 'gap', dir: 'asc', label: 'Data gap (smallest first)' },
  { value: 'gap-desc', key: 'gap', dir: 'desc', label: 'Data gap (largest first)' },
];

export function buildPiaaLegend(): HTMLElement {
  const details = document.createElement('details');
  details.className = 'piaa-legend';
  const summary = document.createElement('summary');
  summary.textContent = 'What do the icons and numbers mean?';
  details.appendChild(summary);

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent =
    'When the official PIAA record disagrees with our PhillyLacrosse-scraped record, ' +
    'PIAA always wins. Hover any team badge for the exact diff; click through to see the source.';
  details.appendChild(note);

  const table = document.createElement('table');
  table.className = 'piaa-legend__table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of ['Icon', 'Status', 'Meaning']) {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of PIAA_LEGEND_ROWS) {
    const tr = document.createElement('tr');
    const iconCell = document.createElement('td');
    iconCell.className = 'piaa-legend__icon';
    iconCell.textContent = row.icon;
    const statusCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = row.status;
    statusCell.appendChild(code);
    const meaningCell = document.createElement('td');
    meaningCell.textContent = row.meaning;
    tr.append(iconCell, statusCell, meaningCell);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(wrapResponsive(table));

  const gapHeading = document.createElement('p');
  gapHeading.style.cssText = 'margin: 0.75rem 0 0.25rem; font-weight: 600; font-size: 0.9rem;';
  gapHeading.textContent = 'The number on the right of each team row:';
  details.appendChild(gapHeading);

  const gapRows: { label: string; meaning: string }[] = [
    { label: '✓', meaning: 'All games accounted for — our count matches PIAA exactly.' },
    { label: '2, 3, …', meaning: 'We are missing that many games compared to the official PIAA total. The score or summary may not have been published yet.' },
    { label: '+1, +4, …', meaning: 'We have more games on file than PIAA lists — usually pre-season scrimmages or junior-varsity games picked up by the scraper.' },
    { label: '—', meaning: 'No PIAA reference data available for this team.' },
  ];

  const gapTable = document.createElement('table');
  gapTable.className = 'piaa-legend__table';
  const gapTbody = document.createElement('tbody');
  for (const row of gapRows) {
    const tr = document.createElement('tr');
    const labelCell = document.createElement('td');
    labelCell.className = 'piaa-legend__icon';
    labelCell.style.fontVariantNumeric = 'tabular-nums';
    labelCell.textContent = row.label;
    const meaningCell = document.createElement('td');
    meaningCell.setAttribute('colspan', '2');
    meaningCell.textContent = row.meaning;
    tr.append(labelCell, meaningCell);
    gapTbody.appendChild(tr);
  }
  gapTable.appendChild(gapTbody);
  details.appendChild(wrapResponsive(gapTable));

  return details;
}

export function renderTeamsGrid(target: HTMLElement, teams: TeamSeasonRecord[]): void {
  const sort: TeamSort = { key: 'wins', dir: 'desc' };
  const filter: TeamFilter = { hideLowGames: true, minGames: 6 };
  const rerender = (): void => {
    target.replaceChildren(buildTeamsGrid(teams, sort, filter, {
      onSort: (next) => {
        sort.key = next.key;
        sort.dir = next.dir;
        rerender();
      },
      onFilter: (next) => {
        filter.hideLowGames = next.hideLowGames;
        filter.minGames = next.minGames;
        rerender();
      },
    }));
  };
  rerender();
}

function sortTeams(teams: TeamSeasonRecord[], sort: TeamSort): TeamSeasonRecord[] {
  const out = [...teams];
  const factor = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'name') {
    out.sort((a, b) => factor * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return out;
  }
  if (sort.key === 'wins') {
    out.sort((a, b) => {
      const aw = a.wins ?? 0;
      const bw = b.wins ?? 0;
      if (aw !== bw) return factor * (bw - aw);
      const ag = (a.wins ?? 0) + (a.losses ?? 0);
      const bg = (b.wins ?? 0) + (b.losses ?? 0);
      const apct = ag > 0 ? aw / ag : 0;
      const bpct = bg > 0 ? bw / bg : 0;
      if (apct !== bpct) return factor * (bpct - apct);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return out;
  }
  out.sort((a, b) => {
    const ag = a.coverage?.gap ?? null;
    const bg = b.coverage?.gap ?? null;
    if (ag === null && bg === null) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
    if (ag === null) return 1;
    if (bg === null) return -1;
    if (ag === bg) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return factor * (ag - bg);
  });
  return out;
}

function buildTeamsGrid(
  teams: TeamSeasonRecord[],
  sort: TeamSort,
  filter: TeamFilter,
  callbacks: {
    onSort: (next: TeamSort) => void;
    onFilter: (next: TeamFilter) => void;
  },
): HTMLElement {
  const wrap = document.createElement('div');
  if (teams.length === 0) {
    wrap.appendChild(
      renderEmptyState({
        subject: 'teams',
        hint: 'Try a different season, or run `pnpm ingest` to populate the database.',
      }),
    );
    return wrap;
  }

  const controls = document.createElement('div');
  controls.className = 'teams-controls';
  const label = document.createElement('label');
  label.className = 'muted';
  label.textContent = 'Sort: ';
  const select = document.createElement('select');
  select.className = 'teams-sort';
  for (const opt of SORT_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.key === sort.key && opt.dir === sort.dir) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    const picked = SORT_OPTIONS.find((option) => option.value === select.value);
    if (picked) callbacks.onSort({ key: picked.key, dir: picked.dir });
  });
  label.appendChild(select);
  controls.appendChild(label);

  const filterLabel = document.createElement('label');
  filterLabel.className = 'muted teams-filter';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = filter.hideLowGames;
  cb.addEventListener('change', () => {
    callbacks.onFilter({ hideLowGames: cb.checked, minGames: filter.minGames });
  });
  filterLabel.appendChild(cb);
  filterLabel.append(' Hide teams with fewer than ');
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.min = '1';
  minInput.max = '50';
  minInput.value = String(filter.minGames);
  minInput.className = 'teams-filter__min';
  minInput.addEventListener('change', () => {
    const nextMin = Math.max(1, Math.min(50, Number.parseInt(minInput.value, 10) || filter.minGames));
    callbacks.onFilter({ hideLowGames: filter.hideLowGames, minGames: nextMin });
  });
  filterLabel.appendChild(minInput);
  filterLabel.append(' games');
  controls.appendChild(filterLabel);

  const visible = filter.hideLowGames
    ? teams.filter((team) => teamGameCount(team) >= filter.minGames)
    : teams;
  const count = document.createElement('span');
  count.className = 'muted';
  count.textContent =
    visible.length === teams.length
      ? ` ${teams.length} teams`
      : ` ${visible.length} of ${teams.length} teams`;
  controls.appendChild(count);
  wrap.appendChild(controls);

  const sorted = sortTeams(visible, sort);
  const ul = document.createElement('ul');
  ul.className = 'team-grid';
  for (const team of sorted) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#/teams/${team.id}`;
    if (isValidHexColor(team.primaryColor)) {
      a.style.borderLeft = `4px solid ${team.primaryColor}`;
    }
    a.appendChild(renderTeamBadge({ name: team.name, logoUrl: team.logoUrl, primaryColor: team.primaryColor, size: 'sm' }));
    a.appendChild(buildGapBadge(team));
    if ((team.wins ?? 0) + (team.losses ?? 0) > 0) {
      const rec = document.createElement('span');
      rec.className = 'team-row__record';
      rec.textContent = `${team.wins ?? 0}–${team.losses ?? 0}`;
      rec.title = `${team.wins ?? 0} wins, ${team.losses ?? 0} losses`;
      a.appendChild(rec);
    }
    const streakChip = buildStreakChip(team.streak);
    if (streakChip) a.appendChild(streakChip);
    li.appendChild(a);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

function isValidHexColor(color: string | null | undefined): color is string {
  return !!color && /^#[0-9a-fA-F]{3,6}$/.test(color);
}

export function teamGameCount(team: TeamSeasonRecord): number {
  const ours = team.coverage?.ourGames;
  if (typeof ours === 'number') return ours;
  return (team.wins ?? 0) + (team.losses ?? 0);
}

function buildGapBadge(team: TeamSeasonRecord): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'team-row__gap';
  const cov = team.coverage;
  if (!cov || cov.piaaGames === null || cov.gap === null) {
    span.textContent = '—';
    span.classList.add('team-row__gap--unknown');
    span.title = 'No PIAA reference data for this team';
    return span;
  }
  const ours = cov.ourGames;
  const piaa = cov.piaaGames;
  if (cov.gap === 0) {
    span.textContent = '✓';
    span.classList.add('team-row__gap--complete');
    span.title = `${ours} of ${piaa} games tracked`;
  } else if (cov.gap > 0) {
    span.textContent = String(cov.gap);
    span.classList.add('team-row__gap--missing');
    span.title = `${ours} of ${piaa} games tracked (${cov.gap} missing vs PIAA)`;
  } else {
    span.textContent = `+${Math.abs(cov.gap)}`;
    span.classList.add('team-row__gap--extra');
    span.title = `${ours} games tracked vs ${piaa} on PIAA (extra: scrimmages or non-varsity)`;
  }
  return span;
}
