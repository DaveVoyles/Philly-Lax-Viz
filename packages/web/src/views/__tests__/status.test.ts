// Wave H4 Lane 3 (Leia) — smoke test for the /status view.
//
// Vitest runs in node (no jsdom) for @pll/web. We stub fetch and provide
// a minimal HTMLElement-shaped root that records appended children, so we
// can verify render() does not throw and writes something into the card.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeNode {
  tagName: string;
  textContent: string;
  className: string;
  id: string;
  href: string;
  style: { cssText: string };
  dataset: Record<string, string>;
  children: FakeNode[];
  ownerDocument: FakeDocument;
  appendChild(c: FakeNode): FakeNode;
  replaceChildren(...c: FakeNode[]): void;
}

interface FakeDocument {
  createElement(tag: string): FakeNode;
}

function makeDoc(): FakeDocument {
  const doc: FakeDocument = {
    createElement(tag: string): FakeNode {
      const node: FakeNode = {
        tagName: tag.toUpperCase(),
        textContent: '',
        className: '',
        id: '',
        href: '',
        style: { cssText: '' },
        dataset: {},
        children: [],
        ownerDocument: doc,
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        replaceChildren(...c) {
          this.children = c;
        },
      };
      return node;
    },
  };
  return doc;
}

function makeRoot(): FakeNode {
  const doc = makeDoc();
  return doc.createElement('div');
}

describe('status view', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete (globalThis as { fetch?: typeof globalThis.fetch }).fetch;
    vi.restoreAllMocks();
  });

  it('exports a render function', async () => {
    const mod = await import('../status.js');
    expect(typeof mod.render).toBe('function');
  });

  it('renders without throwing on a stubbed fetch', async () => {
    const fakeFreshness = {
      scoreboardLast: '2026-04-22T12:00:00.000Z',
      recapsLast: null,
      rankingsLast: null,
      scheduleLast: null,
      piaaLast: null,
      aliasesLast: null,
      laxnumbersLast: null,
      lastIngestAt: '2026-04-23T10:00:00.000Z',
      counts: {
        teams: 42,
        games: 100,
        players: 999,
        scheduleGames: 5,
        playerAliases: 3,
        piaaTeams: 50,
        laxnumbersGames: 10,
      },
      generatedAt: '2026-04-23T14:00:00.000Z',
    };
    const fakeAnomalies = { totalCount: 7, byReason: [], topRawLines: [] };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url.includes('anomalies') ? fakeAnomalies : fakeFreshness;
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }) as typeof globalThis.fetch;

    const mod = await import('../status.js');
    const root = makeRoot() as unknown as HTMLElement;

    expect(() => mod.render(root, {})).not.toThrow();

    // wait for the async loadStatus() chain to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    const fakeRoot = root as unknown as FakeNode;
    expect(fakeRoot.children.length).toBeGreaterThan(0);
    expect(fakeRoot.children[0]?.textContent).toBe('Status');
  });

  it('relativeFromNow formats minutes/hours/days', async () => {
    const mod = await import('../status.js');
    const now = Date.parse('2026-04-23T12:00:00.000Z');
    expect(mod.__test.relativeFromNow('2026-04-23T11:59:50.000Z', now)).toBe('just now');
    expect(mod.__test.relativeFromNow('2026-04-23T11:30:00.000Z', now)).toBe('30m ago');
    expect(mod.__test.relativeFromNow('2026-04-23T09:00:00.000Z', now)).toBe('3h ago');
    expect(mod.__test.relativeFromNow('2026-04-21T12:00:00.000Z', now)).toBe('2d ago');
    expect(mod.__test.relativeFromNow(null, now)).toBe('unknown');
  });
});
