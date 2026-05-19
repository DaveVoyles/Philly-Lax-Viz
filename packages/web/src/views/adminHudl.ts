import type { HudlTeam } from '@pll/shared';
import {
  createAdminHudlTeam,
  deleteAdminHudlTeam,
  getAdminHudlTeams,
  getTeams,
  patchAdminHudlTeam,
  type TeamSeasonRecord,
} from '../api.js';
import { IS_STATIC, staticUnavailableNode } from '../staticLoader.js';

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  if (IS_STATIC) {
    root.replaceChildren(staticUnavailableNode('Hudl Team Management'));
    return;
  }

  let teams: TeamSeasonRecord[] = [];
  let hudlTeams: HudlTeam[] = [];

  root.innerHTML = `
    <div class="page-header">
      <h1>Hudl Team Management</h1>
      <p class="muted">Register Hudl team access, pause syncs, and remove stale team links.</p>
    </div>
    <div id="hudl-feedback"></div>
    <section class="card" style="padding:1rem;margin-bottom:1.5rem">
      <div id="hudl-table">Loading Hudl teams...</div>
    </section>
    <section class="card" style="padding:1rem">
      <h2 style="margin-top:0">Register New Team</h2>
      <form id="hudl-register-form" style="display:grid;gap:0.75rem;max-width:42rem">
        <label>
          <span>Team</span>
          <select id="hudl-team-id" required>
            <option value="">Loading teams...</option>
          </select>
        </label>
        <label>
          <span>Hudl Team URL</span>
          <input id="hudl-team-url" type="url" required placeholder="https://www.hudl.com/team/..." />
        </label>
        <label>
          <span>Hudl Team Name (optional)</span>
          <input id="hudl-team-name" type="text" placeholder="Optional label from Hudl" />
        </label>
        <div>
          <button type="submit">Register</button>
        </div>
      </form>
    </section>
  `;

  const feedback = root.querySelector<HTMLElement>('#hudl-feedback');
  const tableHost = root.querySelector<HTMLElement>('#hudl-table');
  const form = root.querySelector<HTMLFormElement>('#hudl-register-form');
  const teamSelect = root.querySelector<HTMLSelectElement>('#hudl-team-id');
  const urlInput = root.querySelector<HTMLInputElement>('#hudl-team-url');
  const nameInput = root.querySelector<HTMLInputElement>('#hudl-team-name');
  if (!feedback || !tableHost || !form || !teamSelect || !urlInput || !nameInput) return;

  const feedbackEl = feedback;
  const tableHostEl = tableHost;
  const formEl = form;
  const teamSelectEl = teamSelect;
  const urlInputEl = urlInput;
  const nameInputEl = nameInput;

  function setFeedback(kind: 'error' | 'success' | 'muted', message: string): void {
    const className = kind === 'muted' ? 'muted' : kind;
    feedbackEl.innerHTML = `<div class="${className}" style="margin-bottom:1rem">${escapeHtml(message)}</div>`;
  }

  function renderTeamOptions(): void {
    const options = ['<option value="">Select a team</option>'];
    for (const team of [...teams].sort((a, b) => a.name.localeCompare(b.name))) {
      options.push(`<option value="${team.id}">${escapeHtml(team.name)}</option>`);
    }
    teamSelectEl.innerHTML = options.join('');
  }

  function renderHudlTable(): void {
    if (hudlTeams.length === 0) {
      tableHostEl.innerHTML = '<div class="empty-state">No Hudl teams registered yet.</div>';
      return;
    }

    tableHostEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Team Name</th>
            <th>Hudl URL</th>
            <th>Status</th>
            <th>Last Synced</th>
            <th>Last Error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${hudlTeams.map((team) => renderHudlRow(team)).join('')}
        </tbody>
      </table>
    `;
  }

  function renderHudlRow(team: HudlTeam): string {
    const actionLabel = team.status === 'paused' ? 'Resume' : 'Pause';
    const nextStatus = team.status === 'paused' ? 'active' : 'paused';
    return `
      <tr>
        <td>${escapeHtml(team.teamName ?? team.hudlTeamName ?? `Team ${team.teamId}`)}</td>
        <td><a href="${escapeAttribute(team.hudlTeamUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(team.hudlTeamUrl)}</a></td>
        <td>${renderStatusBadge(team.status)}</td>
        <td>${escapeHtml(formatDate(team.lastSynced))}</td>
        <td>${escapeHtml(team.lastError ?? '-')}</td>
        <td class="action-cell">
          <button type="button" data-action="toggle" data-id="${escapeAttribute(team.id)}" data-next-status="${nextStatus}">${actionLabel}</button>
          <button type="button" data-action="delete" data-id="${escapeAttribute(team.id)}" style="margin-left:0.5rem">Delete</button>
        </td>
      </tr>
    `;
  }

  async function loadData(): Promise<void> {
    tableHostEl.innerHTML = '<div class="muted">Loading Hudl teams...</div>';
    const [teamsResult, hudlTeamsResult] = await Promise.allSettled([getTeams(), getAdminHudlTeams()]);

    if (teamsResult.status === 'fulfilled') {
      teams = teamsResult.value;
      renderTeamOptions();
    } else {
      teams = [];
      teamSelectEl.innerHTML = '<option value="">Unable to load teams</option>';
    }

    if (hudlTeamsResult.status === 'fulfilled') {
      hudlTeams = hudlTeamsResult.value;
      renderHudlTable();
    } else {
      tableHostEl.innerHTML = `<div class="error">Failed to load Hudl teams: ${escapeHtml(formatError(hudlTeamsResult.reason))}</div>`;
    }

    if (teamsResult.status === 'rejected') {
      setFeedback('error', `Failed to load team list: ${formatError(teamsResult.reason)}`);
    } else if (hudlTeamsResult.status === 'fulfilled') {
      feedbackEl.innerHTML = '';
    }
  }

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const teamId = teamSelectEl.value.trim();
    const hudlTeamUrl = urlInputEl.value.trim();
    const hudlTeamName = nameInputEl.value.trim();
    if (!teamId || !hudlTeamUrl) {
      setFeedback('error', 'Team and Hudl Team URL are required.');
      return;
    }

    const submitButton = formEl.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      await createAdminHudlTeam({
        teamId,
        hudlTeamUrl,
        hudlTeamName: hudlTeamName || undefined,
      });
      formEl.reset();
      setFeedback('success', 'Hudl team registered.');
      await loadData();
    } catch (error) {
      setFeedback('error', `Failed to register Hudl team: ${formatError(error)}`);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  tableHostEl.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (!action || !id) return;

    button.disabled = true;
    try {
      if (action === 'toggle') {
        const status = button.dataset.nextStatus === 'paused' ? 'paused' : 'active';
        await patchAdminHudlTeam(id, { status });
        setFeedback('success', `Hudl team ${status === 'paused' ? 'paused' : 'resumed'}.`);
      } else if (action === 'delete') {
        const confirmed = window.confirm('Delete this Hudl team registration?');
        if (!confirmed) {
          button.disabled = false;
          return;
        }
        await deleteAdminHudlTeam(id);
        setFeedback('success', 'Hudl team registration removed.');
      }
      await loadData();
    } catch (error) {
      setFeedback('error', `Hudl update failed: ${formatError(error)}`);
      button.disabled = false;
    }
  });

  await loadData();
}

function renderStatusBadge(status: HudlTeam['status']): string {
  const palette: Record<HudlTeam['status'], { bg: string; fg: string }> = {
    active: { bg: '#dcfce7', fg: '#166534' },
    paused: { bg: '#fef3c7', fg: '#92400e' },
    error: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const colors = palette[status];
  return `<span style="display:inline-block;padding:0.2rem 0.55rem;border-radius:999px;background:${colors.bg};color:${colors.fg};font-weight:600;text-transform:capitalize">${status}</span>`;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
