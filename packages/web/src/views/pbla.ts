import { shouldAnimate, shouldMountWebGL } from '../util/motionPrefs.js';
import { setPageMeta } from '../util/pageMeta.js';

import { SEASONS } from './pblaData.js';
import { updateLiveBadge } from './pblaHelpers.js';
import { buildHero, renderSeasonButtons, renderSeasonContent } from './pblaSections.js';
import { ensureStyles } from './pblaStyles.js';
import {
  clearCleanup,
  clearPendingTimers,
  destroyWebGL,
  invalidateRenderToken,
  isCurrentRenderToken,
  mountWebGL,
  nextRenderToken,
  registerCleanup,
  schedule,
} from './pblaWebGL.js';

let activeRoot: HTMLElement | null = null;

export async function render(root: HTMLElement, _params: Record<string, string>): Promise<void> {
  destroy();
  ensureStyles();
  setPageMeta({
    title: 'PBLA - Philadelphia Box Lacrosse Association',
    description: 'Philadelphia Box Lacrosse Association standings, recent results, scorers, and league highlights with WebGL motion.',
  });

  const token = nextRenderToken();
  const seasons = [...SEASONS].sort((a, b) => b.year - a.year);
  let selectedYear = seasons[0]?.year ?? 2026;
  const animate = shouldAnimate();

  root.replaceChildren();
  root.classList.add('pbla-view-root');
  activeRoot = root;

  const { selectorBar, seasonContent, webglHost, liveBadge, liveText } = buildHero(root);

  const refreshLiveBadge = (): void => {
    void updateLiveBadge(liveBadge, liveText);
  };
  await updateLiveBadge(liveBadge, liveText);
  if (!isCurrentRenderToken(token)) return;

  const liveInterval = window.setInterval(refreshLiveBadge, 60_000);
  registerCleanup(() => window.clearInterval(liveInterval));

  const updateSeason = (year: number): void => {
    if (!isCurrentRenderToken(token)) return;
    selectedYear = year;
    const season = seasons.find((entry) => entry.year === selectedYear) ?? seasons[0];
    if (!season) return;
    renderSeasonButtons(selectorBar, seasons, selectedYear, updateSeason);
    renderSeasonContent(seasonContent, season, animate, webglHost, token);
  };

  updateSeason(selectedYear);

  if (shouldMountWebGL()) {
    schedule(() => {
      if (!isCurrentRenderToken(token)) return;
      mountWebGL(webglHost, token);
    }, 60);
  }
}

export function destroy(): void {
  invalidateRenderToken();
  clearPendingTimers();
  clearCleanup();
  destroyWebGL();
  activeRoot?.classList.remove('pbla-view-root');
  activeRoot = null;
}
