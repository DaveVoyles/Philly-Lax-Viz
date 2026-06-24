// ProvenanceBadge -- pill UI element identifying the data source of an
// adjacent value (W/L record, ranking, logo, etc.). Wave 6 Lane 3 (Leia).
//
// Sources:
//   - piaa: PIAA District 1 -- state officials, treated as ground truth
//           for win/loss records and tournament seeding.
//   - phillylacrosse: scraped from the PhillyLacrosse RSS feed; coverage is
//           known to be partial (not every game gets posted).
//   - maxpreps: team logos and metadata from MaxPreps.

export type ProvenanceSource = 'piaa' | 'phillylacrosse' | 'maxpreps';

export interface ProvenanceBadgeOptions {
  source: ProvenanceSource;
  tooltip?: string;
}

interface SourceStyle {
  label: string;
  bg: string;
  fg: string;
  border: string;
  defaultTooltip: string;
}

const STYLES: Record<ProvenanceSource, SourceStyle> = {
  piaa: {
    label: 'PIAA Official',
    bg: '#0e7490',
    fg: '#ffffff',
    border: '#0e7490',
    defaultTooltip: 'PIAA District 1 -- state officials, ground truth',
  },
  phillylacrosse: {
    label: 'PhillyLacrosse',
    bg: '#f3f4f6',
    fg: '#9a3412',
    border: '#d1d5db',
    defaultTooltip: 'Scraped from PhillyLacrosse RSS feed -- coverage may be partial',
  },
  maxpreps: {
    label: 'MaxPreps',
    bg: '#e5e7eb',
    fg: '#374151',
    border: '#d1d5db',
    defaultTooltip: 'Team logo from MaxPreps',
  },
};

export function renderProvenanceBadge(opts: ProvenanceBadgeOptions): HTMLElement {
  const style = STYLES[opts.source];
  const span = document.createElement('span');
  span.className = `provenance-badge provenance-badge--${opts.source}`;
  span.textContent = style.label;
  span.title = opts.tooltip ?? style.defaultTooltip;
  span.setAttribute('aria-label', `Source: ${style.label}`);
  span.style.cssText =
    'display:inline-block; padding:.1rem .5rem; border-radius:999px;' +
    ' font-size:.7rem; font-weight:600; line-height:1.4;' +
    ' text-transform:uppercase; letter-spacing:.02em;' +
    ` background:${style.bg}; color:${style.fg};` +
    ` border:1px solid ${style.border};` +
    ' max-width:100%; overflow:hidden; text-overflow:ellipsis;' +
    ' vertical-align:middle; white-space:nowrap;';
  return span;
}
