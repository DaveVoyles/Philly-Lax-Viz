// Wave 17 Lane 2 (Han 🧑‍🚀🍔) — smoke test for postImage helpers.
// Pure assertions on the helper option contract — vitest in @pll/web runs
// in node, no DOM available, so we don't construct the elements here. The
// production view exercises them in a real browser via vite.

import { describe, it, expect } from 'vitest';
import {
  renderGameThumb,
  renderGameHero,
  renderPlayerAvatar,
  renderPostImage,
} from './postImage.js';

describe('postImage helpers (contract)', () => {
  it('all helpers are exported as functions', () => {
    expect(typeof renderGameThumb).toBe('function');
    expect(typeof renderGameHero).toBe('function');
    expect(typeof renderPlayerAvatar).toBe('function');
    expect(typeof renderPostImage).toBe('function');
  });

  it('helper signatures accept (url, alt) and (opts) shapes', () => {
    // Don't invoke (no DOM) — assert arity. Each variant returns an HTMLImageElement
    // and accepts a URL plus optional alt; renderPostImage takes a single options bag.
    expect(renderGameThumb.length).toBe(1); // url required, alt has default
    expect(renderGameHero.length).toBe(1);
    expect(renderPlayerAvatar.length).toBe(1);
    expect(renderPostImage.length).toBe(1); // options bag
  });
});

