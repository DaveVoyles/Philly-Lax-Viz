/**
 * Adds a scroll-triggered reveal animation to chart containers.
 * Charts start invisible and animate in when scrolled into view.
 *
 * Usage: call observeChartReveal(el) on any chart container element
 * BEFORE the chart is rendered into it.
 */

const observed = new WeakSet<Element>();

const observer =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add('chart-revealed');
              observer?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.15 },
      );

/**
 * Mark a chart container for reveal animation.
 * The container starts with opacity 0 and scale 0.96,
 * then transitions to full visibility when scrolled into view.
 */
export function observeChartReveal(el: HTMLElement): void {
  if (observed.has(el)) return;
  observed.add(el);
  el.classList.add('chart-reveal');

  queueMicrotask(() => {
    if (!el.isConnected || observer === null) {
      el.classList.add('chart-revealed');
      return;
    }
    observer.observe(el);
  });
}
