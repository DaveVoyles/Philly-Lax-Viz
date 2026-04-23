// Wave H5 Lane 3 (Leia) — confidence badge unit tests.
//
// Vitest for @pll/web runs in node (no jsdom), so we test the pure
// `confidenceBadge` mapping directly. The DOM-rendering wrapper
// `renderConfidenceBadge` is a thin shell over `document.createElement`
// and is exercised at runtime via playerDetail/gameDetail views.

import { describe, it, expect } from 'vitest';
import { confidenceBadge } from '../../util/confidence.js';

describe('confidenceBadge', () => {
  it('returns 🟢 high for confidence ≥ 0.9', () => {
    const b = confidenceBadge(0.9);
    expect(b).not.toBeNull();
    expect(b?.emoji).toBe('🟢');
    expect(b?.level).toBe('high');
    expect(b?.title).toMatch(/High confidence/);
  });

  it('still returns 🟢 high for 1.0', () => {
    expect(confidenceBadge(1)?.emoji).toBe('🟢');
  });

  it('returns 🟡 medium for 0.7–0.89', () => {
    const b = confidenceBadge(0.7);
    expect(b?.emoji).toBe('🟡');
    expect(b?.level).toBe('medium');
    expect(confidenceBadge(0.85)?.emoji).toBe('🟡');
  });

  it('returns 🔴 low for confidence < 0.7', () => {
    const b = confidenceBadge(0.6);
    expect(b).not.toBeNull();
    expect(b?.emoji).toBe('🔴');
    expect(b?.level).toBe('low');
    expect(b?.title).toMatch(/Low confidence/);
    expect(confidenceBadge(0.3)?.emoji).toBe('🔴');
  });

  it('returns null when confidence is missing', () => {
    expect(confidenceBadge(undefined)).toBeNull();
    expect(confidenceBadge(null)).toBeNull();
    expect(confidenceBadge(Number.NaN)).toBeNull();
  });
});
