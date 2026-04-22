import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseScoreboardPost } from '../scoreboardPost.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, '../../../../../fixtures/scoreboard-sample.html');
const html = readFileSync(fixturePath, 'utf8');

describe('parseScoreboardPost (live fixture)', () => {
  const parsed = parseScoreboardPost(html);

  it('returns >= 30 played boys games for April 21', () => {
    const apr21 = parsed.games.filter(g => /April 21/i.test(g.dateLabel));
    expect(apr21.length).toBeGreaterThanOrEqual(30);
  });

  it('skips schedule "at" lines from the Today section', () => {
    const today = parsed.games.filter(g => /Today/i.test(g.dateLabel));
    // None should look like schedule lines (they would have parsed as null anyway,
    // but double-check there are no games here since Today's section is all schedule).
    expect(today.length).toBe(0);
  });

  it('skips postponed games', () => {
    const apr20 = parsed.games.filter(g => /April 20/i.test(g.dateLabel));
    const ppd = apr20.find(g => /Conwell-Egan/i.test(g.teamA) && /Bonner/i.test(g.teamB));
    expect(ppd).toBeUndefined();
  });

  it('captures Parkland 3OT in April 21 boys', () => {
    const pk = parsed.games.find(g => g.teamA === 'Parkland' && g.scoreA === 8);
    expect(pk).toBeDefined();
    expect(pk!.otPeriods).toBe(3);
  });

  it('captures Spring-Ford 10, Boyertown 5 in April 21 boys', () => {
    const sf = parsed.games.find(g => g.teamA === 'Spring-Ford' && /April 21/i.test(g.dateLabel));
    expect(sf).toMatchObject({ scoreA: 10, teamB: 'Boyertown', scoreB: 5 });
  });

  it('does NOT include girls games', () => {
    // "Twin Valley 12, Wyomissing 7" appears in Girls section on April 21.
    const tw = parsed.games.find(
      g => g.teamA === 'Twin Valley' && g.scoreA === 12 && /April 21/i.test(g.dateLabel),
    );
    expect(tw).toBeUndefined();
  });
});
