-- 012_laxnumbers_provenance.sql — Wave 18 W2L1 (Han).
-- Adds a `source` column to `games` so we can track provenance
-- (phillylacrosse vs laxnumbers). All existing rows default to
-- 'phillylacrosse' which was the only ingest source before this wave.

ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'phillylacrosse';
CREATE INDEX IF NOT EXISTS idx_games_source ON games(source);
