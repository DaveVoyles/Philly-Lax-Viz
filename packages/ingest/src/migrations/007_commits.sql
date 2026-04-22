-- 007_commits.sql — Wave 15 Lane 3 (Han 🧑‍🚀🍔). College commits.
--
-- Tracks high-school player commitments to college lacrosse programs, parsed
-- out of phillylacrosse.com posts (currently only the /category/recruiting/
-- archive carries commit-shaped posts; a dedicated /tag/commits/ does not
-- exist as of W15). Cross-references existing `players` and `teams` rows so
-- the commit can light up the player detail page and a per-college roll-up.
--
-- Notes:
--   * source_post_id is TEXT (post slug) to match `games.source_post_id` and
--     `rankings.source_post_id` — there is no `rss_posts` table in this DB
--     (the cache uses `raw_cache_meta` keyed on the same TEXT post slug).
--   * UNIQUE(player_name_raw, college) enforces idempotency for re-ingest.
--   * player_id / high_school_team_id are nullable: when the player or HS
--     can't be resolved we still keep the row + raw fields so the UI can
--     surface "unmatched" commits and a future backfill can fix them.

CREATE TABLE IF NOT EXISTS commits (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id            INTEGER REFERENCES players(id) ON DELETE SET NULL,
    player_name_raw      TEXT    NOT NULL,
    high_school_team_id  INTEGER REFERENCES teams(id),
    college              TEXT    NOT NULL,
    division             TEXT,           -- D1 | D2 | D3 | NAIA | JUCO | NULL
    announced_date       TEXT,           -- ISO YYYY-MM-DD if parseable
    source_post_id       TEXT,           -- post slug (matches raw_cache_meta.post_id)
    source_url           TEXT,
    created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_name_raw, college)
);

CREATE INDEX IF NOT EXISTS idx_commits_college ON commits(college);
CREATE INDEX IF NOT EXISTS idx_commits_player  ON commits(player_id);
CREATE INDEX IF NOT EXISTS idx_commits_hs_team ON commits(high_school_team_id);
CREATE INDEX IF NOT EXISTS idx_commits_announced ON commits(announced_date);
