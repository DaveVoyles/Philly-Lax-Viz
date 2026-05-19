// Shared chart types. Each chart export takes (HTMLElement, data, options?)
// and returns { destroy() } so views can unmount cleanly on route change.

export interface ChartHandle {
  destroy(): void;
}

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BaseChartOptions {
  width: number; // virtual width used for SVG viewBox
  height: number; // virtual height used for SVG viewBox
  margin: ChartMargin;
}

// ===== quarterByQuarter =====
export interface QuarterByQuarterDatum {
  periods: ReadonlyArray<{
    teamId: number;
    periodNumber: number; // 1..N (>4 = OT)
    goals: number;
  }>;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
}

export interface QuarterByQuarterOptions extends BaseChartOptions {
  homeColor: string;
  awayColor: string;
}

// ===== seasonRecord =====
export interface SeasonRecordDatum {
  wins: number;
  losses: number;
  ties: number;
}

export interface SeasonRecordOptions extends BaseChartOptions {
  winColor: string;
  lossColor: string;
  tieColor: string;
}

// ===== topScorers =====
export interface TopScorersDatum {
  playerName: string;
  goals: number;
  assists: number;
}

export interface TopScorersOptions extends BaseChartOptions {
  goalColor: string;
  assistColor: string;
}

// ===== horizontalLeaderboard =====
export interface HorizontalLeaderboardDatum {
  label: string;
  value: number;
  href?: string;
  sublabel?: string;
}

export interface HorizontalLeaderboardOptions extends BaseChartOptions {
  barColor: string;
  valueFormat: (n: number) => string;
  xAxisLabel: string;
}

// ===== perGameTrend =====
export interface PerGameTrendDatum {
  date: string; // ISO date YYYY-MM-DD
  points: number;
}

export interface PerGameTrendOptions extends BaseChartOptions {
  lineColor: string;
  dotColor: string;
}

// ===== seasonArc =====
export interface SeasonArcDatum {
  gameId: number;
  date: string;
  opponent: string;
  result: 'win' | 'loss' | 'tie';
  goalsFor: number;
  goalsAgainst: number;
}

export interface SeasonArcOptions extends BaseChartOptions {
  winColor: string;
  lossColor: string;
  tieColor: string;
  lineColor: string;
  nodeRadius: number;
}
