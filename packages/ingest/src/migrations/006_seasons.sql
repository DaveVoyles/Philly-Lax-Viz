-- 006_seasons.sql — Wave 13 historical-backfill prep.
--
-- Adds a `season` column (integer year, e.g. 2024, 2025, 2026) to tables that
-- record season-bound data so the web UI can filter year-over-year. Existing
-- rows are backfilled to 2026 because the live DB up to this point only
-- ingested 2026/* posts (see crawler POST_HREF_RE before W13). Future ingests
-- derive `season` from the post URL via the /(20\d{2})/ path prefix.
--
-- Tables updated:
--   * games            — season of the game
--   * player_stats     — season of the underlying game (denormalized for fast filter)
--   * ingest_post_log  — season tag of the source post for per-season idempotency

ALTER TABLE games           ADD COLUMN season INTEGER NOT NULL DEFAULT 2026;
ALTER TABLE player_stats    ADD COLUMN season INTEGER NOT NULL DEFAULT 2026;
ALTER TABLE ingest_post_log ADD COLUMN season INTEGER NOT NULL DEFAULT 2026;

CREATE INDEX IF NOT EXISTS idx_games_season         ON games(season);
CREATE INDEX IF NOT EXISTS idx_player_stats_season  ON player_stats(season);
CREATE INDEX IF NOT EXISTS idx_ingest_post_log_season ON ingest_post_log(season);
