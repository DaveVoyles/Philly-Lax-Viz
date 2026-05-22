import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseGoaliesHtml,
  parseScheduleHtml,
  parseScorersHtml,
  parseStandingsHtml,
} from '../sportability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../../../../../fixtures/sportability');

const standingsHtml = readFileSync(
  resolve(fixtureDir, 'standings-50731-sample.html'),
  'utf8',
);
const scorersHtml = readFileSync(
  resolve(fixtureDir, 'scorers-50731-sample.html'),
  'utf8',
);
const goaliesHtml = readFileSync(
  resolve(fixtureDir, 'goalies-50731-sample.html'),
  'utf8',
);
const scheduleHtml = readFileSync(
  resolve(fixtureDir, 'schedule-50731-sample.html'),
  'utf8',
);

describe('parseStandingsHtml', () => {
  it('extracts team standings from Sportability table rows', () => {
    expect(parseStandingsHtml(standingsHtml)).toEqual([
      {
        id: 343517,
        name: 'More Dudes LC',
        gp: 1,
        wins: 1,
        losses: 0,
        ties: 0,
        otw: 0,
        otl: 0,
        pts: 3,
        pf: 14,
        pa: 5,
        diff: 9,
        streak: 'W1',
      },
    ]);
  });
});

describe('parseScorersHtml', () => {
  it('extracts player stats and ignores non-player filter rows', () => {
    expect(parseScorersHtml(scorersHtml)).toEqual([
      {
        jersey: 92,
        name: 'Brian Beatson',
        team: 'Outlaws',
        gp: 2,
        goals: 2,
        assists: 6,
        points: 8,
        penalties: 0,
        pim: 0,
      },
    ]);
  });
});

describe('parseGoaliesHtml', () => {
  it('extracts goalie stats and parses decimal GAA values', () => {
    expect(parseGoaliesHtml(goaliesHtml)).toEqual([
      {
        jersey: 0,
        name: 'Bryce Kash',
        team: 'Outlaws',
        gp: 2,
        min: 72,
        ga: 8,
        gaa: 6.667,
      },
    ]);
  });
});

describe('parseScheduleHtml', () => {
  it('extracts played and unplayed games while carrying the date forward', () => {
    expect(parseScheduleHtml(scheduleHtml)).toEqual([
      {
        gameNum: 1,
        date: '2026-05-18',
        time: '7:00p',
        homeTeam: 'More Dudes LC',
        awayTeam: 'Outlaws',
        homeScore: 14,
        awayScore: 5,
        location: 'Rizzo Rink',
        isPlayoff: false,
        note: '',
      },
      {
        gameNum: 2,
        date: '2026-05-18',
        time: '8:00p',
        homeTeam: 'Thunder',
        awayTeam: 'Edge',
        homeScore: 0,
        awayScore: 0,
        location: 'Rizzo Rink',
        isPlayoff: false,
        note: '',
      },
    ]);
  });
});
