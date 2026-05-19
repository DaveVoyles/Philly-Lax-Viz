import type { CoachDashboardResponse } from '@pll/shared';
import { ApiError, getCoachDashboard, getTeams, type TeamSeasonRecord } from '../api.js';
import { currentSeason } from '../components/seasonPicker.js';
import { IS_STATIC, staticUnavailableNode } from '../staticLoader.js';
import { formatDate } from '../util/format.js';
import { setOgMeta } from '../util/ogMeta.js';

const STORAGE_KEY = 'pll-coach-team';

function readStoredTeamId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredTeamId(teamId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, teamId);
  } catch {
    // Ignore storage failures so the dashboard still works in private browsing.
  }
}

function seasonLabel(): string {
  const season = currentSeason();
  return typeof season === 'number' ? `Season ${season}` : 'All seasons';
}

function formatTimestamp(value: string): string {
  if (!value) return 'Unknown';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();
  setOgMeta({
    title: 'Coach Dashboard | PhillyLaxStats',
    description: 'Review team stat coverage gaps, roster gaps, and coach upload actions.',
  });

  if (IS_STATIC) {
    root.appendChild(staticUnavailableNode('Coach Dashboard'));
    return;
  }

  const back = document.createElement('p');
  back.className = 'muted';
  const backLink = document.createElement('a');
  backLink.href = '#/';
  backLink.textContent = '<- back to dashboard';
  back.appendChild(backLink);
  root.appendChild(back);

  const heading = document.createElement('h1');
  heading.textContent = 'Coach Dashboard';
  root.appendChild(heading);

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Pick a team to review missing stat coverage before uploading a new spreadsheet.';
  root.appendChild(intro);

  const selectorCard = document.createElement('section');
  selectorCard.className = 'tile';
  selectorCard.style.padding = '1rem';
  root.appendChild(selectorCard);

  const selectorLabel = document.createElement('label');
  selectorLabel.textContent = 'Team';
  selectorLabel.style.display = 'block';
  selectorLabel.style.marginBottom = '0.5rem';
  selectorCard.appendChild(selectorLabel);

  const teamSelect = document.createElement('select');
  teamSelect.disabled = true;
  teamSelect.style.minWidth = '260px';
  teamSelect.style.maxWidth = '100%';
  selectorCard.appendChild(teamSelect);

  const selectorNotice = document.createElement('p');
  selectorNotice.className = 'muted';
  selectorNotice.style.marginTop = '0.75rem';
  selectorNotice.textContent = 'Loading teams...';
  selectorCard.appendChild(selectorNotice);

  const content = document.createElement('div');
  content.style.marginTop = '1rem';
  root.appendChild(content);

  let teams: TeamSeasonRecord[] = [];
  let selectedTeamId = readStoredTeamId();

  function populateTeams(): void {
    teamSelect.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a team';
    placeholder.disabled = true;
    placeholder.selected = !selectedTeamId;
    teamSelect.appendChild(placeholder);

    for (const team of teams) {
      const option = document.createElement('option');
      option.value = String(team.id);
      option.textContent = team.name;
      option.selected = option.value === selectedTeamId;
      teamSelect.appendChild(option);
    }

    teamSelect.disabled = false;
  }

  function renderEmptyState(message: string): void {
    content.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = message;
    content.appendChild(empty);
  }

  function buildMetricCard(label: string, value: string, subtext?: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'record-callout';
    card.style.minWidth = '220px';

    const labelEl = document.createElement('span');
    labelEl.className = 'callout-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'callout-value';
    valueEl.textContent = value;

    card.append(labelEl, valueEl);

    if (subtext) {
      const note = document.createElement('span');
      note.className = 'muted';
      note.style.fontSize = '0.85rem';
      note.textContent = subtext;
      card.appendChild(note);
    }

    return card;
  }

  function renderDashboard(data: CoachDashboardResponse): void {
    content.replaceChildren();
    setOgMeta({
      title: `${data.team.name} Coach Dashboard | PhillyLaxStats`,
      description: `Review missing stat coverage and roster gaps for ${data.team.name}.`,
      url: window.location.href,
    });

    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = `Last updated: ${formatTimestamp(data.lastUpdated)}`;
    content.appendChild(meta);

    const cardRow = document.createElement('div');
    cardRow.className = 'callout-row';
    content.appendChild(cardRow);

    cardRow.appendChild(buildMetricCard('Record', `${data.team.record} (${seasonLabel()})`));

    const pct = data.gamesTotal > 0 ? Math.round((data.gamesWithStats / data.gamesTotal) * 100) : 0;
    const coverageCard = document.createElement('div');
    coverageCard.className = 'record-callout';
    coverageCard.style.minWidth = '260px';

    const coverageLabel = document.createElement('span');
    coverageLabel.className = 'callout-label';
    coverageLabel.textContent = 'Data Coverage';
    const coverageValue = document.createElement('span');
    coverageValue.className = 'callout-value';
    coverageValue.textContent = `Stats recorded for ${data.gamesWithStats}/${data.gamesTotal} games`;
    coverageCard.append(coverageLabel, coverageValue);

    const progressTrack = document.createElement('div');
    progressTrack.style.cssText = 'margin-top:0.5rem;height:10px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;';
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),#7dd3fc);`;
    progressTrack.appendChild(progressBar);
    coverageCard.appendChild(progressTrack);

    const coverageNote = document.createElement('span');
    coverageNote.className = 'muted';
    coverageNote.style.fontSize = '0.85rem';
    coverageNote.textContent = `${data.gamesWithoutStats} game${data.gamesWithoutStats === 1 ? '' : 's'} still need player stats.`;
    coverageCard.appendChild(coverageNote);
    cardRow.appendChild(coverageCard);

    const quickCard = document.createElement('div');
    quickCard.className = 'record-callout';
    quickCard.style.minWidth = '220px';
    const quickLabel = document.createElement('span');
    quickLabel.className = 'callout-label';
    quickLabel.textContent = 'Quick Actions';
    quickCard.appendChild(quickLabel);
    const uploadLink = document.createElement('a');
    uploadLink.href = data.uploadUrl;
    uploadLink.textContent = 'Upload team stats';
    const divider = document.createTextNode(' | ');
    const teamLink = document.createElement('a');
    teamLink.href = `#/teams/${data.team.id}`;
    teamLink.textContent = 'Open team detail';
    quickCard.append(uploadLink, divider, teamLink);
    cardRow.appendChild(quickCard);

    const missingSection = document.createElement('section');
    missingSection.className = 'tile';
    missingSection.style.padding = '1rem';
    missingSection.style.marginTop = '1rem';
    content.appendChild(missingSection);

    const missingHeading = document.createElement('h2');
    missingHeading.textContent = 'Missing Games';
    missingSection.appendChild(missingHeading);

    const missingIntro = document.createElement('p');
    missingIntro.className = 'muted';
    missingIntro.textContent = 'These completed games do not have any player stat rows for the selected team.';
    missingSection.appendChild(missingIntro);

    if (data.missingStatGames.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No gaps found. Every completed game has at least one stat row.';
      missingSection.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'data-table';
      table.innerHTML = '<thead><tr><th>Date</th><th>Opponent</th><th>Action</th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const game of data.missingStatGames) {
        const row = document.createElement('tr');
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(game.date);
        const opponentCell = document.createElement('td');
        opponentCell.textContent = game.opponent;
        const actionCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = data.uploadUrl;
        link.textContent = 'Upload Stats';
        actionCell.appendChild(link);
        row.append(dateCell, opponentCell, actionCell);
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      missingSection.appendChild(table);
    }

    const playerSection = document.createElement('section');
    playerSection.className = 'tile';
    playerSection.style.padding = '1rem';
    playerSection.style.marginTop = '1rem';
    content.appendChild(playerSection);

    const playerHeading = document.createElement('h2');
    playerHeading.textContent = 'Players Missing Stats';
    playerSection.appendChild(playerHeading);

    const playerIntro = document.createElement('p');
    playerIntro.className = 'muted';
    playerIntro.textContent = `${data.playersWithNoStats.length} of ${data.playerCount} rostered players do not have a stat line yet.`;
    playerSection.appendChild(playerIntro);

    if (data.playersWithNoStats.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Every rostered player has appeared in at least one stat row.';
      playerSection.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.style.margin = '0';
    list.style.paddingLeft = '1.25rem';
    for (const player of data.playersWithNoStats) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#/players/${player.id}`;
      link.textContent = player.name;
      item.appendChild(link);
      list.appendChild(item);
    }
    playerSection.appendChild(list);
  }

  async function loadDashboard(teamId: string): Promise<void> {
    if (!teamId) {
      renderEmptyState('Select a team to load its dashboard.');
      return;
    }

    renderEmptyState('Loading coach dashboard...');
    try {
      const data = await getCoachDashboard(teamId);
      renderDashboard(data);
    } catch (error) {
      const message = error instanceof ApiError ? `${error.message} (${error.url})` : String(error);
      renderEmptyState(`Unable to load coach dashboard: ${message}`);
    }
  }

  teamSelect.addEventListener('change', () => {
    selectedTeamId = teamSelect.value;
    if (!selectedTeamId) return;
    writeStoredTeamId(selectedTeamId);
    selectorNotice.textContent = `Saved ${teamSelect.selectedOptions[0]?.textContent ?? 'team'} for future visits.`;
    void loadDashboard(selectedTeamId);
  });

  void (async () => {
    try {
      teams = (await getTeams()).slice().sort((left, right) => left.name.localeCompare(right.name));
      if (selectedTeamId && !teams.some((team) => String(team.id) === selectedTeamId)) {
        selectedTeamId = '';
      }
      populateTeams();
      selectorNotice.textContent = selectedTeamId
        ? 'Loaded your saved team selection.'
        : 'Choose a team to review missing stat coverage.';
      if (selectedTeamId) {
        teamSelect.value = selectedTeamId;
        void loadDashboard(selectedTeamId);
      } else {
        renderEmptyState('Select a team to load its dashboard.');
      }
    } catch (error) {
      const message = error instanceof ApiError ? `${error.message} (${error.url})` : String(error);
      selectorNotice.textContent = `Unable to load teams: ${message}`;
      renderEmptyState('Coach dashboard is unavailable until the team list loads.');
    }
  })();
}
