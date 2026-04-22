// commitBadge.ts — small "🎓 Committed to X" badge for the player detail page.
// Wave 15 Lane 3 (Han 🧑‍🚀🍔).

export interface CommitBadgeData {
  college: string;
  division?: string | null;
}

export function renderCommitBadge(data: CommitBadgeData): HTMLElement {
  const span = document.createElement('span');
  span.className = 'commit-badge';
  span.style.cssText =
    'display:inline-flex; align-items:center; gap:.35rem; padding:.2rem .55rem; ' +
    'border-radius:999px; background:var(--accent, #1f6feb); color:var(--accent-fg, #fff); ' +
    'font-size:.85rem; font-weight:600; vertical-align:middle;';
  const div = data.division ? ` (${data.division})` : '';
  span.textContent = `🎓 Committed to ${data.college}${div}`;
  span.title = `College commitment${data.division ? ` — Division ${data.division.replace(/^D/, '')}` : ''}`;
  return span;
}
