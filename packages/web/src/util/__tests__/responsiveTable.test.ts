import { describe, it, expect, beforeAll } from 'vitest';
import { wrapResponsive } from '../responsiveTable.js';

// Minimal DOM shim — vitest runs in `node` env per repo convention. We only
// need createElement + parent/child wiring, so a tiny stub is enough.
beforeAll(() => {
  if (typeof globalThis.document !== 'undefined') return;

  class ClassList {
    private set = new Set<string>();
    add(c: string): void { this.set.add(c); }
    remove(c: string): void { this.set.delete(c); }
    contains(c: string): boolean { return this.set.has(c); }
    clear(): void { this.set.clear(); }
    toString(): string { return [...this.set].join(' '); }
  }
  class Node {
    children: Node[] = [];
    parentElement: Node | null = null;
    classList = new ClassList();
    tagName: string;
    constructor(tag: string) {
      this.tagName = tag.toUpperCase();
    }
    appendChild(c: Node): Node {
      if (c.parentElement) {
        c.parentElement.children = c.parentElement.children.filter((x) => x !== c);
      }
      c.parentElement = this;
      this.children.push(c);
      return c;
    }
    insertBefore(node: Node, ref: Node): Node {
      if (node.parentElement) {
        node.parentElement.children = node.parentElement.children.filter((x) => x !== node);
      }
      node.parentElement = this;
      const idx = this.children.indexOf(ref);
      if (idx === -1) this.children.push(node);
      else this.children.splice(idx, 0, node);
      return node;
    }
  }
  class Element extends Node {
    get className(): string {
      return this.classList.toString();
    }
    set className(v: string) {
      this.classList.clear();
      for (const c of v.split(/\s+/).filter(Boolean)) this.classList.add(c);
    }
  }
  // Subclasses bag classList behavior so `instanceof` and tagName checks work.
  class HTMLDivElement extends Element {}
  class HTMLTableElement extends Element {}

  (globalThis as any).document = {
    createElement(tag: string): Element {
      if (tag === 'div') return new HTMLDivElement('div');
      if (tag === 'table') return new HTMLTableElement('table');
      return new Element(tag);
    },
  };
});

describe('wrapResponsive', () => {
  it('wraps a table in a div.table-scroll', () => {
    const table = document.createElement('table') as unknown as HTMLTableElement;
    const wrap = wrapResponsive(table);
    expect(wrap.className).toBe('table-scroll');
    expect((table as any).parentElement).toBe(wrap);
  });

  it('is idempotent — calling twice returns the same wrapper', () => {
    const table = document.createElement('table') as unknown as HTMLTableElement;
    const w1 = wrapResponsive(table);
    const w2 = wrapResponsive(table);
    expect(w1).toBe(w2);
    expect((table as any).parentElement).toBe(w1);
  });

  it('preserves parent linkage — wrapper takes the table’s spot in its parent', () => {
    const parent = document.createElement('div');
    const table = document.createElement('table') as unknown as HTMLTableElement;
    parent.appendChild(table);

    const wrap = wrapResponsive(table);
    expect((wrap as any).parentElement).toBe(parent);
    expect((parent as any).children).toContain(wrap);
    expect((parent as any).children).not.toContain(table);
    expect((table as any).parentElement).toBe(wrap);
  });
});
