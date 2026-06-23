# Database Schema Quick Reference

> **Token cost:** ~900 tokens  
> **When to load:** Need DB structure, table schemas, relationships  
> **See also:** [architecture-full.md](../architecture-full.md) for detailed schema with indexes

---

## Quick Facts

- **DB file:** `data/lacrosse.db` (SQLite)
- **Current version:** `user_version = 23`
- **Test DB:** `data/lacrosse.test.db` (vitest only, never touch live DB)
- **Migrations:** `packages/ingest/src/migrations/NNN_*.sql` (applied by `user_version` pragma)

---

## Migration History

| # | File | What it adds |
|---|------|--------------|
| 001 | `init.sql` | Core tables: teams, games, game_periods, players, player_stats, rankings, ingest_anomalies, raw_cache_meta |
| 002 | `ingest_post_log.sql` | ingest_post_log |
| 003 | `piaa_official_teams.sql` | piaa_official_teams |
| 004 | `team_logos.sql` | teams.logo_url, teams.maxpreps_slug |
| 005 | `community_corrections.sql` | community_corrections (submitter, entity, field, old/new, status) |
| 005 | `player_aliases.sql` | player_aliases |
| 006 | `seasons.sql` | seasons |
| 007-011 | `commits.sql` → `drop_commits.sql` | (deprecated) |
| 008 | `schedule.sql` | schedule |
| 009 | `team_branding.sql` | team_branding |
| 010 | `post_images.sql` | post_images |
| 012 | `laxnumbers_provenance.sql` | LaxNumbers game provenance tracking |
| 013 | `score_sources.sql` | Score source authority tracking |
| 014 | `team_alias_notes.sql` | team_aliases.notes column |
| 015 | `dedup_candidates.sql` | dedup_candidates |
| 016 | `player_jersey_number.sql` | players.jersey_number |
| 017 | `manual_uploads.sql` | manual_uploads audit log for coach spreadsheets |
| 018 | `stat_source_tracking.sql` | player_stats.upload_id provenance |
| 019 | `hudl_teams.sql` | hudl_teams managed scraper targets |
| 020 | `commitments.sql` | commitments (player college commits) |
| 021 | `upload_audit_trail.sql` | manual_uploads.preview_plan_json + revert_snapshot_json |
| 022 | `laxnumbers_game_id.sql` | games.laxnumbers_game_id column + index |
| 023 | `laxnumbers_ratings.sql` | laxnumbers_ratings + teams.laxnumbers_team_id |

---

## Core Tables (agents use most)

### `teams`
Primary team entity.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| name | TEXT NOT NULL | Display name (e.g., "Harriton") |
| slug | TEXT UNIQUE | URL-safe identifier |
| logo_url | TEXT | **Bare filename** (e.g., `harriton.gif`); server prefixes `/logos/` |
| maxpreps_slug | TEXT | MaxPreps team identifier |
| laxnumbers_team_id | TEXT | LaxNumbers team ID for ratings |

**Important:** `logo_url` stores ONLY the filename. The server adds `/logos/` prefix when emitting to clients.

### `games`
Per-game records.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| date | TEXT NOT NULL | ISO date (YYYY-MM-DD) |
| home_team_id | INTEGER | FK → teams.id |
| away_team_id | INTEGER | FK → teams.id |
| home_score | INTEGER | Final score |
| away_score | INTEGER | Final score |
| source | TEXT | 'phillylacrosse', 'piaa', 'manual', etc. |
| laxnumbers_game_id | TEXT | LaxNumbers game ID for stats matching |

### `players`
Player roster.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| name | TEXT NOT NULL | Full name |
| team_id | INTEGER | FK → teams.id |
| jersey_number | TEXT | Jersey (may be empty or non-numeric) |

### `player_stats`
Per-game player stats.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| player_id | INTEGER | FK → players.id |
| game_id | INTEGER | FK → games.id |
| goals | INTEGER | |
| assists | INTEGER | |
| ground_balls | INTEGER | |
| caused_turnovers | INTEGER | |
| saves | INTEGER | Goalie stat |
| fo_won | INTEGER | Faceoffs won |
| fo_taken | INTEGER | Faceoffs taken |
| source | TEXT | 'phillylacrosse', 'laxnumbers', 'hudl', 'manual' |
| upload_id | INTEGER | FK → manual_uploads.id (if from coach upload) |

### `game_periods`
Quarter-by-quarter scores.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| game_id | INTEGER | FK → games.id |
| period_number | INTEGER | 1-4 for regulation, 5+ for OT |
| home_score | INTEGER | Home score in this period |
| away_score | INTEGER | Away score in this period |

---

## Alias & Deduplication Tables

### `team_aliases`
Alternate team names for matching during ingest.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| alias | TEXT NOT NULL | Alternate name (e.g., "Harriton HS") |
| team_id | INTEGER | FK → teams.id |
| source | TEXT | 'manual', 'anomaly', 'laxnumbers', etc. |
| confidence | REAL | 0.0-1.0 match confidence |
| notes | TEXT | Why this alias exists |

### `player_aliases`
Alternate player names (e.g., nicknames, typos).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| alias | TEXT NOT NULL | Alternate name |
| player_id | INTEGER | FK → players.id |
| source | TEXT | 'manual', 'dedup', etc. |
| confidence | REAL | 0.0-1.0 match confidence |

### `dedup_candidates`
Potential duplicate entities flagged for review.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| entity_type | TEXT | 'team' or 'player' |
| entity_id_1 | INTEGER | First candidate ID |
| entity_id_2 | INTEGER | Second candidate ID |
| similarity_score | REAL | 0.0-1.0 similarity |
| status | TEXT | 'pending', 'merged', 'dismissed' |

---

## Correction & Upload Tables

### `community_corrections`
User-submitted corrections from web UI.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| submitter_name | TEXT | User-provided name |
| submitter_email | TEXT | User-provided email |
| entity_type | TEXT | 'player_stat', 'game', 'player' |
| entity_id | INTEGER | ID of corrected entity |
| field_name | TEXT | Field being corrected |
| old_value | TEXT | Current value |
| new_value | TEXT | Proposed value |
| status | TEXT | 'pending', 'approved', 'rejected', 'outlier' |
| submitted_at | TEXT | ISO timestamp |

**Status values:**
- `pending` — awaiting auto-approval
- `approved` — applied to DB
- `rejected` — manually rejected
- `outlier` — outside bounds, requires human review

**Nightly process:** `applyCorrections.ts` auto-approves non-outliers.

### `manual_uploads`
Audit log for coach spreadsheet imports.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| submitter | TEXT | Coach name/email |
| team_id | INTEGER | FK → teams.id |
| file_hash | TEXT | SHA256 of uploaded file |
| row_count | INTEGER | Number of rows processed |
| status | TEXT | 'pending', 'applied', 'reverted' |
| applied_at | TEXT | ISO timestamp |
| reverted_at | TEXT | ISO timestamp (if reverted) |
| preview_plan_json | TEXT | JSON snapshot of changes |
| revert_snapshot_json | TEXT | JSON backup for rollback |

---

## External Data Tables

### `rankings`
PIAA District 1 official rankings.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| team_id | INTEGER | FK → teams.id |
| rank | INTEGER | District 1 rank |
| record | TEXT | W-L record |
| points | REAL | Power points |
| scraped_at | TEXT | ISO timestamp |

### `piaa_official_teams`
PIAA-registered team names (canonical source).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| name | TEXT NOT NULL | Official PIAA name |
| district | INTEGER | District number (usually 1) |

### `commitments`
Player college commitments.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| player_id | INTEGER | FK → players.id |
| college | TEXT | College name |
| division | TEXT | 'D1', 'D2', 'D3', 'NAIA', 'JUCO' |
| commit_date | TEXT | ISO date (YYYY-MM-DD) |
| status | TEXT | 'committed', 'signed', 'decommitted' |
| source | TEXT | 'manual', 'scraped', 'verified' |
| verified | INTEGER | 1 = verified by coach, 0 = unverified |

### `laxnumbers_ratings`
LaxNumbers team power ratings.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| team_id | INTEGER | FK → teams.id |
| laxnumbers_team_id | TEXT | LaxNumbers team identifier |
| view_id | TEXT | LaxNumbers view identifier |
| year | INTEGER | Season year |
| ranking | INTEGER | National/regional rank |
| rating | REAL | Power rating |
| agd | REAL | Average goal differential |
| sched | REAL | Strength of schedule |
| wins | INTEGER | |
| losses | INTEGER | |
| ties | INTEGER | |
| gf | INTEGER | Goals for |
| ga | INTEGER | Goals against |

### `hudl_teams`
Managed Hudl scraper targets.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| team_id | INTEGER | FK → teams.id |
| hudl_team_url | TEXT | Hudl team page URL |
| hudl_team_name | TEXT | Name from Hudl |
| status | TEXT | 'active', 'paused', 'error' |
| last_synced | TEXT | ISO timestamp |
| last_error | TEXT | Error message (if status='error') |

---

## Ingest Metadata Tables

### `raw_cache_meta`
RSS post cache metadata.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| category | TEXT | 'scoreboard', 'hs-summaries', etc. |
| post_id | TEXT UNIQUE | RSS item GUID |
| title | TEXT | Post title |
| cached_at | TEXT | ISO timestamp |

### `ingest_post_log`
Per-post ingest status tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| post_id | TEXT | RSS item GUID |
| category | TEXT | 'scoreboard', 'hs-summaries', etc. |
| status | TEXT | 'success', 'partial', 'failed' |
| processed_at | TEXT | ISO timestamp |

### `ingest_anomalies`
Unresolved ingest rows (parse failures).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| source | TEXT | 'phillylacrosse', 'laxnumbers', etc. |
| raw_line | TEXT | Raw text that failed to parse |
| reason | TEXT | Why it failed |
| logged_at | TEXT | ISO timestamp |

---

## Branding & Metadata Tables

### `team_branding`
Team colors, captain info, etc.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| team_id | INTEGER | FK → teams.id |
| primary_color | TEXT | Hex color code |
| secondary_color | TEXT | Hex color code |
| captain_name | TEXT | Team captain (if known) |

### `post_images`
Images extracted from recap posts.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| game_id | INTEGER | FK → games.id |
| image_url | TEXT | Full URL to image |
| alt_text | TEXT | Alt text (if available) |

### `schedule`
Future scheduled games (not yet played).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| date | TEXT | ISO date |
| home_team_id | INTEGER | FK → teams.id |
| away_team_id | INTEGER | FK → teams.id |
| location | TEXT | Venue |
| time | TEXT | Game time |

### `seasons`
Season metadata (start/end dates, label).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | Auto-increment |
| year | INTEGER | Season year |
| start_date | TEXT | ISO date |
| end_date | TEXT | ISO date |
| label | TEXT | Human-readable (e.g., "2026 Spring") |

---

## Key Relationships

```
teams
  ├─> games (home_team_id, away_team_id)
  ├─> players (team_id)
  ├─> rankings (team_id)
  ├─> team_aliases (team_id)
  ├─> manual_uploads (team_id)
  ├─> hudl_teams (team_id)
  └─> laxnumbers_ratings (team_id)

players
  ├─> player_stats (player_id)
  ├─> player_aliases (player_id)
  └─> commitments (player_id)

games
  ├─> game_periods (game_id)
  ├─> player_stats (game_id)
  └─> post_images (game_id)

manual_uploads
  └─> player_stats (upload_id)
```

---

## Important Conventions

1. **Logo URLs:** `teams.logo_url` stores ONLY the bare filename (e.g., `harriton.gif`). The server prefixes `/logos/` when emitting to clients.
2. **Backups:** Before destructive scripts, run `cp data/lacrosse.db data/lacrosse.db.bak-<context>`.
3. **Read-only queries:** When another agent is mid-wave, use `sqlite3 data/lacrosse.db ".mode column" "SELECT ..."` for read-only checks. Don't open writably.
4. **After local mutations:** Run `pnpm db:upload` to sync to Azure File Share. The live site reads from Azure, not local.

---

## Common Queries

```sql
-- Check DB version
PRAGMA user_version;  -- should be 23

-- List all teams
SELECT id, name, slug, logo_url FROM teams ORDER BY name;

-- Get player stats for a game
SELECT p.name, ps.goals, ps.assists, ps.ground_balls, ps.saves
FROM player_stats ps
JOIN players p ON ps.player_id = p.id
WHERE ps.game_id = ?;

-- Find games by team
SELECT g.id, g.date, g.home_score, g.away_score,
  t_home.name AS home_team, t_away.name AS away_team
FROM games g
JOIN teams t_home ON g.home_team_id = t_home.id
JOIN teams t_away ON g.away_team_id = t_away.id
WHERE g.home_team_id = ? OR g.away_team_id = ?
ORDER BY g.date DESC;

-- Pending corrections
SELECT * FROM community_corrections WHERE status = 'pending';

-- Recent uploads
SELECT * FROM manual_uploads ORDER BY applied_at DESC LIMIT 10;
```

---

**For full schema with indexes and constraints, see:** [architecture-full.md](../architecture-full.md)
