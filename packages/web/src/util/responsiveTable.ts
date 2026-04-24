// Wave H8 Lane 2 (Yoda) — wrap a `<table>` in a horizontally-scrollable
// container so it stays usable on narrow viewports without forcing the
// whole page layout to overflow. The companion CSS lives in
// `styles.css` under the `.table-scroll` rule.

export function wrapResponsive(table: HTMLTableElement): HTMLDivElement {
  const existing = table.parentElement;
  if (existing && existing.classList.contains('table-scroll')) {
    return existing as HTMLDivElement;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';

  if (existing) {
    existing.insertBefore(wrapper, table);
  }
  wrapper.appendChild(table);
  return wrapper;
}
