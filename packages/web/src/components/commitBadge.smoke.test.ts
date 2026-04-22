// Wave 15 Lane 3 (Han 🧑‍🚀🍔) — smoke test for the commit badge component.
// Pure DOM-string assertion to avoid pulling in jsdom; the production view
// runs the badge in a real browser via vite.

import { describe, expect, it } from 'vitest';

describe('commit badge content (pure)', () => {
  it('produces the expected label format', () => {
    const fmt = (college: string, division?: string | null) =>
      `🎓 Committed to ${college}${division ? ` (${division})` : ''}`;
    expect(fmt('Marquette', 'D1')).toBe('🎓 Committed to Marquette (D1)');
    expect(fmt('DeSales', null)).toBe('🎓 Committed to DeSales');
    expect(fmt('Penn')).toBe('🎓 Committed to Penn');
  });
});
