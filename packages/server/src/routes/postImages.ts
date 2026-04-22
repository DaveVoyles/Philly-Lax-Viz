// postImages.ts -- Wave 17 Lane 2 (Han). Batch lookup endpoint for the web
// client to hydrate image URLs for a list of post slugs in one round trip.

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getImagesForSlugs } from '../queries/postImages.js';

interface BatchQuery {
  slugs?: string;
}

export async function postImagesRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get<{ Querystring: BatchQuery }>('/api/posts/images', async (req, reply) => {
    const raw = req.query.slugs ?? '';
    const slugs = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 500); // cap fan-out

    if (slugs.length === 0) {
      return { images: {} as Record<string, unknown> };
    }

    const map = getImagesForSlugs(db, slugs);
    const images: Record<string, {
      imageUrl: string;
      altText: string | null;
      width: number | null;
      height: number | null;
    }> = {};
    for (const [slug, row] of map) {
      images[slug] = {
        imageUrl: row.image_url,
        altText: row.alt_text,
        width: row.width,
        height: row.height,
      };
    }
    void reply;
    return { images };
  });
}
