export interface CounterOptions {
  /** Final value to count up to */
  value: number;
  /** Duration in ms (default 1200) */
  duration?: number;
  /** Format function (default: Math.round + toString) */
  format?: (n: number) => string;
  /** Optional prefix text (e.g. "Saves: ") */
  prefix?: string;
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
  el.textContent = `${prefix}${format(0)}`;

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

      // Update text
      el.textContent = `${prefix}${format(currentValue)}`;

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        // Animation complete - set exact final value
        el.textContent = `${prefix}${format(finalValue)}`;
        animationFrameId = null;
      }
    };

    animationFrameId = requestAnimationFrame(animate);
  };

  return { el, start };
}
