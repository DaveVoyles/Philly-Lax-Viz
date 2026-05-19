import { ApiError } from '../../api.js';

export function errorBlock(err: unknown, hint?: string): HTMLElement {
  const wrap = document.createElement('div');
  const msg = err instanceof ApiError ? `${err.message} (${err.url})` : String(err);
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = msg;
  wrap.appendChild(p);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'muted';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}
