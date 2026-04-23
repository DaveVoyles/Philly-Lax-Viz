// W H4 L2 (Yoda) — header search-as-you-type box.
//
// Mounts an <input> + popover <ul> into a parent element. Debounces queries
// (200ms), navigates to /#/players/<id> or /#/teams/<id> on selection.
// Esc closes the popover, Enter selects the first result.
//
// Inline styles only — Chewy owns styles.css.

import { searchAll, type SearchHit } from '../api.js';

const DEBOUNCE_MS = 200;

export function mountSearchBox(parent: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.display = 'inline-block';
  wrap.style.marginLeft = '0.75rem';

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search players or teams...';
  input.setAttribute('aria-label', 'Search players or teams');
  input.autocomplete = 'off';
  input.style.padding = '0.35rem 0.6rem';
  input.style.fontSize = '0.9rem';
  input.style.borderRadius = '4px';
  input.style.border = '1px solid #888';
  input.style.minWidth = '220px';

  const list = document.createElement('ul');
  list.style.position = 'absolute';
  list.style.top = '100%';
  list.style.left = '0';
  list.style.right = '0';
  list.style.margin = '0.25rem 0 0 0';
  list.style.padding = '0';
  list.style.listStyle = 'none';
  list.style.background = '#fff';
  list.style.color = '#111';
  list.style.border = '1px solid #ccc';
  list.style.borderRadius = '4px';
  list.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  list.style.maxHeight = '320px';
  list.style.overflowY = 'auto';
  list.style.zIndex = '1000';
  list.style.display = 'none';
  list.setAttribute('role', 'listbox');

  wrap.appendChild(input);
  wrap.appendChild(list);
  parent.appendChild(wrap);

  let currentHits: SearchHit[] = [];
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let activeRequest = 0;

  function hide(): void {
    list.style.display = 'none';
    list.innerHTML = '';
    currentHits = [];
  }

  function navigate(hit: SearchHit): void {
    const path = hit.kind === 'player' ? `#/players/${hit.id}` : `#/teams/${hit.id}`;
    window.location.hash = path;
    input.value = '';
    hide();
    input.blur();
  }

  function render(hits: SearchHit[]): void {
    currentHits = hits;
    list.innerHTML = '';
    if (hits.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No matches';
      empty.style.padding = '0.5rem 0.75rem';
      empty.style.color = '#666';
      list.appendChild(empty);
      list.style.display = 'block';
      return;
    }
    for (const hit of hits) {
      const li = document.createElement('li');
      li.style.padding = '0.45rem 0.75rem';
      li.style.cursor = 'pointer';
      li.style.borderBottom = '1px solid #eee';
      li.setAttribute('role', 'option');
      const tag = hit.kind === 'team' ? '🏷️ Team' : '👤 Player';
      const tail = hit.kind === 'player' && hit.teamName ? ` — ${hit.teamName}` : '';
      li.textContent = `${tag}: ${hit.name}${tail}`;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        navigate(hit);
      });
      list.appendChild(li);
    }
    list.style.display = 'block';
  }

  async function runQuery(q: string): Promise<void> {
    const reqId = ++activeRequest;
    try {
      const hits = await searchAll(q);
      if (reqId !== activeRequest) return;
      render(hits);
    } catch {
      if (reqId !== activeRequest) return;
      hide();
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (debounceHandle) clearTimeout(debounceHandle);
    if (q.length < 2) {
      hide();
      return;
    }
    debounceHandle = setTimeout(() => {
      void runQuery(q);
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hide();
      input.blur();
    } else if (e.key === 'Enter') {
      if (currentHits.length > 0) {
        e.preventDefault();
        const first = currentHits[0];
        if (first) navigate(first);
      }
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target as Node)) hide();
  });
}
