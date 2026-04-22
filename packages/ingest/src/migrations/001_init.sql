-- 001_init.sql — Initial schema for the Philly Lacrosse ingest DB.
-- See packages/shared/src/index.ts for the TypeScript shapes that mirror these tables.
-- Column names follow plan.md "Data Model (SQLite)" exactly (snake_case).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL UNIQUE,
    slug      TEXT    NOT NULL UNIQUE,
    division  TEXT    NOT NULL DEFAULT 'high-school'
);

CREATE TABLE IF NOT EXISTS games (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT    NOT NULL,                -- ISO YYYY-MM-DD
    home_team_id    INTEGER NOT NULL REFERENCES teams(id),
    away_team_id    INTEGER NOT NULL REFERENCES teams(id),
    home_score      INTEGER NOT NULL,
    away_score      INTEGER NOT NULL,
    ot_periods      INTEGER NOT NULL DEFAULT 0,
    postponed       INTEGER NOT NULL DEFAULT 0,
    source_post_id  TEXT    NOT NULL,
    recap_url       TEXT,
    parsed_at       TEXT    NOT NULL,
    UNIQUE (date, home_team_id, away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
CREATE INDEX IF NOT EXISTS idx_games_source_post_id ON games(source_post_id);

CREATE TABLE IF NOT EXISTS game_periods (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id       INTEGER NOT NULL REFERENCES teams(id),
    period_number INTEGER NOT NULL,
    goals         INTEGER NOT NULL,
    UNIQUE (game_id, team_id, period_number)
);

CREATE INDEX IF NOT EXISTS idx_game_periods_game_id ON game_periods(game_id);

CREATE TABLE IF NOT EXISTS players (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    name_normalized  TEXT    NOT NULL,
    team_id          INTEGER NOT NULL REFERENCES teams(id),
    name_resolution  TEXT    NOT NULL DEFAULT 'full',
    UNIQUE (team_id, name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_name_normalized ON players(name_normalized);

CREATE TABLE IF NOT EXISTS player_stats (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id           INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id         INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    goals             INTEGER NOT NULL DEFAULT 0,
    assists           INTEGER NOT NULL DEFAULT 0,
    ground_balls      INTEGER NOT NULL DEFAULT 0,
    caused_turnovers  INTEGER NOT NULL DEFAULT 0,
    saves             INTEGER NOT NULL DEFAULT 0,
    fo_won            INTEGER NOT NULL DEFAULT 0,
    fo_taken          INTEGER NOT NULL DEFAULT 0,
    source            TEXT    NOT NULL DEFAULT 'summary',
    parser_version    TEXT    NOT NULL,
    confidence        REAL    NOT NULL DEFAULT 1.0,
    UNIQUE (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_stats_player_id ON player_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_game_id ON player_stats(game_id);

CREATE TABLE IF NOT EXISTS team_aliases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alias       TEXT    NOT NULL UNIQUE,
    team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    source      TEXT    NOT NULL DEFAULT 'manual',
    confidence  REAL    NOT NULL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_team_aliases_team_id ON team_aliases(team_id);

CREATE TABLE IF NOT EXISTS rankings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start      TEXT    NOT NULL,
    ranking_source  TEXT    NOT NULL,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rank            INTEGER NOT NULL,
    source_post_id  TEXT    NOT NULL,
    captured_at     TEXT    NOT NULL,
    UNIQUE (week_start, ranking_source, team_id)
);

CREATE INDEX IF NOT EXISTS idx_rankings_week_source ON rankings(week_start, ranking_source);
CREATE INDEX IF NOT EXISTS idx_rankings_team_id ON rankings(team_id);

CREATE TABLE IF NOT EXISTS ingest_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at              TEXT    NOT NULL,
    feed_items_seen     INTEGER NOT NULL DEFAULT 0,
    games_added         INTEGER NOT NULL DEFAULT 0,
    summaries_parsed    INTEGER NOT NULL DEFAULT 0,
    rankings_parsed     INTEGER NOT NULL DEFAULT 0,
    anomalies_created   INTEGER NOT NULL DEFAULT 0,
    duration_ms         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ingest_log_run_at ON ingest_log(run_at);

CREATE TABLE IF NOT EXISTS ingest_anomalies (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    source_post_id       TEXT    NOT NULL,
    source_url           TEXT    NOT NULL,
    raw_line             TEXT    NOT NULL,
    parent_game_id       INTEGER REFERENCES games(id) ON DELETE SET NULL,
    strategy_attempted   TEXT    NOT NULL,
    reason               TEXT    NOT NULL,
    created_at           TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingest_anomalies_post ON ingest_anomalies(source_post_id);
CREATE INDEX IF NOT EXISTS idx_ingest_anomalies_strategy ON ingest_anomalies(strategy_attempted);

CREATE TABLE IF NOT EXISTS raw_cache_meta (
    post_id         TEXT PRIMARY KEY,
    url             TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,
    content_sha256  TEXT NOT NULL
);
