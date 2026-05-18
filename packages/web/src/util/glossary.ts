const RAW_STAT_GLOSSARY: Record<string, string> = {
  goals: 'Points scored by shooting the ball into the opponent\'s goal.',
  assists: 'Passes that directly lead to a goal being scored.',
  points: 'Total of goals + assists.',
  shots: 'Any attempt to score a goal, on or off cage.',
  'shots on goal': 'Shots that would have scored if not saved by the goalie.',
  'shot %': 'Percentage of shots that result in goals (goals ÷ shots).',
  'ground balls': 'Loose balls picked up off the ground.',
  turnovers: 'Times a player loses possession to the opposing team.',
  'caused tos': 'Turnovers forced by a defender on the opposing ball carrier.',
  'caused turnovers': 'Turnovers forced by a defender on the opposing ball carrier.',
  'fo wins': 'Face-off wins — gaining possession at the start of a play.',
  'fo %': 'Face-off win percentage (FO wins ÷ total face-offs attempted).',
  'faceoff %': 'Face-off win percentage (FO wins ÷ total face-offs attempted).',
  saves: 'Shots stopped by the goalie before entering the goal.',
  'save %': 'Percentage of shots on goal that the goalie saves.',
  'goals against': 'Goals scored against a team or goalie.',
  gaa: 'Goals Against Average — average goals allowed per game.',
  w: 'Wins this season.',
  l: 'Losses this season.',
  'goal diff': 'Average goal margin per game (goals scored minus goals allowed).',
  'goal margin': 'Total goal differential (goals scored minus goals allowed).',
  'goals for': 'Goals scored by a team this season.',
  'goals/game': 'Average goals scored per game.',
  'goals against/game': 'Average goals allowed per game.',
  'points/game': 'Average points recorded per game.',
  'win %': 'Win percentage (wins ÷ total games played).',
  'fo att': 'Total face-offs attempted.',
};

export const STAT_GLOSSARY: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_STAT_GLOSSARY).map(([label, definition]) => [label.toLowerCase(), definition]),
);

const GLOSSARY_ALIASES: Record<string, string> = {
  g: 'goals',
  a: 'assists',
  p: 'points',
  gb: 'ground balls',
  ct: 'caused tos',
  sv: 'saves',
  'fo w': 'fo wins',
  wins: 'w',
  losses: 'l',
  gf: 'goals for',
  ga: 'goals against',
  '+/-': 'goal diff',
  gpg: 'goals/game',
  gapg: 'goals against/game',
};

const GLOSSARY_ICON_CSS = `.glossary-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6b7280;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  cursor: help;
  margin-left: 3px;
  vertical-align: middle;
  text-decoration: none;
  line-height: 1;
  position: relative;
}
.glossary-icon .glossary-tip {
  display: none;
  position: absolute;
  bottom: 120%;
  left: 50%;
  transform: translateX(-50%);
  background: #1f2937;
  color: #f9fafb;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.glossary-icon:hover .glossary-tip,
.glossary-icon:focus .glossary-tip {
  display: block;
}`;

let glossaryCssInjected = false;

/** Returns the glossary definition for a stat label, case-insensitively. */
export function getGlossary(label: string): string | undefined {
  const key = label.toLowerCase().trim();
  return STAT_GLOSSARY[key] ?? STAT_GLOSSARY[GLOSSARY_ALIASES[key] ?? ''];
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Returns an HTML string for a help icon with tooltip if the label has a glossary entry.
 * Uses the native title attribute for zero-JS tooltips.
 */
export function glossaryIcon(label: string): string {
  const def = getGlossary(label);
  if (!def) return '';
  const escaped = escapeHtmlAttr(def);
  return `<span class="glossary-icon" tabindex="0" aria-label="Definition: ${escaped}">?<span class="glossary-tip">${escaped}</span></span>`;
}

export function ensureGlossaryCss(): void {
  if (glossaryCssInjected) return;
  glossaryCssInjected = true;
  const style = document.createElement('style');
  style.textContent = GLOSSARY_ICON_CSS;
  document.head.appendChild(style);
}

export function renderGlossaryIcon(label: string): HTMLSpanElement | null {
  const html = glossaryIcon(label);
  if (!html) return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild as HTMLSpanElement | null;
}
