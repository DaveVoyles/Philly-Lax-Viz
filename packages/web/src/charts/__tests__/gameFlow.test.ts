import { beforeAll, describe, expect, it } from 'vitest';
import { renderGameFlow, type GameFlowData } from '../gameFlow.js';

beforeAll(() => {
  if (typeof globalThis.document !== 'undefined') return;

  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  class FakeStyle {
    cssText = '';
    private values = new Map<string, string>();

    setProperty(name: string, value: string): void {
      this.values.set(name, value);
    }

    getPropertyValue(name: string): string {
      return this.values.get(name) ?? '';
    }
  }

  class FakeElement {
    children: FakeElement[] = [];
    parentNode: FakeElement | null = null;
    ownerDocument: FakeDocument;
    namespaceURI: string;
    tagName: string;
    attributes = new Map<string, string>();
    style = new FakeStyle();
    textContent = '';

    constructor(ownerDocument: FakeDocument, tagName: string, namespaceURI: string) {
      this.ownerDocument = ownerDocument;
      this.tagName = tagName.toUpperCase();
      this.namespaceURI = namespaceURI;
    }

    get firstChild(): FakeElement | null {
      return this.children[0] ?? null;
    }

    appendChild(child: FakeElement): FakeElement {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child: FakeElement): FakeElement {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }

    set className(value: string) {
      this.setAttribute('class', value);
    }

    get className(): string {
      return this.getAttribute('class') ?? '';
    }
  }

  class FakeDocument {
    documentElement: FakeElement;

    constructor() {
      this.documentElement = new FakeElement(this, 'html', HTML_NS);
    }

    createElement(tagName: string): FakeElement {
      return new FakeElement(this, tagName, HTML_NS);
    }

    createElementNS(namespaceURI: string, tagName: string): FakeElement {
      return new FakeElement(this, tagName, namespaceURI);
    }
  }

  const document = new FakeDocument();
  (globalThis as unknown as { document: FakeDocument }).document = document;
  (globalThis as unknown as { window: { document: FakeDocument } }).window = { document };
  (globalThis as unknown as {
    getComputedStyle: (node: FakeElement) => { getPropertyValue(name: string): string };
  }).getComputedStyle = () => ({
    getPropertyValue(name: string): string {
      if (name === '--accent') return '#aa1144';
      return '';
    },
  });
});

function countByTag(node: { tagName: string; children: Array<{ tagName: string; children: unknown[] }> }, tagName: string): number {
  let count = node.tagName === tagName.toUpperCase() ? 1 : 0;
  for (const child of node.children) {
    count += countByTag(child as { tagName: string; children: Array<{ tagName: string; children: unknown[] }> }, tagName);
  }
  return count;
}

describe('renderGameFlow', () => {
  it('creates an SVG element', () => {
    const container = document.createElement('div') as unknown as HTMLElement;
    const data: GameFlowData = {
      homeTeam: 'Harriton',
      awayTeam: 'Radnor',
      periods: [
        { period: 1, homeGoals: 2, awayGoals: 1 },
        { period: 2, homeGoals: 1, awayGoals: 3 },
      ],
    };

    renderGameFlow(container, data);

    expect(countByTag(container as unknown as { tagName: string; children: Array<{ tagName: string; children: unknown[] }> }, 'svg')).toBe(1);
  });

  it('renders dots for both teams at each cumulative data point', () => {
    const container = document.createElement('div') as unknown as HTMLElement;
    const data: GameFlowData = {
      homeTeam: 'Home',
      awayTeam: 'Away',
      periods: [
        { period: 1, homeGoals: 3, awayGoals: 1 },
        { period: 2, homeGoals: 2, awayGoals: 2 },
        { period: 3, homeGoals: 1, awayGoals: 0 },
      ],
    };

    renderGameFlow(container, data);

    expect(countByTag(container as unknown as { tagName: string; children: Array<{ tagName: string; children: unknown[] }> }, 'circle')).toBe(8);
  });

  it('handles empty periods gracefully', () => {
    const container = document.createElement('div') as unknown as HTMLElement;

    renderGameFlow(container, {
      homeTeam: 'Home',
      awayTeam: 'Away',
      periods: [],
    });

    expect(countByTag(container as unknown as { tagName: string; children: Array<{ tagName: string; children: unknown[] }> }, 'svg')).toBe(0);
    expect((container as unknown as { firstChild: { textContent: string } | null }).firstChild?.textContent).toBe(
      'No period data available',
    );
  });
});
