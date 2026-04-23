// Smoke test for the lazy constellation chunk (W15 L2, R2). Vitest runs in
// the node environment, so we don't try to render — just confirm the module
// imports cleanly and exposes the render/destroy contract that main.ts
// depends on.

import { describe, it, expect } from 'vitest';

// pixi.js (transitively imported by ./constellation) probes `navigator` at
// module-eval time to detect Safari. Vitest's node environment doesn't define
// navigator, so we stub a minimal one before the dynamic import.
if (typeof (globalThis as { navigator?: unknown }).navigator === 'undefined') {
  (globalThis as { navigator?: unknown }).navigator = { userAgent: 'node' };
}

describe('constellation view module', () => {
  it('imports without throwing and exports render + destroy', async () => {
    const mod = await import('./constellation.js');
    expect(typeof mod.render).toBe('function');
    expect(typeof mod.destroy).toBe('function');
    // destroy must be safe to call when nothing is mounted.
    expect(() => mod.destroy()).not.toThrow();
  });
});
