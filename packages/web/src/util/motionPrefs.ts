/** Returns true if animations should run (no reduced-motion preference, no saveData). */
export function shouldAnimate(): boolean {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  const saveData = conn?.saveData ?? false;

  return !prefersReducedMotion && !saveData;
}

/** Returns true if the device is likely low-powered (mobile + saveData or small viewport). */
export function isLowPowerDevice(): boolean {
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  const saveData = conn?.saveData ?? false;
  const isSmallViewport = window.innerWidth < 768;

  return saveData || isSmallViewport;
}

/** Returns true if WebGL/Pixi.js canvases should be mounted (not mobile <768px, not saveData, not reduced-motion). */
export function shouldMountWebGL(): boolean {
  return shouldAnimate() && !isLowPowerDevice();
}
