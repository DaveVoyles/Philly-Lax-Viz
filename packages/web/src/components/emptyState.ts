// emptyState.ts — shared "no data for season YYYY yet" placeholder.
// Wave 14 Lane 2 (Han). Used by dashboard / teams / players / leaders views
// when the active season filter returns no rows.

import { currentSeason, ALL_SEASONS } from './seasonPicker.js';

export interface EmptyStateOpts {
  /** Subject — e.g. "teams", "games", "leaders". */
  subject: string;
  /** Optional override (defaults to current season picker value). */
  season?: number | typeof ALL_SEASONS | null;
  /** Optional remediation hint. */
  hint?: string;
}

/** Pure helper — returns the message string. Used by tests and renderEmptyState. */
export function emptyStateMessage(opts: EmptyStateOpts): string {
  const season = opts.season === undefined ? currentSeason() : opts.season;
  if (season === null) {
    return `No ${opts.subject} yet.`;
  }
  if (season === ALL_SEASONS) {
    return `No ${opts.subject} found across any season yet.`;
  }
  return `No ${opts.subject} for season ${season} yet.`;
}

export function renderEmptyState(opts: EmptyStateOpts): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = emptyStateMessage(opts);
  wrap.appendChild(p);
  if (opts.hint) {
    const h = document.createElement('p');
    h.className = 'muted empty-state__hint';
    h.style.fontSize = '.85rem';
    h.textContent = opts.hint;
    wrap.appendChild(h);
  }
  return wrap;
}
