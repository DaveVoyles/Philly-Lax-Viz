const STREAK_STYLE_ID = 'streak-chip-styles';

export function ensureStreakChipStyles(doc: Document = document): void {
  if (doc.getElementById(STREAK_STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STREAK_STYLE_ID;
  style.textContent = `.streak-chip { font-size: 0.7rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; display: inline-block; margin-left: 4px; }
.streak-win { background: #22c55e; color: #fff; }
.streak-loss { background: #ef4444; color: #fff; }`;
  doc.head.appendChild(style);
}

export function buildStreakChip(
  streak: number | null | undefined,
  doc: Pick<Document, 'createElement'> = document,
): HTMLSpanElement | null {
  if (typeof streak !== 'number' || Math.abs(streak) < 2) return null;

  const span = doc.createElement('span') as HTMLSpanElement;
  if (streak >= 2) {
    span.className = 'streak-chip streak-win';
    span.textContent = `W${streak}`;
    span.title = `${streak}-game win streak`;
    return span;
  }

  span.className = 'streak-chip streak-loss';
  span.textContent = `L${Math.abs(streak)}`;
  span.title = `${Math.abs(streak)}-game losing streak`;
  return span;
}
