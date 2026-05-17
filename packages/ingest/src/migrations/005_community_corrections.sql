PRAGMA user_version = 5;

CREATE TABLE IF NOT EXISTS community_corrections (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    submitter_first  TEXT NOT NULL,
    submitter_last   TEXT NOT NULL,
    submitter_email  TEXT NOT NULL,
    entity_type      TEXT NOT NULL CHECK(entity_type IN ('player_stat','game','player')),
    entity_id        INTEGER NOT NULL,
    field_name       TEXT NOT NULL,
    old_value        TEXT,
    new_value        TEXT NOT NULL,
    note             TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','approved','rejected','outlier')),
    submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at      TEXT,
    reviewer_notes   TEXT,
    ip_hash          TEXT
);
