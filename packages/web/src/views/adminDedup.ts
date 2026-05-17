import { IS_STATIC } from '../staticLoader.js';
import {
  getDedupCandidates,
  mergeDedupCandidate,
  patchDedupCandidate,
  type DedupCandidateRow,
} from '../api.js';

export async function renderAdminDedup(container: HTMLElement): Promise<void> {
  if (IS_STATIC) {
    container.innerHTML = '<div class="empty-state">Admin tools are not available in the static (GitHub Pages) version.</div>';
    return;
  }

  let currentStatus = 'pending';
  let candidates: DedupCandidateRow[] = [];
  let total = 0;
  let offset = 0;
  const limit = 50;

  container.innerHTML = `
    <div class="page-header">
      <h1>Player Dedup Review</h1>
      <p class="muted">Review fuzzy-matched player pairs. Approve to merge, reject to dismiss, skip to review later.</p>
    </div>
    <div class="filter-tabs" id="dedup-tabs">
      <button class="tab active" data-status="pending">Pending</button>
      <button class="tab" data-status="approved">Approved</button>
      <button class="tab" data-status="rejected">Rejected</button>
      <button class="tab" data-status="skipped">Skipped</button>
      <button class="tab" data-status="">All</button>
    </div>
    <div id="dedup-content">Loading...</div>
  `;

  container.querySelector('#dedup-tabs')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-status]') as HTMLButtonElement | null;
    if (!btn) return;
    container.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
    btn.classList.add('active');
    currentStatus = btn.dataset.status ?? '';
    offset = 0;
    await loadCandidates();
  });

  async function loadCandidates(): Promise<void> {
    const content = container.querySelector<HTMLElement>('#dedup-content');
    if (!content) return;
    content.innerHTML = 'Loading...';
    try {
      const result = await getDedupCandidates(currentStatus || undefined, limit, offset);
      candidates = result.candidates;
      total = result.total;
      renderTable(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      content.innerHTML = `<div class="error">Failed to load candidates: ${message}</div>`;
    }
  }

  function renderTable(content: HTMLElement): void {
    if (candidates.length === 0) {
      content.innerHTML = '<div class="empty-state">No candidates in this category.</div>';
      return;
    }

    content.innerHTML = `
      <p class="muted" style="margin-bottom:0.75rem">${total} candidate${total !== 1 ? 's' : ''} total</p>
      <table class="data-table" id="dedup-table">
        <thead>
          <tr>
            <th>Player A</th>
            <th>Team A</th>
            <th>Player B</th>
            <th>Team B</th>
            <th>Similarity</th>
            <th>Stats A / B</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${candidates.map((candidate) => renderRow(candidate)).join('')}
        </tbody>
      </table>
      ${total > limit ? `<div style="margin-top:1rem">
        <button id="prev-page" ${offset === 0 ? 'disabled' : ''}>Prev</button>
        <span style="margin:0 1rem">${offset + 1}-${Math.min(offset + limit, total)} of ${total}</span>
        <button id="next-page" ${offset + limit >= total ? 'disabled' : ''}>Next</button>
      </div>` : ''}
    `;

    content.querySelector('#dedup-table')?.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const id = Number(btn.dataset.id);
      const action = btn.dataset.action;
      if (!action) return;

      btn.disabled = true;
      btn.textContent = '...';
      try {
        if (action === 'approve') {
          await patchDedupCandidate(id, { status: 'approved' });
        } else if (action === 'reject') {
          await patchDedupCandidate(id, { status: 'rejected' });
        } else if (action === 'skip') {
          await patchDedupCandidate(id, { status: 'skipped' });
        } else if (action === 'merge') {
          const confirmed = window.confirm(
            'Merge Player B into Player A? This permanently deletes Player B and reassigns their stats. This cannot be undone.',
          );
          if (!confirmed) {
            btn.disabled = false;
            btn.textContent = 'Merge';
            return;
          }
          const res = await mergeDedupCandidate(id);
          window.alert(`Merged! ${res.statsRedirected} stats redirected, ${res.statsDropped} duplicates dropped.`);
        }
        await loadCandidates();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = buttonLabel(action);
        const message = err instanceof Error ? err.message : String(err);
        window.alert(`Error: ${message}`);
      }
    });

    content.querySelector<HTMLButtonElement>('#prev-page')?.addEventListener('click', async () => {
      offset = Math.max(0, offset - limit);
      await loadCandidates();
    });
    content.querySelector<HTMLButtonElement>('#next-page')?.addEventListener('click', async () => {
      offset += limit;
      await loadCandidates();
    });
  }

  function renderRow(candidate: DedupCandidateRow): string {
    const pct = Math.round(candidate.similarity * 100);
    const statusBadge = `<span class="badge badge-${candidate.status}">${candidate.status}</span>`;
    let actions = '';
    if (candidate.status === 'pending') {
      actions = `
        <button data-action="approve" data-id="${candidate.id}" class="btn-sm btn-success">Approve</button>
        <button data-action="reject" data-id="${candidate.id}" class="btn-sm btn-danger">Reject</button>
        <button data-action="skip" data-id="${candidate.id}" class="btn-sm">Skip</button>
      `;
    } else if (candidate.status === 'approved') {
      actions = `<button data-action="merge" data-id="${candidate.id}" class="btn-sm btn-warning">Merge</button>`;
    }

    return `<tr>
      <td><a href="#/players/${candidate.player_a_id}">${candidate.player_a_name}</a></td>
      <td>${candidate.player_a_team}</td>
      <td><a href="#/players/${candidate.player_b_id}">${candidate.player_b_name}</a></td>
      <td>${candidate.player_b_team}</td>
      <td>${pct}%</td>
      <td>${candidate.player_a_stats} / ${candidate.player_b_stats}</td>
      <td>${statusBadge}</td>
      <td class="action-cell">${actions}</td>
    </tr>`;
  }

  await loadCandidates();
}

function buttonLabel(action: string): string {
  switch (action) {
    case 'approve':
      return 'Approve';
    case 'reject':
      return 'Reject';
    case 'skip':
      return 'Skip';
    case 'merge':
      return 'Merge';
    default:
      return action;
  }
}

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  await renderAdminDedup(root);
}
