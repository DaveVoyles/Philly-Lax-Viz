// Standalone harness mounted by __demo__.html. Renders all 4 charts against
// hand-written fixtures so we can visually verify rendering with no server.

import {
  renderQuarterByQuarter,
  renderSeasonRecord,
  renderTopScorers,
  renderPerGameTrend,
  type QuarterByQuarterDatum,
  type SeasonRecordDatum,
  type TopScorersDatum,
  type PerGameTrendDatum,
} from './index.js';

function mount(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`Missing #${id}`);
  return el;
}

const qbq: QuarterByQuarterDatum = {
  awayTeamId: 1,
  homeTeamId: 2,
  awayTeamName: 'Haverford',
  homeTeamName: 'Malvern Prep',
  periods: [
    { teamId: 1, periodNumber: 1, goals: 3 },
    { teamId: 1, periodNumber: 2, goals: 2 },
    { teamId: 1, periodNumber: 3, goals: 4 },
    { teamId: 1, periodNumber: 4, goals: 1 },
    { teamId: 2, periodNumber: 1, goals: 2 },
    { teamId: 2, periodNumber: 2, goals: 3 },
    { teamId: 2, periodNumber: 3, goals: 2 },
    { teamId: 2, periodNumber: 4, goals: 4 },
    { teamId: 1, periodNumber: 5, goals: 1 },
    { teamId: 2, periodNumber: 5, goals: 0 },
  ],
};

const record: SeasonRecordDatum = { wins: 12, losses: 4, ties: 1 };

const scorers: TopScorersDatum[] = [
  { playerName: 'J. Smith', goals: 28, assists: 14 },
  { playerName: 'M. Reilly', goals: 22, assists: 18 },
  { playerName: 'T. O’Neill', goals: 19, assists: 11 },
  { playerName: 'D. Park', goals: 15, assists: 16 },
  { playerName: 'A. Vasquez', goals: 14, assists: 9 },
];

const trend: PerGameTrendDatum[] = [
  { date: '2024-03-15', points: 2 },
  { date: '2024-03-22', points: 5 },
  { date: '2024-03-29', points: 1 },
  { date: '2024-04-05', points: 4 },
  { date: '2024-04-12', points: 3 },
  { date: '2024-04-19', points: 6 },
  { date: '2024-04-26', points: 2 },
  { date: '2024-05-03', points: 7 },
];

renderQuarterByQuarter(mount('chart-qbq'), qbq);
renderSeasonRecord(mount('chart-record'), record);
renderTopScorers(mount('chart-scorers'), scorers);
renderPerGameTrend(mount('chart-trend'), trend);
