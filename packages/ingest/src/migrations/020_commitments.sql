CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  college TEXT NOT NULL,
  division TEXT,
  commit_date TEXT,
  status TEXT NOT NULL DEFAULT 'verbal' CHECK(status IN ('verbal','committed','signed','decommitted')),
  source TEXT DEFAULT 'admin' CHECK(source IN ('player','coach','admin')),
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_commitments_player ON commitments(player_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);
