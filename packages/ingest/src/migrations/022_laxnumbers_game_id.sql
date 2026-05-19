-- Track LaxNumbers game IDs for box-score scraping.
-- Once we discover game_id from the scoreboard API (or construct from team+date),
-- this column lets us link our games to their LaxNumbers box-score pages.
ALTER TABLE games ADD COLUMN laxnumbers_game_id TEXT;
CREATE INDEX IF NOT EXISTS idx_games_laxnumbers_game_id ON games(laxnumbers_game_id);
