-- 002_ingest_post_log.sql
-- Per-post ingest tracking for idempotency. The pre-existing `ingest_log` table
-- in 001_init.sql holds *run-level* aggregates (one row per `pnpm ingest`);
-- this new `ingest_post_log` holds *per-post* status keyed on
-- (post_id, parser_version) so re-runs at the same parser version skip cleanly
-- and bumping PARSER_VERSION re-processes everything.

CREATE TABLE IF NOT EXISTS ingest_post_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id         TEXT    NOT NULL,
    parser_version  TEXT    NOT NULL,
    category        TEXT    NOT NULL,            -- scoreboard | hs-summaries | rankings | skipped
    status          TEXT    NOT NULL,            -- ok | error | skipped
    error_message   TEXT,
    games_added     INTEGER NOT NULL DEFAULT 0,
    rows_added      INTEGER NOT NULL DEFAULT 0,  -- player_stats / rankings rows
    anomalies_added INTEGER NOT NULL DEFAULT 0,
    processed_at    TEXT    NOT NULL,
    UNIQUE (post_id, parser_version)
);

CREATE INDEX IF NOT EXISTS idx_ingest_post_log_post_id ON ingest_post_log(post_id);
CREATE INDEX IF NOT EXISTS idx_ingest_post_log_status  ON ingest_post_log(status);
