-- 004_team_logos.sql — Wave 3 Lane 1
-- Add columns for cached team logos sourced from MaxPreps schools page
-- (https://www.maxpreps.com/pa/lacrosse/schools/). Logo binaries live on
-- disk under data/logos/<team_slug>.gif; logo_url stores the public path
-- (relative to the server static mount). maxpreps_slug is the stable
-- MaxPreps URL segment, kept for future re-sync / cross-referencing.

ALTER TABLE teams ADD COLUMN logo_url TEXT;
ALTER TABLE teams ADD COLUMN maxpreps_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_teams_maxpreps_slug ON teams(maxpreps_slug);
