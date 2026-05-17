-- 015_dedup_candidates.sql - fuzzy player dedup candidate pairs for admin review.
-- Status lifecycle: pending -> approved/rejected/skipped.
-- player_a_id < player_b_id prevents duplicate (A,B)+(B,A) pairs.
CREATE TABLE IF NOT EXISTS dedup_candidates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  player_a_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  similarity     REAL    NOT NULL,
  algo           TEXT    NOT NULL DEFAULT 'levenshtein',
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','approved','rejected','skipped')),
  reviewer_notes TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_at    TEXT,
  UNIQUE(player_a_id, player_b_id),
  CHECK(player_a_id < player_b_id)
);
CREATE INDEX IF NOT EXISTS idx_dedup_candidates_status ON dedup_candidates(status);
CREATE INDEX IF NOT EXISTS idx_dedup_candidates_player_a ON dedup_candidates(player_a_id);
CREATE INDEX IF NOT EXISTS idx_dedup_candidates_player_b ON dedup_candidates(player_b_id);
