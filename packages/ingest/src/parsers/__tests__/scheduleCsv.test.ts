import { describe, it, expect } from 'vitest';
import { parseScheduleCsv, splitCsvLine } from '../scheduleCsv.js';

describe('splitCsvLine', () => {
  it('handles quoted fields with embedded commas', () => {
    expect(splitCsvLine('"a","b,c","d"')).toEqual(['a', 'b,c', 'd']);
  });
  it('handles unquoted simple fields', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('handles escaped double-quote inside quoted field', () => {
    expect(splitCsvLine('"x""y","z"')).toEqual(['x"y', 'z']);
  });
});

const SAMPLE = [
  '"Date","Sport","Game Completed","Exclude From Ranking","Home Team","Home Score","Visitor Team","Visitor Score"',
  '"2026-05-11","Boys Lacrosse","No","No","CHELTENHAM","0","UPPER DARBY","0"',
  '"2026-04-15","Boys Lacrosse","Yes","No","Haverford","12","Episcopal Academy","8"',
  '"2026-05-13","Boys Lacrosse","No","No","CB West","0","Pennridge","0"',
  '"bad-date","Boys Lacrosse","No","No","X","0","Y","0"',
  '"2026-05-20","Boys Lacrosse","No","No","","0","Z","0"',
].join('\n');

describe('parseScheduleCsv', () => {
  it('parses a 3-good-row sample and reports malformed rows', () => {
    const out = parseScheduleCsv(SAMPLE);
    expect(out.rows.length).toBe(3);
    expect(out.malformed.length).toBe(2);
  });

  it('preserves date, raw team names, and completed flag', () => {
    const out = parseScheduleCsv(SAMPLE);
    const upcoming = out.rows.filter((r) => !r.completed);
    expect(upcoming.length).toBe(2);
    const cheltenham = upcoming.find((r) => r.homeTeamRaw === 'CHELTENHAM');
    expect(cheltenham).toBeDefined();
    expect(cheltenham!.date).toBe('2026-05-11');
    expect(cheltenham!.awayTeamRaw).toBe('UPPER DARBY');
    const completed = out.rows.find((r) => r.completed);
    expect(completed).toBeDefined();
    expect(completed!.homeScore).toBe(12);
    expect(completed!.awayScore).toBe(8);
  });

  it('strips BOM and tolerates CRLF', () => {
    const csv = '\uFEFF' + SAMPLE.replace(/\n/g, '\r\n');
    const out = parseScheduleCsv(csv);
    expect(out.rows.length).toBe(3);
  });

  it('returns empty result for empty input without throwing', () => {
    const out = parseScheduleCsv('');
    expect(out.rows).toEqual([]);
    expect(out.malformed).toEqual([]);
  });
});
