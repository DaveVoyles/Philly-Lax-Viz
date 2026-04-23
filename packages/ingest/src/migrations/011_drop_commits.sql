-- 011_drop_commits.sql — Wave 18 W1L1 (Han). Remove the College Commits feature.
-- Mirrors the schema created in 007_commits.sql.
-- Uses IF EXISTS so re-runs are safe.

DROP INDEX IF EXISTS idx_commits_announced;
DROP INDEX IF EXISTS idx_commits_hs_team;
DROP INDEX IF EXISTS idx_commits_player;
DROP INDEX IF EXISTS idx_commits_college;
DROP TABLE IF EXISTS commits;
