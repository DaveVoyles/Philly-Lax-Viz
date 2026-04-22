// postImages.ts -- Wave 17 Lane 2 (Han). Extract featured / inline images
// from cached PhillyLacrosse post HTML.
//
// Strategy (first hit wins):
//   1. <meta property="og:image"> in <head>  (preferred -- WP "featured" image)
//   2. WP REST API featured_media URL embedded as a JSON-LD or comment hint
//   3. First non-sponsor <img> inside the post body (.entry-content)
//
// Sponsor heuristic skips obvious banner ads. We never download the image
// itself -- only the URL is stored. Idempotent: relies on the
// UNIQUE(post_slug, image_url) constraint added in migration 010.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';

const SPONSOR_NEEDLES = [
  'sponsor',
  'granite-run',
  'fusion-lacrosse',
  'fusion.jpg',
  'beyourbest',
  'byb',
  'blackbear',
  'true-final',
  'spring_26',
  'limitless',
  'truelacrosse',
  'logo.png',
  'webclip',
  'performance-academy',
];

export interface ExtractedImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
  source: 'og' | 'featured-media' | 'body-img';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&apos;/g, "'");
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}=["']([^"']+)["']`, 'i');
  const m = re.exec(tag);
  return m ? decodeEntities(m[1]!) : null;
}

function isSponsor(url: string, alt: string | null): boolean {
  const hay = `${url} ${alt ?? ''}`.toLowerCase();
  return SPONSOR_NEEDLES.some((n) => hay.includes(n));
}

/** Best-effort: extract the post body region (Genesis theme uses
 * `class="entry-content"`). Falls back to whole document. */
function extractBody(html: string): string {
  const m = /class="entry-content"[^>]*>([\s\S]*?)(?:<\/section>|<\/article>|<aside)/i.exec(html);
  return m ? m[1]! : html;
}

export function extractPostImages(html: string): ExtractedImage[] {
  const out: ExtractedImage[] = [];

  // 1. og:image
  const ogMatch = /<meta[^>]+property=["']og:image["'][^>]*>/i.exec(html);
  if (ogMatch) {
    const url = attr(ogMatch[0], 'content');
    if (url) {
      out.push({ url, altText: null, width: null, height: null, source: 'og' });
      return out;
    }
  }

  // 2. featured_media URL hint -- WP often emits a JSON blob with
  //    "featured_media_src_url":"..." in inline scripts.
  const fmMatch = /"featured_media_src_url"\s*:\s*"([^"]+)"/i.exec(html);
  if (fmMatch) {
    out.push({
      url: decodeEntities(fmMatch[1]!).replace(/\\\//g, '/'),
      altText: null,
      width: null,
      height: null,
      source: 'featured-media',
    });
    return out;
  }

  // 3. first non-sponsor <img> inside the body
  const body = extractBody(html);
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(body)) !== null) {
    const tag = m[0];
    const url = attr(tag, 'src');
    if (!url) continue;
    const alt = attr(tag, 'alt');
    if (isSponsor(url, alt)) continue;
    const wRaw = attr(tag, 'width');
    const hRaw = attr(tag, 'height');
    const w = wRaw && /^\d+$/.test(wRaw) ? Number(wRaw) : null;
    const h = hRaw && /^\d+$/.test(hRaw) ? Number(hRaw) : null;
    out.push({ url, altText: alt, width: w, height: h, source: 'body-img' });
    break;
  }

  return out;
}

interface CacheRow {
  post_id: string;
  url: string;
}

export interface ExtractRunResult {
  postsScanned: number;
  postsWithImage: number;
  imagesInserted: number;
  imagesSkippedExisting: number;
}

export function runImageExtraction(
  db: Database,
  cacheDir: string,
  opts: { limit?: number } = {},
): ExtractRunResult {
  const summary: ExtractRunResult = {
    postsScanned: 0,
    postsWithImage: 0,
    imagesInserted: 0,
    imagesSkippedExisting: 0,
  };

  const rows = db
    .prepare('SELECT post_id, url FROM raw_cache_meta ORDER BY fetched_at ASC')
    .all() as CacheRow[];

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO post_images (post_slug, image_url, alt_text, width, height)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (const row of rows) {
    if (opts.limit !== undefined && summary.postsScanned >= opts.limit) break;
    summary.postsScanned++;

    const filePath = path.join(cacheDir, `${row.post_id}.html`);
    if (!fs.existsSync(filePath)) continue;

    let html: string;
    try {
      html = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const imgs = extractPostImages(html);
    if (imgs.length === 0) continue;
    summary.postsWithImage++;

    for (const img of imgs) {
      const r = insertStmt.run(row.post_id, img.url, img.altText, img.width, img.height);
      if (r.changes > 0) summary.imagesInserted++;
      else summary.imagesSkippedExisting++;
    }
  }

  return summary;
}
