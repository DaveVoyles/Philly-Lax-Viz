import { load } from 'cheerio';

export function normalizeUnicodeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\u00A0/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Convert an HTML fragment to an array of text lines, treating <br>, </p>,
 * </div>, <hr> and friends as line breaks. Entities are decoded by cheerio's
 * .text() implementation. Empty lines are filtered out.
 */
export function htmlToTextLines(html: string): string[] {
  const wrapped = `<div id="__pll_root">${html}</div>`;
  const $ = load(wrapped, { xml: false });
  const root = $('#__pll_root');
  // Strip non-content elements that would otherwise leak as text lines.
  root.find('script, style, noscript, template, svg, header, footer, nav, aside').remove();
  // Replace block-level / break elements with newlines so .text() preserves layout.
  root.find('br').replaceWith('\n');
  root
    .find('p, div, li, h1, h2, h3, h4, h5, h6, tr, hr, blockquote, section, article')
    .each((_, el) => {
      // Append a newline after each block element by inserting a text node.
      $(el).append('\n');
    });

  const raw = root.text();
  return raw
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(normalizeUnicodeQuotes(line)))
    .filter(line => line.length > 0);
}

/**
 * Words that mark a parenthetical as career/historical prose, NOT a per-game
 * stat group. If any of these appear, the parenthetical must be stripped even
 * if it contains digits + stat words (e.g. "(Set School record 173 Goals)" or
 * "(100 goals on his career)").
 */
const PROSE_MARKERS = [
  'career',
  'season',
  'school record',
  'state record',
  'program record',
  'all[- ]?time',
  'milestone',
  'now has',
  'now with',
  'set [a-z]+ record',
  'broke',
  'reached',
  'on (his|her|the)',
  'for (his|her|the)',
  'in (his|her|the)',
  'lifetime',
  'overall',
  'committed',
  'commit',
  'signed',
  'tied',
  'ties',
  'history',
  'leader[s]?',
  'surpass(?:es|ed)?',
  'notch(?:es|ed)?',
  'hat trick',
  'passed [A-Z]',
  '\\d+(?:st|nd|rd|th)\\s+(?:career|point|goal|save|assist|gb|ground|face)',
];
const PROSE_RE = new RegExp(`\\b(?:${PROSE_MARKERS.join('|')})\\b`, 'i');

/** Strip a single trailing parenthetical that contains no stat tokens. */
export function stripTrailingNonStatParenthetical(s: string): string {
  // Match a trailing (...) at end-of-string and decide whether to drop it.
  const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!m) return s;
  const inner = m[2] ?? '';
  // PROSE markers always win — career milestones, school records, etc.
  if (PROSE_RE.test(inner)) return (m[1] ?? '').trim();
  // If inner contains any digit immediately followed (with optional space) by a
  // stat token, keep the parenthetical — it's a stat group like "(3G, 3A)".
  if (/\d+\s*(?:g|a|gb|sv|cto|fo|goal|assist|save|ground)/i.test(inner)) return s;
  return (m[1] ?? '').trim();
}
