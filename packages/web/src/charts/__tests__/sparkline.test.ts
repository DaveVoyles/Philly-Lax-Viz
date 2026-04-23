// Wave H7 L2 (Yoda) — pure-math tests for sparkline normalization.

import { describe, expect, it } from 'vitest';
import { normalizeForSparkline, drawSparkline } from '../sparkline.js';

describe('normalizeForSparkline', () => {
  it('returns empty for empty input', () => {
    expect(normalizeForSparkline([], 80, 24)).toEqual([]);
  });

  it('returns one centered point for a single value', () => {
    const pts = normalizeForSparkline([5], 80, 24, 2);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.x).toBeCloseTo(40);
    expect(pts[0]?.y).toBeCloseTo(12);
  });

  it('spreads x evenly across the inner width', () => {
    const pts = normalizeForSparkline([0, 1, 2, 3], 80, 24, 0);
    expect(pts.map((p) => p.x)).toEqual([0, 80 / 3, (80 / 3) * 2, 80]);
  });

  it('inverts y so larger values are closer to top', () => {
    const pts = normalizeForSparkline([0, 10], 80, 24, 0);
    expect(pts[0]?.y).toBeCloseTo(24);
    expect(pts[1]?.y).toBeCloseTo(0);
  });

  it('puts equal values on the vertical midline', () => {
    const pts = normalizeForSparkline([4, 4, 4], 80, 24, 0);
    for (const p of pts) {
      expect(p.y).toBeCloseTo(12);
    }
  });

  it('scales arbitrary values into [padding, height-padding]', () => {
    const pad = 2;
    const pts = normalizeForSparkline([2, 5, 1, 8, 3], 100, 40, pad);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(pad);
      expect(p.x).toBeLessThanOrEqual(100 - pad);
      expect(p.y).toBeGreaterThanOrEqual(pad);
      expect(p.y).toBeLessThanOrEqual(40 - pad);
    }
  });
});

describe('drawSparkline (smoke)', () => {
  it('does not throw when canvas has no 2d context (jsdom-style)', () => {
    const fake = {
      width: 80,
      height: 24,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(() => drawSparkline(fake, [1, 2, 3])).not.toThrow();
  });

  it('exercises ctx calls when a 2d context is available', () => {
    const calls: string[] = [];
    const ctx = {
      clearRect: () => calls.push('clearRect'),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      stroke: () => calls.push('stroke'),
      setLineDash: () => calls.push('setLineDash'),
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: '',
      lineCap: '',
    };
    const fake = {
      width: 80,
      height: 24,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    drawSparkline(fake, [1, 3, 2, 5]);
    expect(calls).toContain('beginPath');
    expect(calls).toContain('moveTo');
    expect(calls).toContain('lineTo');
    expect(calls).toContain('stroke');
  });

  it('renders a dotted baseline for empty/single-value input', () => {
    const calls: string[] = [];
    const ctx = {
      clearRect: () => calls.push('clearRect'),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      stroke: () => calls.push('stroke'),
      setLineDash: (_: number[]) => calls.push('setLineDash'),
      strokeStyle: '',
      lineWidth: 0,
    };
    const fake = {
      width: 80,
      height: 24,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;
    drawSparkline(fake, []);
    expect(calls).toContain('setLineDash');
    expect(calls).toContain('stroke');
  });
});
