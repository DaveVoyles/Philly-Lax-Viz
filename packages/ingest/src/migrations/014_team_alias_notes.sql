-- 014_team_alias_notes.sql — RFC 01 (anomaly-driven alias auto-seeder).
--
-- Adds two audit columns to team_aliases so anomaly-mined entries carry
-- enough context to be retired without forensics:
--
--   created_at  ISO8601 timestamp of when the alias was inserted. Defaults
--               to CURRENT_TIMESTAMP so existing rows backfill cleanly and
--               new rows record themselves with no caller change.
--   notes       Free-form provenance string. The anomaly-mined seeder
--               populates this with `occurrences=N; sample="<raw>"; ...`
--               so a future false-positive can be diagnosed in one query.
--
-- Both columns are NULL-able with safe defaults; no existing query needs
-- to change. Manual seeding paths leave `notes` NULL.
--
-- schema_version: 14 (advanced via PRAGMA user_version by runMigrations).

ALTER TABLE team_aliases ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE team_aliases ADD COLUMN notes TEXT;
