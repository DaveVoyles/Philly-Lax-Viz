// Wave H5 Lane 3 (Leia) — surface the player_stats.confidence column as
// visible badges on per-game/per-player rows.
//
// Buckets chosen from the actual DB distribution at write time:
//   confidence=0.9 → 5,878 rows  (the vast majority — full structured parse)
//   confidence=0.7 →   222 rows  (partial / fuzzy match)
//   confidence=0.6 →    64 rows  (weak heuristic / name-only)
// Threshold logic is forward-compatible with finer-grained values that
// future parser revisions may emit (e.g., 0.95 / 0.5).

export interface ConfidenceBadge {
  emoji: string;
  level: 'high' | 'medium' | 'low';
  title: string;
}

export function confidenceBadge(c: number | undefined | null): ConfidenceBadge | null {
  if (c === undefined || c === null || Number.isNaN(c)) return null;
  if (c >= 0.9) {
    return {
      emoji: '🟢',
      level: 'high',
      title: `High confidence (${c.toFixed(2)}) — fully structured parse`,
    };
  }
  if (c >= 0.7) {
    return {
      emoji: '🟡',
      level: 'medium',
      title: `Medium confidence (${c.toFixed(2)}) — partial / fuzzy match`,
    };
  }
  return {
    emoji: '🔴',
    level: 'low',
    title: `Low confidence (${c.toFixed(2)}) — weak heuristic, treat with caution`,
  };
}

export function renderConfidenceBadge(c: number | undefined | null): HTMLSpanElement | null {
  const badge = confidenceBadge(c);
  if (!badge) return null;
  const span = document.createElement('span');
  span.className = `confidence-badge confidence-${badge.level}`;
  span.style.cssText = 'margin-left:0.35em;font-size:0.85em;cursor:help;';
  span.title = badge.title;
  span.setAttribute('aria-label', badge.title);
  span.textContent = badge.emoji;
  return span;
}
