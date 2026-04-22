import { describe, it, expect } from 'vitest';
import { parseQuarterLine } from '../quarterLine.js';

describe('parseQuarterLine', () => {
  it('parses Spring-Ford en-dash line', () => {
    const r = parseQuarterLine('Spring-Ford 3 1 5 1 \u2013 10', ['Spring-Ford', 'Boyertown']);
    expect(r.result).toMatchObject({
      teamHint: 'Spring-Ford',
      periods: [3, 1, 5, 1],
      total: 10,
      validates: true,
    });
  });

  it('parses Methacton MHS hyphen-equals line', () => {
    const r = parseQuarterLine('MHS 5-7-1-2=15', ['Methacton', 'Phoenixville']);
    expect(r.result).toMatchObject({
      periods: [5, 7, 1, 2],
      total: 15,
      validates: true,
    });
    // Initial-letter resolution: MHS != Methacton-only-initials. Should fall
    // through to substring/raw.
    expect(r.result?.teamHint).toMatch(/MHS|Methacton/);
  });

  it('parses Easton colon-comma-en-dash line', () => {
    const r = parseQuarterLine('Easton: 6, 3, 3, 2 \u2013 14', ['Easton', 'Northampton']);
    expect(r.result).toMatchObject({
      teamHint: 'Easton',
      periods: [6, 3, 3, 2],
      total: 14,
      validates: true,
    });
  });

  it('parses Parkland 7-period (3OT) line', () => {
    const r = parseQuarterLine('Parkland: 1-4-0-2-0-0-1=8', ['Parkland', 'Nazareth']);
    expect(r.result).toMatchObject({
      teamHint: 'Parkland',
      periods: [1, 4, 0, 2, 0, 0, 1],
      total: 8,
      validates: true,
    });
  });

  it('parses malformed Garnet Valley line with stray periods', () => {
    const r = parseQuarterLine('Garnet Valley 4 2. 5. 3. =14', ['Garnet Valley', 'Radnor']);
    expect(r.result).toMatchObject({
      teamHint: 'Garnet Valley',
      periods: [4, 2, 5, 3],
      total: 14,
      validates: true,
    });
  });

  it('flags sum mismatch as anomaly but still returns partial', () => {
    const r = parseQuarterLine('Foo 1 2 3 4 = 99', ['Foo', 'Bar']);
    expect(r.result?.validates).toBe(false);
    expect(r.anomalies[0]?.reason).toMatch(/sum mismatch/);
  });

  it('rejects line with no team hint', () => {
    const r = parseQuarterLine('1 2 3 4 = 10', ['Foo', 'Bar']);
    expect(r.result).toBeNull();
  });
});
