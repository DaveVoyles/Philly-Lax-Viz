// W17 L3 (R2) — sources view smoke test.
//
// Vitest runs in the node environment for @pll/web (no jsdom), so we
// follow the same convention as constellation.test.ts / schedule.test.ts:
// import the module and verify the public contract.

import { describe, it, expect } from 'vitest';

describe('sources view module', () => {
  it('imports without throwing and exports render()', async () => {
    const mod = await import('./sources.js');
    expect(typeof mod.render).toBe('function');
  });

  it('render() reaches into the DOM (sanity: it really wants a real element)', async () => {
    const mod = await import('./sources.js');
    // Without a real document/HTMLElement (node env), render must throw.
    // This catches "stub that does nothing" regressions.
    expect(() => mod.render(null as unknown as HTMLElement, {})).toThrow();
  });
});
