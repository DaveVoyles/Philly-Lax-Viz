-- 013_score_sources.sql — Wave H9 Lane 1 (Han).
-- Audit table for per-game score reconciliation. Every fetched score
-- (whether or not we apply it) is logged here so we have a reversible
-- trail when MaxPreps / PIAA / PhillyLacrosse disagree.
--
-- Companion script: src/scripts/reconcileWithSources.ts
-- Source priority (locked H9): PIAA > MaxPreps > PhillyLacrosse, but
-- PIAA exposes only season totals so MaxPreps is the operational top
-- of the stack for per-game scores.
--
-- schema_version: 13 (advanced via PRAGMA user_version by runMigrations).

CREATE TABLE IF NOT EXISTS score_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  team_side TEXT NOT NULL CHECK(team_side IN ('home','away')),
  source TEXT NOT NULL,                -- 'maxpreps' | 'piaa' | 'phillylacrosse' | 'manual'
  score INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,            -- ISO8601
  applied INTEGER NOT NULL DEFAULT 0,  -- 0 = log-only, 1 = wrote to games row
  prior_score INTEGER,                 -- snapshot of games.{home,away}_score before applied=1
  source_url TEXT,
  notes TEXT,
  FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE INDEX IF NOT EXISTS idx_score_sources_game_id ON score_sources(game_id);
CREATE INDEX IF NOT EXISTS idx_score_sources_applied ON score_sources(applied);
