-- Migration 025: Fix hudl_teams.team_id column type from TEXT to INTEGER
-- to match teams.id (INTEGER PRIMARY KEY). SQLite requires table recreation
-- since ALTER COLUMN is not supported.

PRAGMA foreign_keys = OFF;

CREATE TABLE hudl_teams_new (
  id TEXT PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  hudl_team_url TEXT NOT NULL,
  hudl_team_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','error')),
  last_synced TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO hudl_teams_new
  SELECT id, CAST(team_id AS INTEGER), hudl_team_url, hudl_team_name,
         status, last_synced, last_error, created_at
  FROM hudl_teams;

DROP TABLE hudl_teams;
ALTER TABLE hudl_teams_new RENAME TO hudl_teams;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hudl_teams_team_id ON hudl_teams(team_id);

PRAGMA foreign_keys = ON;
