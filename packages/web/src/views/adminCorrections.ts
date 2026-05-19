import {
  getFlaggedCorrections,
  getRecentCorrections,
  type CorrectionRecord,
} from '../api.js';
import { IS_STATIC } from '../staticLoader.js';

const STATIC_MESSAGE = 'Admin inbox not available in static mode - access via https://phillylaxstats.com/api/corrections/flagged';

export function mountAdminCorrections(container: HTMLElement): void {
  if (IS_STATIC) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(STATIC_MESSAGE)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>Community Corrections Inbox</h1>
      <p class="muted">Review outlier-flagged community submissions and keep an eye on recently applied corrections.</p>
    </div>
    <div id="admin-corrections-content">Loading admin inbox...</div>
  `;

  void loadCorrections(container);
}

async function loadCorrections(container: HTMLElement): Promise<void> {
  const content = container.querySelector<HTMLElement>('#admin-corrections-content');
  if (!content) return;

  content.innerHTML = '<div class="muted">Loading admin inbox...</div>';

  const [flaggedResult, recentResult] = await Promise.allSettled([
    getFlaggedCorrections(),
    getRecentCorrections(),
  ]);

  const flagged = flaggedResult.status === 'fulfilled' ? flaggedResult.value : [];
  const recentAll = recentResult.status === 'fulfilled' ? recentResult.value : [];
  const recentApproved = recentAll.filter((record) => record.status === 'approved');
  const flaggedError = flaggedResult.status === 'rejected' ? formatError(flaggedResult.reason) : null;
  const recentError = recentResult.status === 'rejected' ? formatError(recentResult.reason) : null;

  content.innerHTML = `
    <div class="card" style="padding:1rem;margin-bottom:1.5rem">
      <strong>${flaggedError ? 'Flagged unavailable' : `${flagged.length} flagged outliers`}</strong>
      <span class="muted"> | </span>
      <strong>${recentError ? 'Recent unavailable' : `${recentApproved.length} recent approvals`}</strong>
    </div>
    <section style="margin-bottom:2rem">
      <h2>Flagged outliers</h2>
      <p class="muted">These submissions were saved but not auto-applied because they tripped an outlier rule.</p>
      ${flaggedError ? `<div class="error">Failed to load flagged corrections: ${escapeHtml(flaggedError)}</div>` : renderCorrectionsTable(flagged, true)}
    </section>
    <section>
      <h2>Recent approvals</h2>
      <p class="muted">Most community edits apply automatically. This shows the latest approved corrections.</p>
      ${recentError ? `<div class="error">Failed to load recent corrections: ${escapeHtml(recentError)}</div>` : renderCorrectionsTable(recentApproved, false)}
    </section>
  `;
}

function renderCorrectionsTable(rows: CorrectionRecord[], includeReviewerNotes: boolean): string {
  if (rows.length === 0) {
    return '<div class="empty-state">Nothing to review right now.</div>';
  }

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Submitter</th>
          <th>Entity</th>
          <th>Field</th>
          <th>Old -> New</th>
          ${includeReviewerNotes ? '<th>Reviewer Notes</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => renderRow(row, includeReviewerNotes)).join('')}
      </tbody>
    </table>
  `;
}

function renderRow(row: CorrectionRecord, includeReviewerNotes: boolean): string {
  return `
    <tr>
      <td>${escapeHtml(formatDate(row.submitted_at))}</td>
      <td>${escapeHtml(formatSubmitter(row))}</td>
      <td>${escapeHtml(formatEntity(row))}</td>
      <td>${escapeHtml(formatField(row.field_name))}</td>
      <td>${escapeHtml(formatValue(row.old_value))} -> ${escapeHtml(formatValue(row.new_value))}</td>
      ${includeReviewerNotes ? `<td>${escapeHtml(row.reviewer_notes ?? 'None')}</td>` : ''}
    </tr>
  `;
}

function formatSubmitter(row: CorrectionRecord): string {
  const byName = [row.submitter_first, row.submitter_last].filter(Boolean).join(' ').trim();
  return byName || row.submitter_name || row.submitter_email || 'Unknown';
}

function formatEntity(row: CorrectionRecord): string {
  return `${row.entity_type.replace(/_/g, ' ')} #${row.entity_id}`;
}

function formatField(fieldName: string): string {
  return fieldName.replace(/_/g, ' ');
}

function formatValue(value: string | null): string {
  return value === null || value === '' ? '(empty)' : value;
}

function formatDate(value: string): string {
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

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  mountAdminCorrections(root);
}
