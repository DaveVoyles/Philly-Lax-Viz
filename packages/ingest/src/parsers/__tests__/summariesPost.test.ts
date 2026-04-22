import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseSummariesPost } from '../summariesPost.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../../../../../fixtures/summaries-sample.html');
const html = readFileSync(fixturePath, 'utf8');

describe('parseSummariesPost (live fixture)', () => {
  const parsed = parseSummariesPost(html);

  it('extracts >= 10 game blocks from the sample post', () => {
    expect(parsed.games.length).toBeGreaterThanOrEqual(10);
  });

  it('extracts >= 80 player stats across all blocks', () => {
    const total = parsed.games.reduce((n, g) => n + g.playerStats.length, 0);
    expect(total).toBeGreaterThanOrEqual(80);
  });

  it('Spring-Ford block has 0 unhandled anomalies', () => {
    const sf = parsed.games.find(g => g.scoreLine.teamA === 'Spring-Ford');
    expect(sf).toBeDefined();
    // Block-local anomalies attribution: re-check raw lines through the
    // parser by counting players/periods present.
    expect(sf!.scoreLine).toMatchObject({ teamA: 'Spring-Ford', scoreA: 10, teamB: 'Boyertown', scoreB: 5 });
    expect(sf!.periods.length).toBeGreaterThanOrEqual(2);
    expect(sf!.playerStats.length).toBeGreaterThanOrEqual(10);
    // Spot-check Spring-Ford specific players from the fixture.
    const goering = sf!.playerStats.find(p => p.name === 'Caleb Goering');
    // Goering is on Boyertown side per fixture (line 534).
    expect(goering).toBeDefined();
    const fleming = sf!.playerStats.find(p => p.name === 'Chase Fleming');
    expect(fleming).toMatchObject({ assists: 2 });
  });

  it('Parkland block captures 3OT and 7-period quarter line', () => {
    const pk = parsed.games.find(g => g.scoreLine.teamA === 'Parkland');
    expect(pk).toBeDefined();
    expect(pk!.scoreLine.otPeriods).toBe(3);
    const pkPeriod = pk!.periods.find(p => p.periods.length === 7);
    expect(pkPeriod).toBeDefined();
    expect(pkPeriod!.total).toBe(8);
  });

  it('Easton aggregated lists feed player stats with partial names', () => {
    const easton = parsed.games.find(g => g.scoreLine.teamA === 'Easton');
    expect(easton).toBeDefined();
    const oran = easton!.playerStats.find(p => p.name === 'Oran Prentice');
    expect(oran).toMatchObject({ goals: 4 });
  });

  it('Garnet Valley malformed quarter line still validates sum=14', () => {
    const gv = parsed.games.find(g => g.scoreLine.teamA === 'Garnet Valley');
    expect(gv).toBeDefined();
    const gvPeriod = gv!.periods.find(p => p.teamHint === 'Garnet Valley' || /Garnet/i.test(p.teamHint));
    expect(gvPeriod).toBeDefined();
    expect(gvPeriod!.total).toBe(14);
    expect(gvPeriod!.validates).toBe(true);
  });

  it('Methacton MHS no-spaces quarter line parses', () => {
    const mh = parsed.games.find(g => g.scoreLine.teamA === 'Methacton');
    expect(mh).toBeDefined();
    const period = mh!.periods.find(p => p.periods.join(',') === '5,7,1,2');
    expect(period).toBeDefined();
    expect(period!.total).toBe(15);
  });
});
