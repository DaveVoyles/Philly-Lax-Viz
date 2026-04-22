-- 005_player_aliases.sql — Wave 12 Lane 3 (Yoda)
-- Audit trail for player-row merges performed by dedupPlayers.ts. Each row
-- records the dropped name → kept player_id mapping, with the source pass
-- (auto-dedup-w12, auto-dedup-normalize, auto-dedup-pattern7, manual, …)
-- and a confidence score. Used for forensic reconstruction and to skip
-- re-merging in subsequent runs.

CREATE TABLE IF NOT EXISTS player_aliases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alias       TEXT    NOT NULL,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    source      TEXT    NOT NULL,
    confidence  REAL    NOT NULL DEFAULT 1.0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(alias, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_aliases_alias ON player_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_player_aliases_player_id ON player_aliases(player_id);
