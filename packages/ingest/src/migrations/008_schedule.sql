-- 008_schedule.sql — Wave 16 Lane 2 (Leia)
-- Upcoming/scheduled games scraped from external sources (PIAA D1 CSV
-- export, etc). Distinct from `games` (which holds played games parsed
-- from PhillyLacrosse recaps) so the two ingest pipelines stay decoupled
-- and we can show "next game" tiles even before any recap exists.

CREATE TABLE IF NOT EXISTS schedule_games (
  id INTEGER PRIMARY KEY,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_team_name_raw TEXT NOT NULL,
  away_team_name_raw TEXT NOT NULL,
  game_date TEXT NOT NULL,
  game_time TEXT,
  location TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  season INTEGER NOT NULL DEFAULT 2026,
  scraped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(home_team_id, away_team_id, game_date, source)
);

CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule_games(game_date);
CREATE INDEX IF NOT EXISTS idx_schedule_season ON schedule_games(season);
