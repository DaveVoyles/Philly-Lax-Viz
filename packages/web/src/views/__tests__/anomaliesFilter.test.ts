// Wave H8 Lane 3 (Leia) — unit tests for anomalies strategy filter helpers.

import { describe, it, expect } from 'vitest';
import type { IngestAnomaly } from '@pll/shared';
import {
  groupByStrategy,
  parseStrategyParam,
  buildStrategyHash,
} from '../anomaliesFilter.js';

function mk(id: number, strategy: IngestAnomaly['strategyAttempted'], rawLine = `r${id}`): IngestAnomaly {
  return {
    id,
    sourcePostId: `p${id}`,
    sourceUrl: `https://example.com/${id}`,
    rawLine,
    parentGameId: null,
    strategyAttempted: strategy,
    reason: 'r',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('groupByStrategy', () => {
  it('groups rows by strategyAttempted and preserves input order within groups', () => {
    const rows = [
      mk(1, 'player-stat-line', 'a'),
      mk(2, 'quarter-line', 'b'),
      mk(3, 'player-stat-line', 'c'),
      mk(4, 'composite-name-detected', 'd'),
      mk(5, 'player-stat-line', 'e'),
    ];
    const g = groupByStrategy(rows);
    expect([...g.keys()]).toEqual(['player-stat-line', 'quarter-line', 'composite-name-detected']);
    expect(g.get('player-stat-line')!.map((r) => r.rawLine)).toEqual(['a', 'c', 'e']);
    expect(g.get('quarter-line')!.map((r) => r.rawLine)).toEqual(['b']);
    expect(g.get('composite-name-detected')!.map((r) => r.rawLine)).toEqual(['d']);
  });

  it('returns an empty map for empty input', () => {
    expect(groupByStrategy([]).size).toBe(0);
  });
});

describe('parseStrategyParam', () => {
  it('returns null when no query string is present', () => {
    expect(parseStrategyParam('#/anomalies')).toBeNull();
    expect(parseStrategyParam('')).toBeNull();
  });

  it('returns null when strategy param is missing or empty', () => {
    expect(parseStrategyParam('#/anomalies?other=x')).toBeNull();
    expect(parseStrategyParam('#/anomalies?strategy=')).toBeNull();
  });

  it('extracts a simple strategy value', () => {
    expect(parseStrategyParam('#/anomalies?strategy=player-stat-line')).toBe('player-stat-line');
  });

  it('decodes URL-encoded values (including +)', () => {
    expect(parseStrategyParam('#/anomalies?strategy=composite-name-detected')).toBe(
      'composite-name-detected',
    );
    expect(parseStrategyParam('#/anomalies?strategy=foo%20bar')).toBe('foo bar');
    expect(parseStrategyParam('#/anomalies?strategy=foo+bar')).toBe('foo bar');
  });

  it('finds strategy alongside other params', () => {
    expect(parseStrategyParam('#/anomalies?x=1&strategy=quarter-line&y=2')).toBe('quarter-line');
  });
});

describe('buildStrategyHash', () => {
  it('returns the bare hash when strategy is null or empty', () => {
    expect(buildStrategyHash(null)).toBe('#/anomalies');
    expect(buildStrategyHash('')).toBe('#/anomalies');
  });

  it('encodes the strategy value into the query string', () => {
    expect(buildStrategyHash('player-stat-line')).toBe('#/anomalies?strategy=player-stat-line');
    expect(buildStrategyHash('foo bar')).toBe('#/anomalies?strategy=foo%20bar');
  });

  it('round-trips with parseStrategyParam', () => {
    for (const s of ['player-stat-line', 'composite-name-detected', 'cross-team-duplicate-name', 'foo bar']) {
      expect(parseStrategyParam(buildStrategyHash(s))).toBe(s);
    }
  });
});
