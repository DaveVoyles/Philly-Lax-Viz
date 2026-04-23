// Wave H6 Lane 2 (Yoda) — small statistics helpers used to flag per-game
// rows that look implausibly far from the player's own season distribution.
// Replaces a hardcoded `goals > 12` heuristic with a 3σ check.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

// Sample standard deviation (n-1 denominator). Returns 0 for n<2 so callers
// don't need to special-case empty/singleton series.
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) {
    const d = x - m;
    sq += d * d;
  }
  return Math.sqrt(sq / (xs.length - 1));
}

// True when `x` is anomalously high vs the rest of `all`. The `floor`
// guards against tiny-stdev false positives (e.g. a player with mostly 0s
// where stdev is small enough that 1 goal would otherwise trip the check).
// Skips evaluation when the sample is too small to be meaningful (<3).
export function isOutlier(
  x: number,
  all: number[],
  k: number = 3,
  floor: number = 8,
): boolean {
  if (all.length < 3) return false;
  const threshold = Math.max(mean(all) + k * stdev(all), floor);
  return x > threshold;
}
