CREATE TABLE IF NOT EXISTS manual_uploads (
  id TEXT PRIMARY KEY,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  file_hash TEXT NOT NULL,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','reverted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at TEXT,
  reverted_at TEXT
);
