// Wave 11 Lane 2 (R2) — PIAA validation badge.
// Compact icon badge (✅/⚠️/🔴/⚪) with hover tooltip explaining the diff;
// optionally renders as a clickable link to the PIAA source page.

import type { PiaaValidation, DerivedRecord, PiaaRecord } from '@pll/shared';

export interface PiaaBadgeOptions {
  validation: PiaaValidation;
  derived: DerivedRecord | null | undefined;
  piaa: PiaaRecord | null | undefined;
  /** When true, omit the "unmapped" dot entirely. */
  hideUnmapped?: boolean;
  /** When true, badge is wrapped in an anchor to the PIAA source page. */
  linkToSource?: boolean;
}

const ICON: Record<PiaaValidation['status'], string> = {
  match: '✅',
  close: '⚠️',
  divergent: '🔴',
  unmapped: '⚪',
};

function fmtRecord(r: { wins: number; losses: number } | null | undefined): string {
  if (!r) return '?-?';
  return `${r.wins}-${r.losses}`;
}

export function piaaBadgeTooltip(
  validation: PiaaValidation,
  derived: DerivedRecord | null | undefined,
  piaa: PiaaRecord | null | undefined,
): string {
  switch (validation.status) {
    case 'match':
      return `PIAA verified: PhillyLacrosse ${fmtRecord(derived)} matches official`;
    case 'close':
      return `Using PIAA ${fmtRecord(piaa)} (PhillyLacrosse derived ${fmtRecord(derived)}, off by ${validation.totalDiff})`;
    case 'divergent':
      return `Using PIAA ${fmtRecord(piaa)} (PhillyLacrosse derived ${fmtRecord(derived)} diverges — investigate coverage gap)`;
    case 'unmapped':
    default:
      return 'No PIAA mapping (not state-affiliated or unmatched)';
  }
}

export function renderPiaaBadge(opts: PiaaBadgeOptions): HTMLElement | null {
  const { validation, derived, piaa, hideUnmapped, linkToSource } = opts;
  if (validation.status === 'unmapped' && hideUnmapped) return null;

  const icon = document.createElement('span');
  icon.className = `piaa-badge piaa-badge--${validation.status}`;
  icon.setAttribute('role', 'img');
  const tip = piaaBadgeTooltip(validation, derived, piaa);
  icon.title = tip;
  icon.setAttribute('aria-label', tip);
  icon.textContent = ICON[validation.status];

  if (linkToSource && validation.status !== 'unmapped' && validation.sourceUrl) {
    const a = document.createElement('a');
    a.href = validation.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'piaa-badge-link';
    a.title = tip;
    a.appendChild(icon);
    a.addEventListener('click', (e) => e.stopPropagation());
    return a;
  }
  return icon;
}
