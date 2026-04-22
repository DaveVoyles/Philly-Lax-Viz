// Tiny shared formatters for views.

export function formatRecord(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

export function formatDate(iso: string): string {
  // iso = YYYY-MM-DD; render as M/D/YYYY without TZ shifts.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

export function gameResult(myScore: number, oppScore: number): 'W' | 'L' | 'T' {
  if (myScore > oppScore) return 'W';
  if (myScore < oppScore) return 'L';
  return 'T';
}
