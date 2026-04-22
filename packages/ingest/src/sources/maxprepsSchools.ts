// MaxPreps PA lacrosse schools index parser.
//
// Source: https://www.maxpreps.com/pa/lacrosse/schools/  (server-rendered HTML).
//
// Each school is rendered as:
//   <a title="Abington" href="/pa/abington/abington-galloping-ghosts/lacrosse/">
//     <div>
//       <img src="https://image.maxpreps.io/school-mascot/.../uuid.gif?...&width=64&height=64..." alt="ABINGTON" />
//       <div>
//         <div class="title">Abington</div>
//         <div class="description">Abington, PA</div>
//       </div>
//     </div>
//   </a>
//
// We extract: name (display), city, state, logoUrl, maxprepsSlug.

import * as cheerio from 'cheerio';

export interface MaxprepsSchool {
  name: string;
  city: string;
  state: string;
  logoUrl: string | null;
  /** The MaxPreps URL path segment, e.g. "abington/abington-galloping-ghosts". */
  maxprepsSlug: string;
}

export const MAXPREPS_PA_SCHOOLS_URL = 'https://www.maxpreps.com/pa/lacrosse/schools/';

// Strip width/height/auto query parameters that downsize the image. We want
// the highest-res version available, but we also keep the original URL when
// no width/height is present.
function upgradeLogoUrl(rawUrl: string): string {
  // Decode HTML entities like &amp; -> & (cheerio attr() already decodes,
  // but be defensive).
  const url = rawUrl.replace(/&amp;/g, '&');
  // Drop the &width=64&height=64 (and any auto/format) so the CDN serves the
  // original. Keep ?version= cache-buster so re-syncs see updated logos.
  return url
    .replace(/([?&])width=\d+/g, '$1')
    .replace(/([?&])height=\d+/g, '$1')
    .replace(/([?&])auto=[^&]+/g, '$1')
    .replace(/([?&])format=[^&]+/g, '$1')
    .replace(/[?&]+$/, '')
    .replace(/&&+/g, '&')
    .replace(/\?&/, '?');
}

/** Pull the slug segment out of "/pa/<city>/<school-mascot>/lacrosse/". */
export function maxprepsSlugFromHref(href: string): string {
  const m = href.match(/^\/pa\/([^/]+)\/([^/]+)\/lacrosse\/?$/);
  if (!m) return '';
  return `${m[1]}/${m[2]}`;
}

function splitCityState(text: string): { city: string; state: string } {
  // "Abington, PA" → { city: "Abington", state: "PA" }
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts.slice(0, -1).join(', '),
      state: (parts[parts.length - 1] ?? '').toUpperCase(),
    };
  }
  return { city: text.trim(), state: '' };
}

/** Parse the MaxPreps PA lacrosse schools page HTML into school rows. */
export function parseMaxprepsSchoolsHtml(html: string): MaxprepsSchool[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: MaxprepsSchool[] = [];

  $('a[href^="/pa/"]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href') ?? '';
    const slug = maxprepsSlugFromHref(href);
    if (!slug) return;
    if (seen.has(slug)) return;

    // The card contains a .title div with the display name and a .description
    // div with "City, ST".
    const titleText = a.find('.title').first().text().replace(/\s+/g, ' ').trim();
    const descText = a.find('.description').first().text().replace(/\s+/g, ' ').trim();
    const titleAttr = (a.attr('title') ?? '').replace(/\s+/g, ' ').trim();
    const name = titleText || titleAttr;
    if (!name) return;

    const img = a.find('img').first();
    const rawSrc = img.attr('src') ?? '';
    const logoUrl = rawSrc ? upgradeLogoUrl(rawSrc) : null;

    const { city, state } = splitCityState(descText);

    seen.add(slug);
    out.push({ name, city, state, logoUrl, maxprepsSlug: slug });
  });

  return out;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch + parse the MaxPreps PA lacrosse schools index. Single page — the
 * directory is not paginated as of 2026-04 (~200 schools).
 */
export async function fetchMaxprepsSchools(
  opts: { fetchFn?: FetchLike; url?: string } = {},
): Promise<MaxprepsSchool[]> {
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const url = opts.url ?? MAXPREPS_PA_SCHOOLS_URL;
  const res = await fetchFn(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`MaxPreps schools fetch failed: ${res.status}`);
  }
  const html = await res.text();
  return parseMaxprepsSchoolsHtml(html);
}
