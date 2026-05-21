-- PBLA (Philadelphia Box Lacrosse Association) scraped data tables.
-- Source: secure.sportability.com/spx/Leagues/ (Sportability platform)

CREATE TABLE IF NOT EXISTS pbla_teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id     INTEGER NOT NULL,
  name          TEXT NOT NULL,
  gp            INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  ties          INTEGER NOT NULL DEFAULT 0,
  otw           INTEGER NOT NULL DEFAULT 0,
  otl           INTEGER NOT NULL DEFAULT 0,
  pts           INTEGER NOT NULL DEFAULT 0,
  pf            INTEGER NOT NULL DEFAULT 0,
  pa            INTEGER NOT NULL DEFAULT 0,
  diff          INTEGER NOT NULL DEFAULT 0,
  streak        TEXT NOT NULL DEFAULT '',
  scraped_at    TEXT NOT NULL,
  UNIQUE(league_id, name)
);

CREATE TABLE IF NOT EXISTS pbla_players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id     INTEGER NOT NULL,
  jersey        INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  team          TEXT NOT NULL,
  gp            INTEGER NOT NULL DEFAULT 0,
  goals         INTEGER NOT NULL DEFAULT 0,
  assists       INTEGER NOT NULL DEFAULT 0,
  points        INTEGER NOT NULL DEFAULT 0,
  penalties     INTEGER NOT NULL DEFAULT 0,
  pim           INTEGER NOT NULL DEFAULT 0,
  scraped_at    TEXT NOT NULL,
  UNIQUE(league_id, name, team)
);

CREATE TABLE IF NOT EXISTS pbla_goalies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id     INTEGER NOT NULL,
  jersey        INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  team          TEXT NOT NULL,
  gp            INTEGER NOT NULL DEFAULT 0,
  min           INTEGER NOT NULL DEFAULT 0,
  ga            INTEGER NOT NULL DEFAULT 0,
  gaa           REAL NOT NULL DEFAULT 0,
  scraped_at    TEXT NOT NULL,
  UNIQUE(league_id, name, team)
);

CREATE TABLE IF NOT EXISTS pbla_games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id     INTEGER NOT NULL,
  game_num      INTEGER NOT NULL DEFAULT 0,
  date          TEXT NOT NULL DEFAULT '',
  time          TEXT NOT NULL DEFAULT '',
  home_team     TEXT NOT NULL,
  away_team     TEXT NOT NULL,
  home_score    INTEGER NOT NULL DEFAULT 0,
  away_score    INTEGER NOT NULL DEFAULT 0,
  location      TEXT NOT NULL DEFAULT '',
  is_playoff    INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  scraped_at    TEXT NOT NULL,
  UNIQUE(league_id, game_num)
);

-- Track scrape history for observability
CREATE TABLE IF NOT EXISTS pbla_scrape_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id     INTEGER NOT NULL,
  scraped_at    TEXT NOT NULL,
  teams_count   INTEGER NOT NULL DEFAULT 0,
  players_count INTEGER NOT NULL DEFAULT 0,
  goalies_count INTEGER NOT NULL DEFAULT 0,
  games_count   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'success',
  error_message TEXT
);
