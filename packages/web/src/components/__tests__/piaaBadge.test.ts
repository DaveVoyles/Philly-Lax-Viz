import { beforeAll, describe, expect, it } from 'vitest';
import { renderPiaaBadge } from '../piaaBadge.js';
import type { DerivedRecord, PiaaRecord, PiaaValidation } from '@pll/shared';

beforeAll(() => {
  if (typeof globalThis.document !== 'undefined') return;

  class StubClassList {
    private set = new Set<string>();
    constructor(initial = '') {
      if (initial) initial.split(/\s+/).forEach((c) => c && this.set.add(c));
    }
    add(c: string): void {
      this.set.add(c);
    }
    contains(c: string): boolean {
      return this.set.has(c);
    }
    toString(): string {
      return [...this.set].join(' ');
    }
  }

  class StubElement {
    classList = new StubClassList();
    title = '';
    textContent = '';
    href = '';
    target = '';
    rel = '';
    childNodes: StubElement[] = [];
    private attrs = new Map<string, string>();
    get className(): string {
      return this.classList.toString();
    }
    set className(v: string) {
      this.classList = new StubClassList(v);
    }
    setAttribute(k: string, v: string): void {
      this.attrs.set(k, v);
    }
    getAttribute(k: string): string | null {
      return this.attrs.get(k) ?? null;
    }
    appendChild(child: StubElement): StubElement {
      this.childNodes.push(child);
      return child;
    }
    addEventListener(): void {}
  }

  const doc = {
    createElement(): StubElement {
      return new StubElement();
    },
  };
  (globalThis as unknown as { document: typeof doc }).document = doc;
});

const derived: DerivedRecord = { wins: 10, losses: 2, ties: 0 };
const piaa: PiaaRecord = {
  wins: 10,
  losses: 2,
  ties: 0,
  seed: 1,
  classification: '3A',
  ranking: 1,
  totalPoints: 12.5,
  nameOfficial: 'Alpha HS',
};

function validation(status: PiaaValidation['status'], totalDiff: number | null): PiaaValidation {
  return {
    status,
    winDiff: totalDiff === null ? null : 0,
    lossDiff: totalDiff === null ? null : 0,
    totalDiff,
    sourceUrl: 'https://example.com/piaa',
  };
}

describe('renderPiaaBadge', () => {
  it('renders a labeled match badge for team cards', () => {
    const badge = renderPiaaBadge({
      validation: validation('match', 0),
      derived,
      piaa,
      variant: 'label',
    });

    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('✓ PIAA');
    expect((badge as HTMLElement).className).toContain('piaa-badge--label');
    expect((badge as HTMLElement).className).toContain('piaa-badge--match');
  });

  it('hides unmapped badges when requested', () => {
    const badge = renderPiaaBadge({
      validation: validation('unmapped', null),
      derived,
      piaa: null,
      variant: 'label',
      hideUnmapped: true,
    });

    expect(badge).toBeNull();
  });
});
