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

/**
 * Renders a small "?" help icon that shows `definition` on hover.
 * Uses a CSS tooltip (.glossary-tip + data-tooltip) so it works reliably
 * across all browsers — the native title attribute is too inconsistent.
 */
export function renderGlossaryIcon(metric: string): HTMLSpanElement | null {
  const key = STAT_GLOSSARY[metric] ? metric : GLOSSARY_ALIASES[metric];
  const def = key ? STAT_GLOSSARY[key] : undefined;
  if (!def) return null;
  const span = document.createElement('span');
  span.textContent = ' ?';
  span.className = 'glossary-tip';
  span.dataset.tooltip = def;
  span.setAttribute('aria-label', `Help: ${def}`);
  span.setAttribute('role', 'img');
  span.setAttribute('tabindex', '0');
  return span;
}
