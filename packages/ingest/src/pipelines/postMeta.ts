// postMeta.ts — extract publish/post date from a WordPress post HTML so the
// pipelines have a fallback ISO date for game/ranking week_start.

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

/** Pad a 1- or 2-digit number to 2 chars. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Extract the post's publish date as ISO YYYY-MM-DD. Looks for, in order:
 *   1. <meta property="article:published_time" content="2026-04-21T...">
 *   2. <time class="entry-time">April 21, 2026</time>
 *   3. "Posted M/D/YY" inline marker
 * Returns undefined if nothing is found.
 */
export function extractPostDate(html: string): string | undefined {
  const meta = html.match(
    /<meta[^>]+property="article:published_time"[^>]+content="(\d{4}-\d{2}-\d{2})/i,
  );
  if (meta && meta[1]) return meta[1];

  const time = html.match(
    /<time[^>]*class="entry-time"[^>]*>\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*</i,
  );
  if (time) {
    const month = MONTHS[(time[1] ?? '').toLowerCase()];
    const day = Number(time[2]);
    const year = Number(time[3]);
    if (month && day && year) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const posted = html.match(/Posted\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/i);
  if (posted) {
    const month = Number(posted[1]);
    const day = Number(posted[2]);
    let year = Number(posted[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  return undefined;
}

/**
 * Parse a free-form date label (from the scoreboard parser) into ISO
 * YYYY-MM-DD using the supplied year (we don't have it in the label itself).
 *   "April 21"      → "2026-04-21"
 *   "April 21, 2026" → "2026-04-21"
 *   "Today"         → fallbackIso (post date)
 *   "Yesterday"     → fallbackIso minus 1 day
 */
export function dateLabelToIso(
  label: string,
  fallbackIso: string,
): string {
  const trimmed = (label ?? '').trim();
  if (!trimmed) return fallbackIso;

  if (/^Today\b/i.test(trimmed)) return fallbackIso;
  if (/^Yesterday\b/i.test(trimmed)) return shiftIsoDate(fallbackIso, -1);

  const m = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\.?$/);
  if (m) {
    const month = MONTHS[(m[1] ?? '').toLowerCase()];
    const day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : yearFromIso(fallbackIso);
    if (month && day && year) return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  return fallbackIso;
}

function yearFromIso(iso: string): number {
  const m = iso.match(/^(\d{4})-/);
  return m ? Number(m[1]) : new Date().getUTCFullYear();
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Snap an ISO date to the Monday of that week (week_start convention used in
 * the rankings table).
 */
export function isoToMondayOfWeek(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // getUTCDay: Sunday=0, Monday=1, ..., Saturday=6
  const dow = d.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
