-- 014_team_alias_notes.sql — RFC 01 (anomaly-driven alias auto-seeder).
--
-- Adds two audit columns to team_aliases so anomaly-mined entries carry
-- enough context to be retired without forensics:
--
--   created_at  ISO8601 timestamp of when the alias was inserted. SQLite
--               disallows non-constant defaults on ALTER TABLE ADD COLUMN
--               (no CURRENT_TIMESTAMP), so the column is plain TEXT NULL
--               and writers populate it explicitly via datetime('now').
--               Existing rows therefore carry NULL — that's fine; the
--               column exists for forward-going audit trails on mined
--               entries, not for backfilling history we never recorded.
--   notes       Free-form provenance string. The anomaly-mined seeder
--               populates this with `occurrences=N; sample="<raw>"; ...`
--               so a future false-positive can be diagnosed in one query.
--               Manual seeding paths leave `notes` NULL.
--
-- Both columns are NULL-able; no existing query needs to change.
--
-- schema_version: 14 (advanced via PRAGMA user_version by runMigrations).

ALTER TABLE team_aliases ADD COLUMN created_at TEXT;
ALTER TABLE team_aliases ADD COLUMN notes TEXT;
