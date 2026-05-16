/**
 * Short definitions for lacrosse stat abbreviations shown in the leaders view
 * and team/player detail tables. Sourced from standard lacrosse stats vocabulary.
 */
export const STAT_GLOSSARY: Record<string, string> = {
  Points: 'Goals + Assists. Primary offensive production metric.',
  Goals: 'Shots that enter the goal. Each counts as 1 point.',
  Assists: 'Passes directly leading to a goal. Each counts as 1 point.',
  'Ground balls': 'Loose balls picked up off the ground. Key possession stat.',
  'Caused TOs': 'Caused turnovers - forcing the opponent to lose possession (checks, intercepts, etc.).',
  Saves: 'Shots stopped by the goalkeeper. Higher is better for goalies.',
  'FO %': 'Faceoff percentage - wins / total faceoffs taken. Controls possession starts.',
  'Points/game': 'Season points (goals + assists) divided by games played.',
  Wins: 'Total wins this season.',
  Losses: 'Total losses this season.',
  'Win %': 'Win percentage - wins divided by total games played.',
  'Goals for': 'Total goals scored by the team this season.',
  'Goals against': 'Total goals allowed by the team this season.',
  'Goal diff': 'Goals for minus goals against. Positive = net scorer, negative = net conceder.',
  'Goals/game': 'Average goals scored per game (offensive output).',
  'Goals against/game': 'Average goals allowed per game (defensive performance).',
};

const GLOSSARY_ALIASES: Record<string, string> = {
  P: 'Points',
  G: 'Goals',
  A: 'Assists',
  GB: 'Ground balls',
  CT: 'Caused TOs',
  SV: 'Saves',
  W: 'Wins',
  L: 'Losses',
  GF: 'Goals for',
  GA: 'Goals against',
  '+/-': 'Goal diff',
  GPG: 'Goals/game',
  GAPG: 'Goals against/game',
};

// Singleton tooltip div appended to <body> so it escapes table overflow clipping.
let _tipEl: HTMLDivElement | null = null;
function getTipEl(): HTMLDivElement {
  if (!_tipEl) {
    _tipEl = document.createElement('div');
    _tipEl.id = 'glossary-tooltip';
    document.body.appendChild(_tipEl);
  }
  return _tipEl;
}

function showTip(anchor: HTMLElement, text: string): void {
  const tip = getTipEl();
  tip.textContent = text;
  tip.classList.add('visible');
  const r = anchor.getBoundingClientRect();
  // Position above the anchor; shift left so it's centred
  const left = r.left + r.width / 2;
  const top = r.top - 8; // 8px gap above anchor
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  // After paint, nudge so it doesn't overflow viewport edges
  requestAnimationFrame(() => {
    const tw = tip.offsetWidth;
    const clampedLeft = Math.max(8, Math.min(left - tw / 2, window.innerWidth - tw - 8));
    tip.style.left = `${clampedLeft}px`;
    tip.style.transform = 'translateY(-100%)';
  });
}

function hideTip(): void {
  _tipEl?.classList.remove('visible');
}

/**
 * Renders a small "?" help icon that shows a tooltip on hover/focus.
 * Uses a body-level fixed-position div so the tooltip escapes table overflow.
 */
export function renderGlossaryIcon(metric: string): HTMLSpanElement | null {
  const key = STAT_GLOSSARY[metric] ? metric : GLOSSARY_ALIASES[metric];
  const def = key ? STAT_GLOSSARY[key] : undefined;
  if (!def) return null;
  const span = document.createElement('span');
  span.textContent = ' ?';
  span.className = 'glossary-tip';
  span.setAttribute('aria-label', `Help: ${def}`);
  span.setAttribute('role', 'img');
  span.setAttribute('tabindex', '0');
  span.addEventListener('mouseenter', () => showTip(span, def));
  span.addEventListener('mouseleave', hideTip);
  span.addEventListener('focus', () => showTip(span, def));
  span.addEventListener('blur', hideTip);
  return span;
}
