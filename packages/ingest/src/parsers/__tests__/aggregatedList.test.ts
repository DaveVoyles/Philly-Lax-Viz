import { describe, it, expect } from 'vitest';
import { parseAggregatedList } from '../aggregatedList.js';

describe('parseAggregatedList', () => {
  it('parses Easton count-first goals list', () => {
    const r = parseAggregatedList(
      'Easton goals: 4 Oran Prentice, 3 Sean McPeek, 3 Evan Placotaris, 2 Peter Assise, 1 Dylan Lamas, 1 Nicholas Bachman',
    );
    expect(r.results).toHaveLength(6);
    expect(r.results[0]).toMatchObject({ name: 'Oran Prentice', goals: 4 });
    expect(r.results[5]).toMatchObject({ name: 'Nicholas Bachman', goals: 1 });
  });

  it('parses Parkland name-first variant with bare names defaulting to 1', () => {
    const r = parseAggregatedList('Parkland Goals: Arezzi 3, Tapia 2, Gerancher, Fisher, Scott');
    expect(r.results).toHaveLength(5);
    expect(r.results[0]).toMatchObject({ name: 'Arezzi', goals: 3, isPartialName: true });
    expect(r.results[1]).toMatchObject({ name: 'Tapia', goals: 2 });
    expect(r.results[2]).toMatchObject({ name: 'Gerancher', goals: 1, isPartialName: true });
    expect(r.results[4]).toMatchObject({ name: 'Scott', goals: 1 });
  });

  it('parses last-name-only with implicit goal of 1 inside list', () => {
    const r = parseAggregatedList('Easton goals: 1 Tomko');
    expect(r.results[0]).toMatchObject({ name: 'Tomko', goals: 1, isPartialName: true });
  });

  it('parses assists header', () => {
    const r = parseAggregatedList('Easton assists: 4 Sean McPeek, 1 Peter Assise');
    expect(r.results[0]).toMatchObject({ name: 'Sean McPeek', assists: 4, goals: 0 });
  });

  it('parses saves header', () => {
    const r = parseAggregatedList('Parkland Saves: Fehnel 13');
    expect(r.results[0]).toMatchObject({ name: 'Fehnel', saves: 13 });
  });
});
