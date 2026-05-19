CREATE TABLE IF NOT EXISTS hudl_teams (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  hudl_team_url TEXT NOT NULL,
  hudl_team_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','error')),
  last_synced TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hudl_teams_team_id ON hudl_teams(team_id);
