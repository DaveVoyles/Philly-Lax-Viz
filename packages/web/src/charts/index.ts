// Chart library barrel. Each renderer:
//   renderXxx(el: HTMLElement, data, options?): { destroy(): void }
// Use the returned handle's destroy() on route change to clean up the SVG.

export { renderQuarterByQuarter } from './quarterByQuarter.js';
export { renderSeasonRecord } from './seasonRecord.js';
export { renderTopScorers } from './topScorers.js';
export { renderPerGameTrend } from './perGameTrend.js';
export { renderHorizontalLeaderboard } from './horizontalLeaderboard.js';

export type {
  ChartHandle,
  ChartMargin,
  BaseChartOptions,
  QuarterByQuarterDatum,
  QuarterByQuarterOptions,
  SeasonRecordDatum,
  SeasonRecordOptions,
  TopScorersDatum,
  TopScorersOptions,
  PerGameTrendDatum,
  PerGameTrendOptions,
  HorizontalLeaderboardDatum,
  HorizontalLeaderboardOptions,
} from './types.js';
