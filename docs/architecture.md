# Philly Lacrosse Viz — Architecture Reference

> **Last updated:** 2026-05-16  
> **Audience:** agents and contributors joining this repo cold  
> **Purpose:** single-source-of-truth for how data flows from external sources to the deployed site

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Package Map](#2-package-map)
3. [Data Sources](#3-data-sources)
4. [Database Schema](#4-database-schema)
5. [Ingest Pipeline](#5-ingest-pipeline)
6. [Nightly CI Workflow](#6-nightly-ci-workflow)
7. [Static Export for GitHub Pages](#7-static-export-for-github-pages)
8. [Web Client & Routing](#8-web-client--routing)
9. [API Endpoint Inventory](#9-api-endpoint-inventory)
10. [Static Export Coverage Map](#10-static-export-coverage-map)
11. [Key Architectural Decisions](#11-key-architectural-decisions)
12. [Known Limitations & Tech Debt](#12-known-limitations--tech-debt)

---

## 1. System Overview

```
External Sources
  ├── phillylacrosse.com (RSS)  ← game scores + summaries
  ├── piaad1.org (HTML + CSV)  ← district rankings + schedule
  ├── maxpreps.com (HTML)       ← team logos
  └── laxnumbers.com (API)      ← PA-wide supplementary stats

       │ crawl.ts / syncPiaa.ts / syncLogos.ts
       ▼
  data/lacrosse.db (SQLite, user_version=4)

       │ ingest-nightly.yml (GitHub Actions, self-hosted runner)
       ▼
  Azure File Share  ←→  Fastify API server (Azure Container App)
                              │ /api/* endpoints
       │ pages.yml
       ▼
  exportStatic.ts  →  /data/**/*.json  →  GitHub Pages (static SPA)
```

**Two deployment targets:**

| Target | URL | Data source | Live API? |
|--------|-----|-------------|-----------|
| GitHub Pages | https://davevoyles.github.io/Philly-Lax-Viz | Pre-built static JSON | No — `staticLoader.ts` maps `/api/*` to JSON files |
| Azure Container App | (internal, not shared publicly) | Live SQLite via Fastify | Yes — full `/api/*` |

GitHub Pages is the **primary user-facing deployment**. The Azure Container App is used for DB storage (Azure File Share) and as a live API endpoint for admin/development use.

---

## 2. Package Map

| Package | Path | Role |
|---------|------|------|
| `@pll/ingest` | `packages/ingest/` | Scrapers, parsers, pipelines, migrations, CLI, one-off scripts |
| `@pll/server` | `packages/server/` | Fastify HTTP API + static logo serving + `exportStatic.ts` |
| `@pll/shared` | `packages/shared/` | Single source of truth for TypeScript types (`Team`, `Game`, `Player`, etc.) |
| `@pll/web` | `packages/web/` | Vite + D3 SPA (charts, views, router) |

---

## 3. Data Sources

### 3.1 phillylacrosse.com (RSS)

| Property | Detail |
|----------|--------|
| URL pattern | RSS feed items (HTML bodies) |
| Format | HTML embedded in RSS `<description>` |
| Categories | `scoreboard` (score lines), `hs-summaries` (full game recaps) |
| Crawl frequency | Nightly (both categories) |
| Parser files | `scoreboardPost.ts`, `summariesPost.ts`, `text.ts` |
| DB tables populated | `games`, `game_periods`, `players`, `player_stats`, `ingest_anomalies`, `raw_cache_meta`, `ingest_post_log` |

**What it provides:**
- Final scores for all games (via scoreboard posts)
- Quarter-by-quarter breakdowns (via summary posts)
- Per-player stats: goals, assists, ground balls, caused TOs, saves, faceoffs
- Post images (linked from recap pages)

**What it does NOT provide:**
- Shots, clears, turnovers, penalties, attendance
- Goalie save percentage
- Player rosters or profiles
- Games where phillylacrosse.com hasn't published a recap yet (common lag of 1–3 days)

### 3.2 piaad1.org — Rankings

| Property | Detail |
|----------|--------|
| URL | `https://www.piaad1.org/sports/spring-sports/lacrosse-b/scores-and-rankings/` |
| Format | HTML table |
| Crawl frequency | Nightly (via `syncPiaa.ts` + `crawl --category=rankings`) |
| Parser files | `piaa.ts` (source), `rankingList.ts` (parser) |
| DB tables populated | `rankings`, `piaa_official_teams` |

**What it provides:**
- Weekly official PIAA District 1 power rankings
- Win/loss/tie records per team (authoritative)

**What it does NOT provide:**
- Strength-of-schedule, streak, last-5 record
- Playoff bracket or seeding context
- Rankings from other PIAA districts

### 3.3 piaad1.org — Schedule CSV

| Property | Detail |
|----------|--------|
| URL pattern | `.../export?type=games&year=YYYY&sport=BoysLacrosse` |
| Format | CSV |
| Crawl frequency | Nightly (via `syncPiaa.ts`) |
| Parser files | `piaaSchedule.ts` (source), `scheduleCsv.ts` (parser) |
| DB tables populated | `schedule_games` |

**What it provides:**
- Authoritative full-season schedule (upcoming + completed game dates)
- Home/away raw team names
- Completion flag

**What it does NOT provide:**
- Game time or venue (columns present in DB but always null — source doesn't include them)
- Scores for completed games (use `games` table instead)

### 3.4 maxpreps.com — Team Logos

| Property | Detail |
|----------|--------|
| URL patterns | Schools index + per-team logo CDN |
| Format | HTML + image binary |
| Crawl frequency | **Manual only** — `pnpm --filter @pll/ingest sync:logos` |
| Script | `syncLogos.ts` |
| Source files | `maxprepsSchools.ts`, `logoDownload.ts` |
| DB tables populated | `teams.logo_url` (bare filename, e.g. `harriton.png`) |
| Files on disk | `data/logos/*.png` |

**Important:** `logo_url` stores the **bare filename only** (e.g., `harriton.png`). The server prefixes `/logos/` when emitting to clients. Never store full paths or URLs in this column.

**Required attribution:** The web client footer must display: *"Team logos courtesy of MaxPreps.com"*

**What MaxPreps also has (not yet used):** Team schedules, game boxscores (final score only), per-game URLs. The source files `maxprepsSchedule.ts` and `maxprepsGame.ts` exist but are not wired into any nightly pipeline step.

### 3.5 LaxNumbers.com

| Property | Detail |
|----------|--------|
| Format | Proprietary API / structured data |
| Crawl frequency | Nightly (via `--source=laxnumbers --since=yesterday --until=today --apply`) |
| DB tables populated | `games`, `player_stats` (additive/supplementary) |

**What it provides:** PA-wide supplementary stats and scores, acting as a secondary source to fill gaps when phillylacrosse.com hasn't published yet.

**Limitation:** Covers yesterday–today window only in nightly run; historical backfill requires manual invocation.

---

## 4. Database Schema

**Location:** `data/lacrosse.db`  
**Engine:** SQLite  
**Current `user_version`:** 4 (migrations 001–004 applied)  
**Test DB:** `data/lacrosse.test.db` — auto-seeded by vitest; **never touch the live DB in tests**

### Tables and approximate row counts (as of 2026-05-16)

| Table | Rows | Purpose |
|-------|------|---------|
| `teams` | 235 | All known teams (canonical records) |
| `team_aliases` | 125 | Name variants → canonical team ID |
| `players` | 2,350 | Unique player records |
| `player_aliases` | 1 | Name variants → canonical player ID |
| `games` | 815 | Completed game results |
| `game_periods` | 2,481 | Quarter-by-quarter scores |
| `player_stats` | 9,626 | Per-game per-player stat lines |
| `rankings` | 80 | Weekly PIAA power ranking snapshots |
| `piaa_official_teams` | 59 | PIAA's authoritative team list |
| `schedule_games` | 180 | Full-season schedule (from PIAA CSV) |
| `ingest_anomalies` | 906 | Parser anomalies / data quality flags |
| `ingest_post_log` | 450 | Record of every processed post |
| `ingest_log` | 24 | Run-level ingest telemetry |
| `raw_cache_meta` | 135 | Fetch cache provenance |
| `post_images` | 87 | Images extracted from recap posts |
| `score_sources` | 49 | Score reconciliation audit trail |
| `dedup_candidates` | 0 | Admin review queue for merge decisions |

### Migrations

| File | What it adds |
|------|-------------|
| `001_init.sql` | Core schema: teams, games, players, player_stats, game_periods, rankings, ingest tables |
| `002_ingest_post_log.sql` | `ingest_post_log` table |
| `003_piaa_official_teams.sql` | `piaa_official_teams` table |
| `004_team_logos.sql` | `teams.logo_url` column |

---

## 5. Ingest Pipeline

### 5.1 Crawl phase (`crawl.ts`)

Downloads raw HTML/RSS/CSV from external sources and writes to `data/raw-cache/`. Does not touch the DB.

**Valid `--category` values:**

| Category | Source | Nightly? |
|----------|--------|----------|
| `hs-summaries` | phillylacrosse.com game recap posts | ✅ Yes |
| `scoreboard` | phillylacrosse.com scoreboard posts | ✅ Yes |
| `rankings` | piaad1.org rankings page | ❌ **No** — gap (see §12) |
| `all` | All of the above | ❌ Not used directly |

### 5.2 Sync phase (scripts)

| Script | What it does | Nightly? |
|--------|-------------|----------|
| `syncPiaa.ts` | Downloads PIAA schedule CSV → `schedule_games`; also syncs rankings | ✅ Yes |
| `syncLogos.ts` | Downloads team logos from MaxPreps → `data/logos/` + `teams.logo_url` | ❌ **Manual only** |

### 5.3 Ingest phase (`ingest.ts`)

Reads from `raw-cache/`, runs parsers, writes structured data to DB.

**Valid `--category` values** (mirrors crawl):

| Category | Nightly? |
|----------|----------|
| `hs-summaries` | ✅ Yes |
| `scoreboard` | ✅ Yes |
| `rankings` | ❌ **No** |
| `all` | ❌ Not used |

### 5.4 LaxNumbers additive ingest

Runs as a separate step: `--source=laxnumbers --since=<yesterday> --until=<today> --apply`

This is additive — it supplements phillylacrosse.com data, not replaces it.

### 5.5 Arg parsing quirks (important for CI)

- `ingest.ts` uses `--db=` flag (NOT `--dbPath=`); throws "Unknown argument" on anything unrecognized
- `crawl.ts` does **not** handle the `--` separator; `ingest.ts` does
- pnpm `--filter` changes CWD to the package directory — always use **absolute paths** for `--db=`
- Set `DB_PATH` env var (absolute path) for both `crawl.ts` and `ingest.ts`

---

## 6. Nightly CI Workflow

**File:** `.github/workflows/ingest-nightly.yml`  
**Trigger:** Cron (nightly) + manual `workflow_dispatch`  
**Runner:** `[self-hosted, pll]` — Ubuntu container on Mac Mini

### Steps in order

1. Checkout repo
2. Setup pnpm + Node 20 with cache
3. Install Azure CLI (if missing)
4. `pnpm install --frozen-lockfile`
5. Azure login (service principal — `continue-on-error: true` due to expired credentials)
6. **Download `lacrosse.db` from Azure File Share** (or warn if missing)
7. Snapshot pre-ingest anomaly count from `anomalies` table
8. **Crawl `hs-summaries`** — `pnpm --filter @pll/ingest crawl --category=hs-summaries`
9. **Sync PIAA schedule** — `pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts`
10. **Ingest** — `pnpm --filter @pll/ingest ingest --db=<abs-path> --category=hs-summaries,scoreboard`
11. **LaxNumbers additive ingest** — `--source=laxnumbers --since=... --until=...`
12. Snapshot post-ingest anomaly count
13. **Upload updated `lacrosse.db` to Azure File Share**
14. Restart Azure Container App revision (conditional on Azure login success)
15. Post anomaly delta to Discord (if webhook configured)
16. Azure logout

### What triggers the Pages deploy

`pages.yml` runs via `workflow_run` (triggered when `ingest-nightly.yml` completes). It:
1. Downloads `lacrosse.db` from Azure File Share
2. Runs `exportStatic.ts` to generate all `/data/**/*.json` files
3. Builds the Vite web bundle
4. Deploys to GitHub Pages

**Raw cache persistence:** `data/raw-cache/` lives on the self-hosted runner between runs. It is NOT downloaded from Azure each night — only the DB is. This means re-running on a fresh runner would start with an empty cache and would re-crawl everything.

---

## 7. Static Export for GitHub Pages

**Script:** `packages/server/src/scripts/exportStatic.ts`  
**Default season:** `2026` (hardcoded in `DEFAULT_SEASON` constant at line 42)

### Files generated

| File path | Replaces API | Notes |
|-----------|-------------|-------|
| `health.json` | `GET /api/health` | DB row counts + ingest timestamps |
| `seasons.json` | `GET /api/seasons` | Currently hardcoded `[2026]` |
| `empty.json` | Fallback | Returns `{}` for unsupported endpoints |
| `{season}/teams.json` | `GET /api/teams` | All teams with streak data |
| `{season}/teams/{id}.json` | `GET /api/teams/:id` + topScorers + upcoming | Full team detail bundle |
| `{season}/games.json` | `GET /api/games` | All season games |
| `{season}/games/{id}.json` | `GET /api/games/:id` | Full game detail + periods + stats |
| `{season}/players/{id}.json` | `GET /api/players/:id` | Player detail + season stats |
| `{season}/rankings.json` | `GET /api/rankings` | Latest rankings week |
| `{season}/leaders/players/{metric}.json` | `GET /api/leaders/players` | Per-metric player leaderboard |
| `{season}/leaders/teams/{metric}.json` | `GET /api/leaders/teams` | Per-metric team leaderboard |
| `{season}/leaders/sparklines/{metric}.json` | `GET /api/leaders/players/sparklines` | Per-metric sparklines |
| `{season}/rivalries.json` | `GET /api/rivalries` | Rivalry graph nodes/edges |
| `{season}/constellation.json` | `GET /api/players/constellation` | Constellation dataset |
| `{season}/anomalies.json` | `GET /api/anomalies` | Data quality anomaly list |
| `{season}/anomalies-summary.json` | `GET /api/anomalies/summary` | Anomaly summary counts |
| `{season}/schedule.json` | `GET /api/schedule` | Full season schedule |
| `{season}/schedule/team/{id}.json` | `GET /api/schedule/team/:id/upcoming` | Per-team upcoming games |
| `{season}/search-index.json` | `GET /api/search` | Pre-built search index (client-filtered) |
| `public/logos/*` | (static assets) | Copied from `data/logos/` |

### How the web client switches modes

- `VITE_STATIC_MODE=true` at build time → client uses `staticLoader.ts`
- `staticLoader.ts` maps `/api/*` paths to pre-built JSON under `/data/...`
- GitHub Pages build sets `VITE_STATIC_MODE=true` and `VITE_BASE_PATH=/Philly-Lax-Viz/`

---

## 8. Web Client & Routing

**Router:** `packages/web/src/router.ts` (hash-based, `#/...`)

| Route | View | Primary data |
|-------|------|-------------|
| `#/` | Dashboard | teams, games, calendar, leaders, freshness |
| `#/teams/:id` | Team detail | team + games + record + rankings + schedule |
| `#/games/:id` | Game detail | game + periods + player stats |
| `#/game/:id` | Game scrubber | same as game detail (alternate layout) |
| `#/players/:id` | Player detail | player + season stats + per-game |
| `#/compare/players` | Compare players | multi-player detail (⚠️ no static export) |
| `#/data-quality` | Data quality | anomalies + PIAA mismatches (⚠️ partial static) |
| `#/leaders` | Leaders | player/team leaderboards + sparklines |
| `#/anomalies` | Anomalies | anomaly list |
| `#/graph` | Rivalry graph | rivalries data |
| `#/constellation` | Constellation | constellation dataset |
| `#/h2h` | Head to head | teams + players + H2H data (⚠️ H2H endpoints have no static export) |
| `#/schedule` | Schedule | full season schedule |
| `#/sources` | Sources | freshness timestamps (⚠️ no static export) |
| `#/status` | Status | freshness + anomaly summary |
| `#/admin/dedup` | Admin dedup | dedup candidates (intentionally disabled in static mode) |

---

## 9. API Endpoint Inventory

| Method | Path | Query file | Static export? |
|--------|------|-----------|----------------|
| GET | `/api/health` | `health.ts` | ✅ `health.json` |
| GET | `/api/teams` | `teams.ts` → `listTeams` | ✅ `{season}/teams.json` |
| GET | `/api/teams/:id` | `teams.ts` → game/record queries | ✅ `{season}/teams/{id}.json` |
| GET | `/api/teams/:id/topScorers` | `teams.ts` → `topScorersForTeam` | ✅ bundled into `teams/{id}.json` |
| GET | `/api/games` | `games.ts` → `listGames` | ✅ `{season}/games.json` |
| GET | `/api/games/calendar` | `games.ts` → calendar query | ✅ bundled into dashboard data |
| GET | `/api/games/:id` | `games.ts` → full game detail | ✅ `{season}/games/{id}.json` |
| GET | `/api/players` | `players.ts` → `listPlayersBySeason` | ✅ via search-index |
| GET | `/api/players/:id` | `players.ts` → `buildPlayerDetail` | ✅ `{season}/players/{id}.json` |
| GET | `/api/rankings` | `rankings.ts` | ✅ `{season}/rankings.json` |
| GET | `/api/anomalies` | `anomalies.ts` → `listAnomalies` | ✅ `{season}/anomalies.json` |
| GET | `/api/anomalies/summary` | `anomalies.ts` → `getAnomalySummary` | ✅ `{season}/anomalies-summary.json` |
| GET | `/api/leaders/players` | `leaders.ts` → `getPlayerLeaders` | ✅ `{season}/leaders/players/{metric}.json` |
| GET | `/api/leaders/teams` | `leaders.ts` → `getTeamLeaders` | ✅ `{season}/leaders/teams/{metric}.json` |
| GET | `/api/leaders/players/sparklines` | `leaderSparklines.ts` | ✅ `{season}/leaders/sparklines/{metric}.json` |
| GET | `/api/data-quality/piaa-mismatches` | `piaa.ts` | ❌ **No static export** |
| GET | `/api/rivalries` | `rivalries.ts` | ✅ `{season}/rivalries.json` |
| GET | `/api/h2h/teams` | `h2h.ts` → `getH2HTeams` | ❌ **No static export** |
| GET | `/api/h2h/players` | `h2h.ts` → `getH2HPlayers` | ❌ **No static export** |
| GET | `/api/seasons` | `seasons.ts` | ✅ `seasons.json` |
| GET | `/api/players/constellation` | `constellation.ts` | ✅ `{season}/constellation.json` |
| GET | `/api/schedule` | `schedule.ts` → `listScheduleGames` | ✅ `{season}/schedule.json` |
| GET | `/api/schedule/team/:id/upcoming` | `schedule.ts` → `listUpcomingForTeam` | ✅ `{season}/schedule/team/{id}.json` |
| GET | `/api/freshness` | `freshness.ts` | ❌ **No static export** — views degrade gracefully |
| GET | `/api/posts/images` | `postImages.ts` | ❌ **No static export** |
| GET | `/api/search` | `search.ts` | ✅ client-side filtered via `search-index.json` |
| GET | `/api/compare/players` | `comparePlayers.ts` | ❌ **No static export** |
| GET | `/api/admin/dedup-candidates` | `adminDedup.ts` | ❌ Admin only — intentionally excluded |
| PATCH | `/api/admin/dedup-candidates/:id` | `adminDedup.ts` | ❌ Admin only |
| POST | `/api/admin/dedup-candidates/:id/merge` | `adminDedup.ts` | ❌ Admin only |

---

## 10. Static Export Coverage Map

### ✅ Fully covered (GitHub Pages works)
Dashboard, Team Detail, Game Detail, Game Scrubber, Player Detail, Leaders, Anomalies, Rivalry Graph, Constellation, Schedule, Status

### ⚠️ Partially covered
| Page | What's missing |
|------|---------------|
| `#/data-quality` | PIAA mismatches endpoint has no static export; anomaly list still works |
| `#/sources` | Freshness data not statically exported; page shows degraded state |
| `#/h2h` | Team and player H2H endpoints have no static export; H2H page shows empty |

### ❌ Not covered (intentional or known gap)
| Page | Status |
|------|--------|
| `#/compare/players` | Falls back to `empty.json`; compare feature non-functional on Pages |
| `#/admin/dedup` | Admin tool — intentionally excluded from static export |

---

## 11. Key Architectural Decisions

### ADR-001: SQLite as the primary database
**Decision:** Use SQLite (via `better-sqlite3`) rather than a hosted database.  
**Why:** The entire dataset is small enough to fit in one file (<50MB), the ingest pipeline runs on a single machine (Mac Mini self-hosted runner), and SQLite requires no separate server process. The DB file is uploaded to Azure File Share and downloaded at the start of each nightly run — effectively using Azure as a persistence layer.  
**Trade-off:** Concurrent writes are not supported. The pipeline is designed to be single-writer. Read-heavy API queries are fine.

### ADR-002: GitHub Pages as primary deployment, not Azure
**Decision:** GitHub Pages is the user-facing URL; Azure Container App is internal.  
**Why:** GitHub Pages is free, requires no credential rotation, is always available, and has no cold-start latency. The Azure SWA/Container App has API routing complexity and credential maintenance overhead. For a read-heavy sports stats site, pre-built static JSON is sufficient for all user-facing views.  
**Trade-off:** Dynamic features (compare players, H2H, admin dedup, PIAA mismatches) are not available on GitHub Pages. These degrade gracefully to empty states.

### ADR-003: Static JSON export instead of API proxy at deploy time
**Decision:** `exportStatic.ts` pre-generates all JSON responses at deploy time.  
**Why:** Avoids needing a live API server for GitHub Pages. All data is deterministic at export time (it's a snapshot). Client-side filtering (search) works on pre-built indexes.  
**Trade-off:** Data is stale until the next nightly deploy. The freshness timestamp (`lastIngestAt`) is visible in the dashboard and sources page so users can see when data was last updated.

### ADR-004: Season hardcoded to 2026
**Decision:** `DEFAULT_SEASON = 2026` in `exportStatic.ts`, `seasons.ts`, and `staticLoader.ts`.  
**Why:** Multi-season support was not needed at build time. Adding it requires parameterizing all queries and the static export loop.  
**Trade-off:** At the end of the 2026 season, this value needs to be updated in at least 3 places before the 2027 season begins.

### ADR-005: PIAA schedule and phillylacrosse games are separate tables
**Decision:** `schedule_games` (from PIAA) and `games` (from phillylacrosse.com) are never merged into one table.  
**Why:** They serve different purposes. `schedule_games` is authoritative for upcoming game dates; `games` is authoritative for final scores and player stats. Merging them would lose provenance and make it harder to show "upcoming games" without hallucinating results.  
**Trade-off:** Team pages need to query both tables. The "upcoming games" section on team detail reads `schedule_games WHERE game_date >= today`.

### ADR-006: logo_url stores bare filename only
**Decision:** `teams.logo_url = 'harriton.png'` (no path prefix).  
**Why:** The server prefixes `/logos/` at API response time. This keeps the DB portable — the logos directory could move without requiring a DB migration.  
**Trade-off:** Consumers of the raw DB must know to prepend the prefix.

### ADR-007: Raw cache lives on the runner, not in Azure
**Decision:** `data/raw-cache/` is NOT uploaded to Azure File Share. It persists on the self-hosted runner between runs.  
**Why:** The raw cache can be large (many HTML files) and uploading/downloading it on every run would significantly increase pipeline time. The runner machine (Mac Mini) is stable and always available.  
**Trade-off:** If the runner is wiped or replaced, the raw cache is lost. A fresh run will re-crawl everything, which is expensive but correct.

---

## 12. Known Limitations & Tech Debt

### Pipeline gaps (not in nightly run)

| Gap | Impact | Effort to fix |
|-----|--------|--------------|
| `rankings` category not crawled/ingested nightly | Rankings only update when PIAA sync runs (which does get rankings via `syncPiaa.ts`) | Low — add `--category=rankings` to crawl step |
| `syncLogos.ts` not run nightly | Team logos go stale when new teams join or MaxPreps updates images | Low — add step; logos rarely change mid-season |
| Dedup scripts not run nightly (`dedupTeams`, `dedupPlayers`, etc.) | Duplicate team/player entries accumulate over time | Medium — needs review workflow for false positives |
| No nightly failure threshold on anomaly growth | Anomaly count can spike (parser regression) with no alert | Low — add a step that fails if delta > N |
| `piaaCheckTotals.ts`, `reconcileTeamScores.ts` not run nightly | Score reconciliation drift not detected automatically | Medium |
| `auditCrossChecks.ts` not run nightly | Cross-source data consistency not verified | Medium |

### Static export gaps

| Gap | Impact | Effort to fix |
|-----|--------|--------------|
| `/api/compare/players` has no static export | Compare Players page non-functional on GitHub Pages | Medium — requires pre-generating all player-pair combinations (combinatorially large) |
| `/api/h2h/teams` and `/api/h2h/players` have no static export | H2H page non-functional on GitHub Pages | Medium — same combinatorial challenge |
| `/api/data-quality/piaa-mismatches` has no static export | Data Quality page partially broken on GitHub Pages | Low — can export as a single JSON file |
| `/api/freshness` has no static export | Sources page shows degraded state | Low — export a `freshness.json` snapshot at deploy time |
| `/api/posts/images` has no static export | Post images may not appear on GitHub Pages | Low — bundle into game detail JSON |

### Data quality

| Issue | Detail |
|-------|--------|
| Player attribution is heuristic | `summariesPost.ts` uses `currentSubHeader`/`playerStatTeamHints` to assign stats to teams — ambiguous cases become anomalies |
| Over-cap stats are zeroed | `playerStat.ts` clamps values above caps to 0 rather than preserving and flagging |
| `schedule_games.game_time` / `location` always null | PIAA CSV doesn't include time or venue data |
| `rankingList.ts` `weekStart` not parseable | Caller must inject the week start date; if missing it's blank |
| MaxPreps game parser only gets final score | Quarter splits and stat tables not parsed from `maxprepsGame.ts` |

### Season transition

When the 2027 season begins, update:
1. `exportStatic.ts` — `DEFAULT_SEASON` constant
2. `packages/server/src/routes/seasons.ts` — hardcoded season list
3. `packages/web/src/staticLoader.ts` — default season for static path resolution
