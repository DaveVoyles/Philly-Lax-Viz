import { describe, it, expect, beforeAll } from 'vitest';

// Minimal DOM stub — the @pll/web vitest config runs in node without jsdom
// (see other view tests). We only need the surface that renderAnomalyBanner
// touches: createElement / createTextNode + element basics.
beforeAll(() => {
  if (typeof globalThis.document !== 'undefined') return;

  class StubNode {
    nodeType = 1;
    childNodes: StubNode[] = [];
    parentNode: StubNode | null = null;
    _textContent = '';
    appendChild(child: StubNode): StubNode {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    get textContent(): string {
      if (this.childNodes.length === 0) return this._textContent;
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v: string) {
      this.childNodes = [];
      this._textContent = v;
    }
  }

  class StubText extends StubNode {
    constructor(text: string) {
      super();
      this._textContent = text;
    }
  }

  class StubClassList {
    private set = new Set<string>();
    constructor(initial = '') {
      if (initial) initial.split(/\s+/).forEach((c) => c && this.set.add(c));
    }
    add(c: string): void {
      this.set.add(c);
    }
    remove(c: string): void {
      this.set.delete(c);
    }
    contains(c: string): boolean {
      return this.set.has(c);
    }
    toString(): string {
      return [...this.set].join(' ');
    }
  }

  class StubElement extends StubNode {
    tagName: string;
    private attrs = new Map<string, string>();
    classList: StubClassList;
    dataset: Record<string, string> = {};
    constructor(tag: string) {
      super();
      this.tagName = tag.toUpperCase();
      this.classList = new StubClassList();
    }
    get className(): string {
      return this.classList.toString();
    }
    set className(v: string) {
      this.classList = new StubClassList(v);
    }
    setAttribute(k: string, v: string): void {
      this.attrs.set(k, v);
      if (k === 'href') (this as unknown as { href: string }).href = v;
    }
    getAttribute(k: string): string | null {
      return this.attrs.has(k) ? (this.attrs.get(k) as string) : null;
    }
    querySelector(sel: string): StubElement | null {
      const m = sel.match(/^([a-z]+)?\.([a-zA-Z0-9_-]+)$/);
      if (!m) return null;
      const [, tag, cls] = m;
      const walk = (n: StubNode): StubElement | null => {
        for (const c of n.childNodes) {
          if (c instanceof StubElement) {
            const tagOk = !tag || c.tagName === tag.toUpperCase();
            if (tagOk && c.classList.contains(cls as string)) return c;
            const found = walk(c);
            if (found) return found;
          }
        }
        return null;
      };
      return walk(this);
    }
  }

  class StubAnchor extends StubElement {
    href = '';
    target = '';
    rel = '';
    constructor() {
      super('a');
    }
    override setAttribute(k: string, v: string): void {
      super.setAttribute(k, v);
      if (k === 'href') this.href = v;
    }
  }

  const doc = {
    createElement(tag: string): StubElement {
      if (tag === 'a') return new StubAnchor();
      return new StubElement(tag);
    },
    createTextNode(text: string): StubText {
      return new StubText(text);
    },
  };
  (globalThis as unknown as { document: typeof doc }).document = doc;
});

import { renderAnomalyBanner } from '../anomalyBanner.js';

describe('renderAnomalyBanner', () => {
  it('renders a yellow warning banner for team-score-exceeded', () => {
    const el = renderAnomalyBanner({
      kind: 'team-score-exceeded',
      gameId: 42,
      teamName: 'Springfield',
      playerSum: 174,
      teamScore: 12,
      sourceUrl: 'https://example.com/g/42',
    });
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('anomaly-banner')).toBe(true);
    expect(el.classList.contains('reconciled')).toBe(false);
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.dataset['gameId']).toBe('42');
    expect(el.textContent).toContain('⚠️');
    expect(el.textContent).toContain('Springfield');
    expect(el.textContent).toContain('174');
    expect(el.textContent).toContain('12');
    const link = el.querySelector('a.anomaly-banner-source') as
      | (HTMLAnchorElement & { href: string })
      | null;
    expect(link?.href).toContain('example.com/g/42');
  });

  it('renders a friendlier reconciled banner', () => {
    const el = renderAnomalyBanner({
      kind: 'reconciled',
      gameId: 7,
      teamName: 'Springfield',
    });
    expect(el.classList.contains('reconciled')).toBe(true);
    expect(el.getAttribute('role')).toBe('status');
    expect(el.textContent).toContain('✅');
    expect(el.textContent?.toLowerCase()).toContain('reconciled');
    expect(el.textContent).toContain('Springfield');
    expect(el.querySelector('a.anomaly-banner-source')).toBeNull();
  });
});
