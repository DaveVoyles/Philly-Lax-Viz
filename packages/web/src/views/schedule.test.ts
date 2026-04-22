// Smoke test for the lazy schedule chunk (W16 L2, Leia). Mirrors the
// constellation view test — we don't render in jsdom, just verify the
// module loads and exposes the render/destroy contract that main.ts
// depends on for lazy mounting + teardown.

import { describe, it, expect } from 'vitest';

describe('schedule view module', () => {
  it('imports without throwing and exports render + destroy', async () => {
    const mod = await import('./schedule.js');
    expect(typeof mod.render).toBe('function');
    expect(typeof mod.destroy).toBe('function');
    // destroy must be safe to call when nothing is mounted.
    expect(() => mod.destroy()).not.toThrow();
  });
});
