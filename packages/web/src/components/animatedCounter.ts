export interface CounterOptions {
  /** Final value to count up to */
  value: number;
  /** Duration in ms (default 1200) */
  duration?: number;
  /** Format function (default: Math.round + toString) */
  format?: (n: number) => string;
  /** Optional prefix text (e.g. "Saves: ") */
  prefix?: string;
  /** Optional callback for mirroring counter text into non-HTML targets */
  onUpdate?: (text: string, rawValue: number) => void;
}

/**
 * Creates a <span> element that animates from 0 to `value` using requestAnimationFrame.
 * Call `start()` to begin the animation (e.g. when element enters viewport).
 */
export function createAnimatedCounter(opts: CounterOptions): { el: HTMLSpanElement; start: () => void } {
  const duration = opts.duration ?? 1200;
  const format = opts.format ?? ((n: number) => String(Math.round(n)));
  const prefix = opts.prefix ?? "";
  const finalValue = opts.value;

  const el = document.createElement("span");
  el.className = "animated-counter";

  const renderText = (value: number): void => {
    const text = `${prefix}${format(value)}`;
    el.textContent = text;
    opts.onUpdate?.(text, value);
  };

  renderText(0);

  let hasStarted = false;
  let animationFrameId: number | null = null;

  const start = () => {
    if (hasStarted) return;
    hasStarted = true;

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // easeOutQuart: 1 - (1 - t)^4
      const eased = 1 - Math.pow(1 - progress, 4);
      const currentValue = eased * finalValue;

      renderText(currentValue);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        renderText(finalValue);
        animationFrameId = null;
      }
    };

    animationFrameId = requestAnimationFrame(animate);
  };

  return { el, start };
}

/**
 * Wraps createAnimatedCounter with an IntersectionObserver that auto-starts
 * the counter when the element scrolls into view. Returns just the element.
 */
export function createAutoCounter(opts: CounterOptions): HTMLSpanElement {
  const { el, start } = createAnimatedCounter(opts);

  if (typeof IntersectionObserver === "undefined") {
    queueMicrotask(start);
    return el;
  }

  const obs = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        start();
        obs.disconnect();
      }
    },
    { threshold: 0.3 },
  );

  queueMicrotask(() => {
    if (el.isConnected) {
      obs.observe(el);
    } else {
      obs.disconnect();
      start();
    }
  });

  return el;
}
