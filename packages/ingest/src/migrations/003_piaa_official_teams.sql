-- 003_piaa_official_teams.sql
-- Snapshot of the PIAA District 1 official rankings page (boys lacrosse).
-- One row per (classification, team). Refreshed by `scripts/syncPiaa.ts`.

CREATE TABLE IF NOT EXISTS piaa_official_teams (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name_official   TEXT    NOT NULL,
    name_normalized TEXT    NOT NULL,
    classification  TEXT    NOT NULL,
    seed            INTEGER,
    wins            INTEGER NOT NULL,
    losses          INTEGER NOT NULL,
    ties            INTEGER NOT NULL,
    total_points    REAL    NOT NULL,
    ranking         REAL    NOT NULL,
    fetched_at      TEXT    NOT NULL,
    UNIQUE(classification, name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_piaa_name_normalized ON piaa_official_teams(name_normalized);
