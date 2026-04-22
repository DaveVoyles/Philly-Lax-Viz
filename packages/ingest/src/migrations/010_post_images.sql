-- 010_post_images.sql -- Wave 17 Lane 2 (Han). Featured / inline post images.
--
-- Stores image URLs harvested out of cached PhillyLacrosse post HTML so the
-- web client can lazy-load tiny CDN-hosted thumbnails on game cards, a hero
-- shot on the game-detail page, and a player photo next to commits. We do
-- NOT host or proxy the binary content -- only the URL plus light metadata.
--
-- post_slug joins to either raw_cache_meta.post_id, games.source_post_id,
-- or commits.source_post_id (all share the same TEXT slug shape).
-- UNIQUE(post_slug, image_url) lets the extractor be re-run idempotently.

CREATE TABLE IF NOT EXISTS post_images (
  id INTEGER PRIMARY KEY,
  post_slug TEXT NOT NULL,
  image_url TEXT NOT NULL,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_slug, image_url)
);

CREATE INDEX IF NOT EXISTS idx_post_images_slug ON post_images(post_slug);
