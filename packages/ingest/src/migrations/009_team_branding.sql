-- 009_team_branding.sql -- Wave 16 Lane 3 (R2). Visual identity for teams.
-- Renumbered from 008 (collision with 008_schedule.sql) during Wave 16 synthesis.
--
-- Adds primary/secondary brand colors and a short nickname so the web client
-- can render real school colors instead of falling back to a hash-derived
-- hue in the WebGL constellation, dashboard chips, and leaderboard rows.
--
-- Why no logo_url here:
--   migration 004 already added teams.logo_url + teams.maxpreps_slug for the
--   MaxPreps-sourced badge on disk (stored as a bare filename, served at
--   /logos/<file>). Re-adding that column would conflict; the requested
--   logo_url field from the W16 lane brief is intentionally omitted because
--   the existing logo_url column already covers it. Brand colors below are
--   the new addition.
--
-- Columns:
--   primary_color    TEXT  -- 7-char hex including the leading '#', e.g. '#003B6F'.
--                            NULL for un-curated teams (web falls back to
--                            deterministic name-hash hue).
--   secondary_color  TEXT  -- second brand color, same format. Optional.
--   nickname         TEXT  -- short mascot/nickname e.g. 'Hawks', 'Aces'.
--                            Display-only; not used for matching/joins.

ALTER TABLE teams ADD COLUMN primary_color TEXT;
ALTER TABLE teams ADD COLUMN secondary_color TEXT;
ALTER TABLE teams ADD COLUMN nickname TEXT;
