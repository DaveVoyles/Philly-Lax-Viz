import type { CoachDashboardResponse } from '@pll/shared';
import {
  ApiError,
  getCoachDashboard,
  getCoachPracticeFocus,
  getCoachScouting,
  getCoachTrends,
  getTeamUpcoming,
  getTeams,
  type CoachPracticeFocus,
  type CoachScoutingReport,
  type CoachTrendsResponse,
  type TeamSeasonRecord,
} from '../api.js';
import { renderCoachTrendsChart } from '../charts/coachTrends.js';
import { currentSeason } from '../components/seasonPicker.js';
import { IS_STATIC, staticUnavailableNode } from '../staticLoader.js';
import { formatDate } from '../util/format.js';
import { setOgMeta } from '../util/ogMeta.js';

const STORAGE_KEY = 'pll-coach-team';

interface InsightState {
  trends: CoachTrendsResponse | null;
  trendsError: string | null;
  practice: CoachPracticeFocus | null;
  practiceError: string | null;
  nextOpponentId: string;
}

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

function selectedSeason(): number | undefined {
  const season = currentSeason();
  return typeof season === 'number' ? season : undefined;
}

function formatTimestamp(value: string): string {
  if (!value) return 'Unknown';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function formatError(error: unknown): string {
  return error instanceof ApiError ? `${error.message} (${error.url})` : String(error);
}

function buildSection(title: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tile';
  section.style.padding = '1rem';
  section.style.marginTop = '1rem';

  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);
  return section;
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

function buildTable(headers: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const header of headers) {
    const cell = document.createElement('th');
    cell.textContent = header;
    headerRow.appendChild(cell);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);
  table.appendChild(document.createElement('tbody'));
  return table;
}

function tableBody(table: HTMLTableElement): HTMLTableSectionElement {
  return table.tBodies[0] ?? table.createTBody();
}

function appendTextCell(row: HTMLTableRowElement, text: string): void {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.appendChild(cell);
}

function appendNodeCell(row: HTMLTableRowElement, node: Node): void {
  const cell = document.createElement('td');
  cell.appendChild(node);
  row.appendChild(cell);
}

function priorityColors(priority: 'high' | 'medium' | 'low'): { background: string; foreground: string } {
  if (priority === 'high') return { background: 'rgba(248, 113, 113, 0.18)', foreground: '#f87171' };
  if (priority === 'medium') return { background: 'rgba(250, 204, 21, 0.18)', foreground: '#facc15' };
  return { background: 'rgba(74, 222, 128, 0.18)', foreground: '#4ade80' };
}

function resolveNextOpponentId(teamId: number, upcoming: Awaited<ReturnType<typeof getTeamUpcoming>> | null): string {
  const nextGame = upcoming?.games[0];
  if (!nextGame) return '';
  if (nextGame.homeTeamId === teamId && nextGame.awayTeamId) return String(nextGame.awayTeamId);
  if (nextGame.awayTeamId === teamId && nextGame.homeTeamId) return String(nextGame.homeTeamId);
  return '';
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
  let activeDashboardLoad = 0;

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

  function renderTrendsSection(section: HTMLElement, insights: InsightState): void {
    const introText = document.createElement('p');
    introText.className = 'muted';
    introText.textContent = 'Goals for and against over the most recent 10 games.';
    section.appendChild(introText);

    if (insights.trendsError) {
      const errorText = document.createElement('p');
      errorText.className = 'muted';
      errorText.textContent = `Trend data is unavailable: ${insights.trendsError}`;
      section.appendChild(errorText);
      return;
    }

    const points = insights.trends?.trends ?? [];
    if (points.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No trend data is available yet.';
      section.appendChild(empty);
      return;
    }

    const chartHost = document.createElement('div');
    chartHost.style.width = '100%';
    chartHost.style.minHeight = '200px';
    chartHost.style.marginBottom = '1rem';
    section.appendChild(chartHost);
    renderCoachTrendsChart(chartHost, points);

    const table = buildTable(['Date', 'Opponent', 'GF', 'GA', 'Assists', 'GBs']);
    const tbody = tableBody(table);
    for (const point of points) {
      const row = document.createElement('tr');
      appendTextCell(row, formatDate(point.date));
      appendTextCell(row, point.opponent);
      appendTextCell(row, String(point.goalsFor));
      appendTextCell(row, String(point.goalsAgainst));
      appendTextCell(row, String(point.assists));
      appendTextCell(row, String(point.groundBalls));
      tbody.appendChild(row);
    }
    section.appendChild(table);
  }

  function renderPracticeSection(section: HTMLElement, insights: InsightState): void {
    const introText = document.createElement('p');
    introText.className = 'muted';
    introText.textContent = 'Auto-generated focus areas based on the selected team\'s recent games.';
    section.appendChild(introText);

    if (insights.practiceError) {
      const errorText = document.createElement('p');
      errorText.className = 'muted';
      errorText.textContent = `Practice focus suggestions are unavailable: ${insights.practiceError}`;
      section.appendChild(errorText);
      return;
    }

    const suggestions = insights.practice?.suggestions ?? [];
    if (suggestions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No practice suggestions are available yet.';
      section.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexWrap = 'wrap';
    wrap.style.gap = '0.75rem';
    section.appendChild(wrap);

    for (const suggestion of suggestions) {
      const card = document.createElement('div');
      card.style.flex = '1 1 250px';
      card.style.minWidth = '250px';
      card.style.padding = '0.9rem';
      card.style.border = '1px solid rgba(255,255,255,0.08)';
      card.style.borderRadius = '12px';
      card.style.background = 'rgba(255,255,255,0.03)';

      const badge = document.createElement('span');
      const colors = priorityColors(suggestion.priority);
      badge.textContent = suggestion.priority.toUpperCase();
      badge.style.display = 'inline-flex';
      badge.style.padding = '0.15rem 0.5rem';
      badge.style.borderRadius = '999px';
      badge.style.fontSize = '0.72rem';
      badge.style.fontWeight = '700';
      badge.style.letterSpacing = '0.04em';
      badge.style.background = colors.background;
      badge.style.color = colors.foreground;
      card.appendChild(badge);

      const area = document.createElement('p');
      area.style.margin = '0.75rem 0 0.35rem';
      area.style.fontWeight = '700';
      area.textContent = suggestion.area;
      card.appendChild(area);

      const reason = document.createElement('p');
      reason.className = 'muted';
      reason.style.margin = '0';
      reason.textContent = suggestion.reason;
      card.appendChild(reason);

      wrap.appendChild(card);
    }
  }

  function renderSmallTable(
    host: HTMLElement,
    title: string,
    headers: string[],
    rows: Array<Array<string>>,
    emptyMessage: string,
  ): void {
    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.style.marginTop = '1rem';
    host.appendChild(heading);

    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = emptyMessage;
      host.appendChild(empty);
      return;
    }

    const table = buildTable(headers);
    const tbody = tableBody(table);
    for (const values of rows) {
      const row = document.createElement('tr');
      for (const value of values) appendTextCell(row, value);
      tbody.appendChild(row);
    }
    host.appendChild(table);
  }

  function renderScoutingReport(host: HTMLElement, report: CoachScoutingReport): void {
    host.replaceChildren();

    const cardRow = document.createElement('div');
    cardRow.className = 'callout-row';
    cardRow.appendChild(buildMetricCard('Opponent Record', report.opponent.record));
    cardRow.appendChild(buildMetricCard('Avg Goals For', report.avgGoalsFor.toFixed(1)));
    cardRow.appendChild(buildMetricCard('Avg Goals Against', report.avgGoalsAgainst.toFixed(1)));
    host.appendChild(cardRow);

    renderSmallTable(
      host,
      'Last 5 Games',
      ['Date', 'Opponent', 'Score', 'Result'],
      report.last5Games.map((game) => [formatDate(game.date), game.opponent, game.score, game.result]),
      'No recent games found.',
    );

    renderSmallTable(
      host,
      'Top 3 Scorers',
      ['Player', 'Goals', 'Assists'],
      report.topScorers.slice(0, 3).map((player) => [player.name, String(player.goals), String(player.assists)]),
      'No scorer data found.',
    );

    renderSmallTable(
      host,
      'Head-to-Head History',
      ['Date', 'Score', 'Result'],
      report.h2h.map((game) => [formatDate(game.date), game.score, game.result]),
      'No head-to-head games found.',
    );
  }

  function renderDashboard(data: CoachDashboardResponse, insights: InsightState, loadId: number): void {
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

    const missingSection = buildSection('Missing Games');
    content.appendChild(missingSection);

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
      const table = buildTable(['Date', 'Opponent', 'Action']);
      const tbody = tableBody(table);
      for (const game of data.missingStatGames) {
        const row = document.createElement('tr');
        appendTextCell(row, formatDate(game.date));
        appendTextCell(row, game.opponent);
        const link = document.createElement('a');
        link.href = data.uploadUrl;
        link.textContent = 'Upload Stats';
        appendNodeCell(row, link);
        tbody.appendChild(row);
      }
      missingSection.appendChild(table);
    }

    const playerSection = buildSection('Players Missing Stats');
    content.appendChild(playerSection);

    const playerIntro = document.createElement('p');
    playerIntro.className = 'muted';
    playerIntro.textContent = `${data.playersWithNoStats.length} of ${data.playerCount} rostered players do not have a stat line yet.`;
    playerSection.appendChild(playerIntro);

    if (data.playersWithNoStats.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Every rostered player has appeared in at least one stat row.';
      playerSection.appendChild(empty);
    } else {
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

    const trendsSection = buildSection('Performance Trends (Last 10 Games)');
    content.appendChild(trendsSection);
    renderTrendsSection(trendsSection, insights);

    const practiceSection = buildSection('Practice Focus Suggestions');
    content.appendChild(practiceSection);
    renderPracticeSection(practiceSection, insights);

    const scoutingSection = buildSection('Scouting Report');
    content.appendChild(scoutingSection);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.gap = '0.75rem';
    controls.style.alignItems = 'center';
    scoutingSection.appendChild(controls);

    const opponentLabel = document.createElement('label');
    opponentLabel.textContent = 'Opponent';
    opponentLabel.style.fontWeight = '600';
    controls.appendChild(opponentLabel);

    const opponentSelect = document.createElement('select');
    opponentSelect.style.minWidth = '240px';
    opponentSelect.style.maxWidth = '100%';
    controls.appendChild(opponentSelect);

    const scoutingHint = document.createElement('p');
    scoutingHint.className = 'muted';
    scoutingHint.style.marginTop = '0.75rem';
    scoutingSection.appendChild(scoutingHint);

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select an opponent';
    placeholder.disabled = true;
    placeholder.selected = !insights.nextOpponentId;
    opponentSelect.appendChild(placeholder);

    for (const team of teams) {
      if (String(team.id) === String(data.team.id)) continue;
      const option = document.createElement('option');
      option.value = String(team.id);
      option.textContent = team.name;
      option.selected = option.value === insights.nextOpponentId;
      opponentSelect.appendChild(option);
    }

    const nextOpponentName = teams.find((team) => String(team.id) === insights.nextOpponentId)?.name ?? '';
    scoutingHint.textContent = nextOpponentName
      ? `Prefilled with the next scheduled opponent: ${nextOpponentName}.`
      : 'Select an opponent to load their recent form and head-to-head results.';

    const scoutingBody = document.createElement('div');
    scoutingSection.appendChild(scoutingBody);

    let activeScoutingLoad = 0;
    async function loadScoutingReport(opponentId: string): Promise<void> {
      if (!opponentId) {
        scoutingBody.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'Select an opponent to load the scouting report.';
        scoutingBody.appendChild(empty);
        return;
      }

      const scoutingLoadId = ++activeScoutingLoad;
      scoutingBody.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'muted';
      loading.textContent = 'Loading scouting report...';
      scoutingBody.appendChild(loading);

      try {
        const report = await getCoachScouting(Number(data.team.id), Number(opponentId), selectedSeason());
        if (loadId !== activeDashboardLoad || scoutingLoadId !== activeScoutingLoad) return;
        renderScoutingReport(scoutingBody, report);
      } catch (error) {
        if (loadId !== activeDashboardLoad || scoutingLoadId !== activeScoutingLoad) return;
        scoutingBody.replaceChildren();
        const failure = document.createElement('p');
        failure.className = 'muted';
        failure.textContent = `Scouting report is unavailable: ${formatError(error)}`;
        scoutingBody.appendChild(failure);
      }
    }

    opponentSelect.addEventListener('change', () => {
      scoutingHint.textContent = opponentSelect.value
        ? `Showing scouting data for ${opponentSelect.selectedOptions[0]?.textContent ?? 'the selected opponent'}.`
        : 'Select an opponent to load the scouting report.';
      void loadScoutingReport(opponentSelect.value);
    });

    void loadScoutingReport(opponentSelect.value);
  }

  async function loadDashboard(teamId: string): Promise<void> {
    if (!teamId) {
      renderEmptyState('Select a team to load its dashboard.');
      return;
    }

    const loadId = ++activeDashboardLoad;
    const teamIdNumber = Number(teamId);
    renderEmptyState('Loading coach dashboard...');

    try {
      const [dashboard, trendsResult, practiceResult, upcomingResult] = await Promise.all([
        getCoachDashboard(teamId),
        getCoachTrends(teamIdNumber, selectedSeason())
          .then((value) => ({ value, error: null as string | null }))
          .catch((error) => ({ value: null, error: formatError(error) })),
        getCoachPracticeFocus(teamIdNumber, selectedSeason())
          .then((value) => ({ value, error: null as string | null }))
          .catch((error) => ({ value: null, error: formatError(error) })),
        getTeamUpcoming(teamIdNumber, 1)
          .then((value) => ({ value, error: null as string | null }))
          .catch((error) => ({ value: null, error: formatError(error) })),
      ]);

      if (loadId !== activeDashboardLoad) return;

      renderDashboard(
        dashboard,
        {
          trends: trendsResult.value,
          trendsError: trendsResult.error,
          practice: practiceResult.value,
          practiceError: practiceResult.error,
          nextOpponentId: resolveNextOpponentId(teamIdNumber, upcomingResult.value),
        },
        loadId,
      );
    } catch (error) {
      if (loadId !== activeDashboardLoad) return;
      renderEmptyState(`Unable to load coach dashboard: ${formatError(error)}`);
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
      const message = formatError(error);
      selectorNotice.textContent = `Unable to load teams: ${message}`;
      renderEmptyState('Coach dashboard is unavailable until the team list loads.');
    }
  })();
}
