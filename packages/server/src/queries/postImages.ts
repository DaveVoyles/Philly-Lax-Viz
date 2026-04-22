// postImages.ts -- Wave 17 Lane 2 (Han). Server-side queries for the
// post_images table. Pure functions, no Fastify deps.

import type { Database } from 'better-sqlite3';

export interface PostImageRow {
  post_slug: string;
  image_url: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
}

/** Look up the first (lowest-id, i.e. earliest extracted) image for one slug. */
export function getImageForSlug(db: Database, slug: string): PostImageRow | null {
  const row = db
    .prepare(
      `SELECT post_slug, image_url, alt_text, width, height
       FROM post_images
       WHERE post_slug = ?
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(slug) as PostImageRow | undefined;
  return row ?? null;
}

/** Batch lookup -- returns map of slug -> first image row. */
export function getImagesForSlugs(
  db: Database,
  slugs: string[],
): Map<string, PostImageRow> {
  const out = new Map<string, PostImageRow>();
  if (slugs.length === 0) return out;
  const placeholders = slugs.map(() => '?').join(',');
  // Pick the lowest id per post_slug -- that's the first image extracted,
  // which mirrors the og: > featured > body-img preference order.
  const rows = db
    .prepare(
      `SELECT pi.post_slug, pi.image_url, pi.alt_text, pi.width, pi.height
       FROM post_images pi
       JOIN (
         SELECT post_slug, MIN(id) AS min_id
         FROM post_images
         WHERE post_slug IN (${placeholders})
         GROUP BY post_slug
       ) m ON m.post_slug = pi.post_slug AND m.min_id = pi.id`,
    )
    .all(...slugs) as PostImageRow[];
  for (const r of rows) out.set(r.post_slug, r);
  return out;
}
