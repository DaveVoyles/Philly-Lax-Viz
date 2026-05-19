import { getTeams, type TeamSeasonRecord } from '../api.js';
import { apiUrl } from '../apiBase.js';
import { IS_STATIC, staticUnavailableNode } from '../staticLoader.js';

const ACCEPTED_UPLOAD_TYPES = '.xlsx,.csv';

type UploadRowStatus = 'new_player' | 'update' | 'match' | 'error' | string;

interface UploadPreviewRow {
  playerName: string;
  gameDate: string | null;
  opponent: string;
  goals: number | null;
  assists: number | null;
  groundBalls: number | null;
  causedTurnovers: number | null;
  saves: number | null;
  foWon: number | null;
  foTaken: number | null;
  status: UploadRowStatus;
  error: string | null;
}

interface UploadPreviewSummary {
  validRows: number;
  errorRows: number;
  newPlayers: number;
  statUpdates: number;
}

interface UploadPreviewResponse {
  uploadId: string;
  rows: UploadPreviewRow[];
  summary: UploadPreviewSummary;
}

interface UploadConfirmResponse {
  statsUpdated: number;
  newPlayersCreated: number;
  teamId: number | null;
}

export function render(root: HTMLElement, _params: Record<string, string>): void {
  root.replaceChildren();

  if (IS_STATIC) {
    root.appendChild(staticUnavailableNode('Coach Upload'));
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
  heading.textContent = 'Coach Spreadsheet Upload';
  root.appendChild(heading);

  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = 'Upload a coach spreadsheet, preview the parsed rows, and confirm the changes before they are applied.';
  root.appendChild(intro);

  const layout = document.createElement('div');
  layout.className = 'coach-upload';
  root.appendChild(layout);

  const formCard = document.createElement('section');
  formCard.className = 'tile coach-upload__card';
  layout.appendChild(formCard);

  const previewCard = document.createElement('section');
  previewCard.className = 'tile coach-upload__card';
  layout.appendChild(previewCard);

  const formTitle = document.createElement('h2');
  formTitle.textContent = 'Step 1: Upload file';
  formCard.appendChild(formTitle);

  const formHelp = document.createElement('p');
  formHelp.className = 'muted';
  formHelp.textContent = 'Supported formats: .xlsx and .csv. Use the template if you need a starter file.';
  formCard.appendChild(formHelp);

  const templateLink = document.createElement('a');
  templateLink.href = '/data/upload-template.xlsx';
  templateLink.textContent = 'Download upload template';
  templateLink.className = 'coach-upload__template';
  formCard.appendChild(templateLink);

  const form = document.createElement('form');
  form.className = 'coach-upload__form';
  form.noValidate = true;
  formCard.appendChild(form);

  const formGrid = document.createElement('div');
  formGrid.className = 'coach-upload__grid';
  form.appendChild(formGrid);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.name = 'file';
  fileInput.accept = ACCEPTED_UPLOAD_TYPES;
  fileInput.required = true;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.name = 'submitterName';
  nameInput.required = true;
  nameInput.autocomplete = 'name';
  nameInput.placeholder = 'Coach name';

  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.name = 'submitterEmail';
  emailInput.autocomplete = 'email';
  emailInput.placeholder = 'coach@example.com';

  const teamSelect = document.createElement('select');
  teamSelect.name = 'teamId';
  teamSelect.required = true;
  teamSelect.disabled = true;

  formGrid.append(
    buildField('Spreadsheet', fileInput),
    buildField('Submitter Name', nameInput),
    buildField('Submitter Email (optional)', emailInput),
    buildField('Team', teamSelect),
  );

  const formNotice = document.createElement('div');
  form.appendChild(formNotice);

  const formActions = document.createElement('div');
  formActions.className = 'coach-upload__actions';
  form.appendChild(formActions);

  const previewButton = document.createElement('button');
  previewButton.type = 'submit';
  previewButton.className = 'coach-upload__button';
  previewButton.textContent = 'Preview Upload';
  previewButton.disabled = true;
  formActions.appendChild(previewButton);

  const previewMount = document.createElement('div');
  previewMount.className = 'coach-upload__preview';
  previewCard.appendChild(previewMount);

  let teams: TeamSeasonRecord[] = [];
  let currentPreview: UploadPreviewResponse | null = null;
  let currentResult: UploadConfirmResponse | null = null;
  let previewPending = false;
  let confirmPending = false;
  let confirmErrorMessage = '';

  function selectedTeam(): TeamSeasonRecord | undefined {
    const teamId = Number(teamSelect.value);
    return teams.find((team) => team.id === teamId);
  }

  function setNotice(node: HTMLElement, tone: 'error' | 'success' | 'info', message: string): void {
    node.className = `coach-upload__alert coach-upload__alert--${tone}`;
    node.textContent = message;
  }

  function clearNotice(node: HTMLElement): void {
    node.className = '';
    node.textContent = '';
  }

  function syncButtons(): void {
    previewButton.disabled = previewPending || teams.length === 0;
    previewButton.textContent = previewPending ? 'Previewing...' : 'Preview Upload';
  }

  function renderPreviewState(): void {
    previewMount.replaceChildren();

    if (currentResult) {
      const title = document.createElement('h2');
      title.textContent = 'Step 4: Result';
      previewMount.appendChild(title);

      const resultNotice = document.createElement('div');
      setNotice(
        resultNotice,
        'success',
        `Upload applied! ${currentResult.statsUpdated} stats updated, ${currentResult.newPlayersCreated} new players created.`,
      );
      previewMount.appendChild(resultNotice);

      const selected = selectedTeam();
      if (selected) {
        const teamLink = document.createElement('p');
        const link = document.createElement('a');
        link.href = `#/teams/${currentResult.teamId ?? selected.id}`;
        link.textContent = `Go to ${selected.name}`;
        teamLink.appendChild(link);
        previewMount.appendChild(teamLink);
      }

      const actionRow = document.createElement('div');
      actionRow.className = 'coach-upload__actions';
      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'coach-upload__button coach-upload__button--secondary';
      resetButton.textContent = 'Upload Another';
      resetButton.addEventListener('click', () => {
        form.reset();
        currentPreview = null;
        currentResult = null;
        confirmErrorMessage = '';
        clearNotice(formNotice);
        renderPreviewState();
      });
      actionRow.appendChild(resetButton);
      previewMount.appendChild(actionRow);
      return;
    }

    const title = document.createElement('h2');
    title.textContent = 'Step 2: Preview rows';
    previewMount.appendChild(title);

    if (!currentPreview) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Choose a file, select a team, and click Preview Upload to review the parsed rows.';
      previewMount.appendChild(empty);
      return;
    }

    const summary = summarizePreview(currentPreview);
    const summaryWrap = document.createElement('div');
    summaryWrap.className = 'coach-upload__summary';
    for (const item of [
      ['Valid rows', summary.validRows],
      ['Errors', summary.errorRows],
      ['New players', summary.newPlayers],
      ['Stat updates', summary.statUpdates],
    ] as const) {
      const card = document.createElement('div');
      card.className = 'record-callout';
      const label = document.createElement('span');
      label.className = 'callout-label';
      label.textContent = item[0];
      const value = document.createElement('span');
      value.className = 'callout-value';
      value.textContent = String(item[1]);
      card.append(label, value);
      summaryWrap.appendChild(card);
    }
    previewMount.appendChild(summaryWrap);

    const summaryLine = document.createElement('p');
    summaryLine.className = 'muted';
    summaryLine.textContent = `${summary.validRows} rows valid, ${summary.errorRows} errors, ${summary.newPlayers} new players, ${summary.statUpdates} stat updates.`;
    previewMount.appendChild(summaryLine);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'coach-upload__table-wrap';
    const table = document.createElement('table');
    table.className = 'coach-upload__table';
    tableWrap.appendChild(table);

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['Player Name', 'Game Date', 'Opponent', 'Goals', 'Assists', 'GBs', 'CTs', 'Saves', 'FO Won', 'FO Taken', 'Status']) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of currentPreview.rows) {
      const tr = document.createElement('tr');
      const status = normalizeStatus(row.status, row.error);
      if (status === 'error') tr.className = 'coach-upload__row coach-upload__row--error';

      tr.appendChild(textCell(row.playerName || '-'));
      tr.appendChild(textCell(formatFriendlyDate(row.gameDate)));
      tr.appendChild(textCell(row.opponent || '-'));
      tr.append(
        numberCell(row.goals),
        numberCell(row.assists),
        numberCell(row.groundBalls),
        numberCell(row.causedTurnovers),
        numberCell(row.saves),
        numberCell(row.foWon),
        numberCell(row.foTaken),
      );

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `coach-upload__status coach-upload__status--${status}`;
      badge.textContent = statusLabel(status);
      statusCell.appendChild(badge);
      if (row.error) {
        const errorText = document.createElement('div');
        errorText.className = 'coach-upload__error-text';
        errorText.textContent = row.error;
        statusCell.appendChild(errorText);
      }
      tr.appendChild(statusCell);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    previewMount.appendChild(tableWrap);

    const confirmHeading = document.createElement('h2');
    confirmHeading.textContent = 'Step 3: Confirm upload';
    previewMount.appendChild(confirmHeading);

    const confirmHelp = document.createElement('p');
    confirmHelp.className = 'muted';
    confirmHelp.textContent = summary.errorRows === 0
      ? 'No validation errors found. Confirm to apply these rows.'
      : 'Fix the spreadsheet errors and preview again before confirming.';
    previewMount.appendChild(confirmHelp);

    const confirmNotice = document.createElement('div');
    previewMount.appendChild(confirmNotice);

    const confirmActions = document.createElement('div');
    confirmActions.className = 'coach-upload__actions';
    previewMount.appendChild(confirmActions);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'coach-upload__button';
    confirmButton.textContent = confirmPending ? 'Confirming...' : 'Confirm Upload';
    confirmButton.disabled = summary.errorRows > 0 || !currentPreview.uploadId || confirmPending;
    confirmActions.appendChild(confirmButton);

    if (!currentPreview.uploadId) {
      setNotice(confirmNotice, 'error', 'Preview response did not include an upload ID. Preview again once the server endpoint is ready.');
    } else if (confirmErrorMessage) {
      setNotice(confirmNotice, 'error', confirmErrorMessage);
    }

    confirmButton.addEventListener('click', async () => {
      if (!currentPreview?.uploadId || confirmPending) return;
      confirmErrorMessage = '';
      clearNotice(confirmNotice);
      confirmPending = true;
      renderPreviewState();
      try {
        const response = await postJson<UploadConfirmResponse>('/api/upload/confirm', {
          uploadId: currentPreview.uploadId,
        });
        currentResult = normalizeConfirmResponse(response, selectedTeam()?.id ?? null);
        currentPreview = null;
      } catch (error) {
        confirmErrorMessage = errorMessage(error);
      } finally {
        confirmPending = false;
        renderPreviewState();
      }
    });
  }

  async function loadTeamsIntoSelect(): Promise<void> {
    clearNotice(formNotice);
    setNotice(formNotice, 'info', 'Loading teams...');
    try {
      teams = (await getTeams()).slice().sort((left, right) => left.name.localeCompare(right.name));
      teamSelect.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a team';
      placeholder.disabled = true;
      placeholder.selected = true;
      teamSelect.appendChild(placeholder);
      for (const team of teams) {
        const option = document.createElement('option');
        option.value = String(team.id);
        option.textContent = team.name;
        teamSelect.appendChild(option);
      }
      teamSelect.disabled = false;
      clearNotice(formNotice);
    } catch (error) {
      setNotice(formNotice, 'error', `Unable to load teams: ${errorMessage(error)}`);
    } finally {
      syncButtons();
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (previewPending) return;
    if (!form.reportValidity()) return;

    const uploadFile = fileInput.files?.[0];
    const team = selectedTeam();
    if (!uploadFile || !team) {
      setNotice(formNotice, 'error', 'Choose a file and team before previewing the upload.');
      return;
    }

    currentPreview = null;
    currentResult = null;
    confirmErrorMessage = '';
    clearNotice(formNotice);
    previewPending = true;
    syncButtons();
    renderPreviewState();

    const formData = new FormData();
    formData.set('file', uploadFile);
    formData.set('submitterName', nameInput.value.trim());
    if (emailInput.value.trim()) formData.set('submitterEmail', emailInput.value.trim());
    formData.set('teamId', String(team.id));
    formData.set('teamName', team.name);

    try {
      const response = await postForm<UploadPreviewResponse>('/api/upload/preview', formData);
      currentPreview = normalizePreviewResponse(response);
      if (currentPreview.rows.length === 0) {
        setNotice(formNotice, 'info', 'Preview completed, but no rows were returned by the server.');
      }
    } catch (error) {
      setNotice(formNotice, 'error', errorMessage(error));
    } finally {
      previewPending = false;
      syncButtons();
      renderPreviewState();
    }
  });

  renderPreviewState();
  void loadTeamsIntoSelect();
}

function buildField(labelText: string, control: HTMLInputElement | HTMLSelectElement): HTMLElement {
  const field = document.createElement('label');
  field.className = 'coach-upload__field';
  const label = document.createElement('span');
  label.className = 'coach-upload__label';
  label.textContent = labelText;
  field.append(label, control);
  return field;
}

function textCell(value: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = value;
  return cell;
}

function numberCell(value: number | null): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'num';
  cell.textContent = value === null ? '-' : String(value);
  return cell;
}

function formatFriendlyDate(value: string | null): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeStatus(status: string | null | undefined, error: string | null): UploadRowStatus {
  if (error) return 'error';
  const normalized = String(status ?? 'match').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
  if (normalized === 'new' || normalized === 'newplayer') return 'new_player';
  if (normalized === 'stat_update') return 'update';
  return normalized || 'match';
}

function statusLabel(status: UploadRowStatus): string {
  switch (status) {
    case 'new_player':
      return 'New Player';
    case 'update':
      return 'Update';
    case 'match':
      return 'Match';
    case 'error':
      return 'Error';
    default:
      return status
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

function summarizePreview(preview: UploadPreviewResponse): UploadPreviewSummary {
  const fallback = preview.rows.reduce<UploadPreviewSummary>(
    (acc, row) => {
      const status = normalizeStatus(row.status, row.error);
      if (status === 'error') {
        acc.errorRows += 1;
        return acc;
      }
      acc.validRows += 1;
      if (status === 'new_player') acc.newPlayers += 1;
      if (status === 'update') acc.statUpdates += 1;
      return acc;
    },
    { validRows: 0, errorRows: 0, newPlayers: 0, statUpdates: 0 },
  );

  return {
    validRows: preview.summary.validRows || fallback.validRows,
    errorRows: preview.summary.errorRows || fallback.errorRows,
    newPlayers: preview.summary.newPlayers || fallback.newPlayers,
    statUpdates: preview.summary.statUpdates || fallback.statUpdates,
  };
}

async function postForm<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    body,
    headers: { Accept: 'application/json' },
  });
  return readJsonResponse<T>(response);
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(response);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => 'Request failed');
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function normalizePreviewResponse(payload: unknown): UploadPreviewResponse {
  const obj = toRecord(payload);
  const summaryRaw = toRecord(obj['summary']);
  const rows = Array.isArray(obj['rows']) ? obj['rows'].map(normalizePreviewRow) : [];
  return {
    uploadId: readString(obj, 'uploadId', 'upload_id') ?? '',
    rows,
    summary: {
      validRows: readNumber(summaryRaw, 'validRows', 'valid_rows') ?? 0,
      errorRows: readNumber(summaryRaw, 'errorRows', 'error_rows') ?? 0,
      newPlayers: readNumber(summaryRaw, 'newPlayers', 'new_players') ?? 0,
      statUpdates: readNumber(summaryRaw, 'statUpdates', 'stat_updates') ?? 0,
    },
  };
}

function normalizePreviewRow(payload: unknown): UploadPreviewRow {
  const obj = toRecord(payload);
  return {
    playerName: readString(obj, 'playerName', 'player_name') ?? '',
    gameDate: readString(obj, 'gameDate', 'game_date', 'date'),
    opponent: readString(obj, 'opponent', 'opponentName', 'opponent_name') ?? '',
    goals: readNumber(obj, 'goals'),
    assists: readNumber(obj, 'assists'),
    groundBalls: readNumber(obj, 'groundBalls', 'ground_balls', 'gbs'),
    causedTurnovers: readNumber(obj, 'causedTurnovers', 'caused_turnovers', 'cts'),
    saves: readNumber(obj, 'saves'),
    foWon: readNumber(obj, 'foWon', 'fo_won'),
    foTaken: readNumber(obj, 'foTaken', 'fo_taken'),
    status: normalizeStatus(readString(obj, 'status'), readString(obj, 'error', 'message')),
    error: readString(obj, 'error', 'message'),
  };
}

function normalizeConfirmResponse(payload: unknown, fallbackTeamId: number | null): UploadConfirmResponse {
  const obj = toRecord(payload);
  return {
    statsUpdated: readNumber(obj, 'statsUpdated', 'stats_updated', 'updatedCount', 'updated_count') ?? 0,
    newPlayersCreated: readNumber(obj, 'newPlayersCreated', 'new_players_created', 'newPlayers', 'new_players') ?? 0,
    teamId: readNumber(obj, 'teamId', 'team_id') ?? fallbackTeamId,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
