-- LaxNumbers team ratings and team ID mapping.
-- Source: /ratings/service?y={year}&v={view_id} JSON API.
-- Views: PA East = 3454, IAC/Private = 3468.

-- Store the LaxNumbers team ID on our teams table for cross-referencing.
ALTER TABLE teams ADD COLUMN laxnumbers_team_id INTEGER;

-- Ratings table: one row per team per view per capture.
-- UNIQUE constraint allows re-running idempotently (upsert on conflict).
CREATE TABLE IF NOT EXISTS laxnumbers_ratings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id             INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    laxnumbers_team_id  INTEGER NOT NULL,
    view_id             INTEGER NOT NULL,
    year                INTEGER NOT NULL,
    ranking             INTEGER NOT NULL,
    rating              REAL    NOT NULL,
    agd                 REAL    NOT NULL,
    sched               REAL    NOT NULL,
    wins                INTEGER NOT NULL DEFAULT 0,
    losses              INTEGER NOT NULL DEFAULT 0,
    ties                INTEGER NOT NULL DEFAULT 0,
    gf                  INTEGER NOT NULL DEFAULT 0,
    ga                  INTEGER NOT NULL DEFAULT 0,
    captured_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (team_id, view_id, year)
);

CREATE INDEX IF NOT EXISTS idx_laxnumbers_ratings_year_view ON laxnumbers_ratings(year, view_id);
CREATE INDEX IF NOT EXISTS idx_laxnumbers_ratings_team ON laxnumbers_ratings(team_id);
CREATE INDEX IF NOT EXISTS idx_teams_laxnumbers_id ON teams(laxnumbers_team_id);
