/**
 * Creates a self-cleaning interval that fires a callback every `intervalMs`.
 * Returns a `stop()` function. Fires once immediately, then on each interval.
 */
export function createPoller(
  callback: () => void | Promise<void>,
  intervalMs: number,
): { stop: () => void } {
  callback();
  const id = window.setInterval(() => {
    void callback();
  }, intervalMs);
  return { stop: () => window.clearInterval(id) };
}

/** Returns true if the current date is within the active lacrosse season (Feb 1 - Jun 15). */
export function isActiveSeason(): boolean {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (month >= 2 && month <= 5) return true;
  if (month === 6 && day <= 15) return true;
  return false;
}
