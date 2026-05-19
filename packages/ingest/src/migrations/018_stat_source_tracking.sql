-- player_stats.source already exists in 001_init.sql and is used by existing
-- ingest flows (for example: summary, laxnumbers, hudl). This migration adds
-- upload-level provenance for coach spreadsheet imports.
ALTER TABLE player_stats ADD COLUMN upload_id TEXT REFERENCES manual_uploads(id);
CREATE INDEX IF NOT EXISTS idx_player_stats_upload_id ON player_stats(upload_id);
