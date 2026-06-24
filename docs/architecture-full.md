# Philly Lacrosse Viz — Architecture Reference (Full)

> ⚠️ **Token cost:** ~5,400 tokens — **Load quick-refs first unless you need deep understanding**  
> 
> **For most tasks, use these instead:**
> - [index.md](./index.md) (~600 tokens) — navigation decision tree
> - [quick-refs/commands.md](./quick-refs/commands.md) (~600 tokens) — CLI reference
> - [quick-refs/db-schema.md](./quick-refs/db-schema.md) (~900 tokens) — DB tables
> - [quick-refs/api-endpoints.md](./quick-refs/api-endpoints.md) (~750 tokens) — API inventory
> - [quick-refs/data-sources.md](./quick-refs/data-sources.md) (~600 tokens) — Source summary
> - [onboarding.md](./onboarding.md) (~1,800 tokens) — Getting started
>
> **Only load this file when:**
> - You need to understand ALL data sources and their parsers
> - You're refactoring core ingest/pipeline logic
> - You're writing an ADR for a major architectural change
> - Quick-refs don't answer your question

---

> **Last updated:** 2026-05-19  
> **Audience:** agents and contributors needing deep system understanding  
> **Purpose:** single-source-of-truth for how data flows from external sources to the deployed site

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Package Map](#2-package-map)
3. [Data Sources](#3-data-sources)
4. [Database Schema](#4-database-schema)
5. [Ingest Pipeline](#5-ingest-pipeline)
6. [Nightly CI Workflow](#6-nightly-ci-workflow)
7. [Web Client & Routing](#7-web-client--routing)
8. [Web Client & Routing](#8-web-client--routing)
9. [API Endpoint Inventory](#9-api-endpoint-inventory)
10. [Static Export Coverage Map](#10-static-export-coverage-map)
11. [Key Architectural Decisions](#11-key-architectural-decisions)
12. [Known Limitations & Tech Debt](#12-known-limitations--tech-debt)
13. [Community Corrections Operations](#13-community-corrections-operations)

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
  data/lacrosse.db (SQLite, user_version=16)

       │ ingest-nightly.yml (GitHub Actions, self-hosted runner)
       ▼
  Azure File Share  ←→  Fastify API server (Azure Container App)
                              │ /api/* endpoints
       │ deploy.yml (push to main)
       ▼
  Azure Static Web App (phillylaxstats.com)
```

**Deployment architecture:**

| Component | URL | Role |
|-----------|-----|------|
| Web + API (ACA) | https://phillylaxstats.com | Vite SPA + Fastify API in one container, min-replicas=1 |

The web client calls the API directly — there is no static JSON export layer.

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
| Crawl frequency | **Weekly** (Sunday) — `sync-logos.yml` workflow; also manual via `pnpm --filter @pll/ingest sync:logos` |
| Script | `syncLogos.ts` |
| Source files | `maxprepsSchools.ts`, `logoDownload.ts` |
| DB tables populated | `teams.logo_url` (bare filename, e.g. `harriton.gif`) |
| Files on disk | `data/logos/*.gif` |

**Important:** `logo_url` stores the **bare filename only** (e.g., `harriton.gif`). The server prefixes `/logos/` when emitting to clients. Never store full paths or URLs in this column.

**Required attribution:** The web client footer must display: *"Team logos courtesy of MaxPreps.com"*

**What MaxPreps also has (not yet used):** Team schedules, game boxscores (final score only), per-game URLs. The source files `maxprepsSchedule.ts` and `maxprepsGame.ts` exist but are not wired into any nightly pipeline step.

### 3.5 LaxNumbers.com

| Property | Detail |
|----------|--------|
| Format | Proprietary API / structured data |
| Crawl frequency | Nightly (via `--source=laxnumbers --since=yesterday --until=today --apply`) |
| DB tables populated | `games`, `player_stats` (additive/supplementary) |

**What it provides:** PA-wide supplementary stats and scores, acting as a secondary source to fill gaps when phillylacrosse.com hasn't published yet.

**Limitation:** Covers yesterday-today window only in nightly run; historical backfill requires manual invocation.

### 3.6 Hudl.com

| Property | Detail |
|----------|--------|
| Format | Authenticated HTML scraping (Playwright) |
| Crawl frequency | **Manual only** - `pnpm --filter @pll/ingest sync:hudl -- --headed` |
| Script | `syncHudl.ts` |
| DB tables populated | `players`, `player_stats` (roster + per-game stats for Harriton) |
| Authentication | Requires `HUDL_EMAIL` / `HUDL_PASSWORD` env vars |

**What it provides:** Coach-authenticated access to detailed roster and per-game stats for teams with Hudl accounts. Currently scaffolded for Harriton only.

**Limitation:** Requires first-run selector discovery in `--headed` mode. Not yet generalized for other teams.

---

## 4. Database Schema

**Location:** `data/lacrosse.db`  
**Engine:** SQLite  
**Current `user_version`:** 16 (migrations 001–016 applied)  
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
| `004_team_logos.sql` | `teams.logo_url`, `teams.maxpreps_slug` |
| `005_community_corrections.sql` | `community_corrections` table (submitter, entity, field, old/new value, status) |
| `005_player_aliases.sql` | `player_aliases` table |
| `006_seasons.sql` | `seasons` table |
| `007_commits.sql` | Commits table (later dropped in 011) |
| `008_schedule.sql` | `schedule_games` table |
| `009_team_branding.sql` | `team_branding` table |
| `010_post_images.sql` | `post_images` table |
| `011_drop_commits.sql` | Drops commits table |
| `012_laxnumbers_provenance.sql` | LaxNumbers game provenance tracking |
| `013_score_sources.sql` | Score source authority tracking |
| `014_team_alias_notes.sql` | `team_aliases.notes` column |
| `015_dedup_candidates.sql` | `dedup_candidates` table |
| `016_player_jersey_number.sql` | `players.jersey_number` column |

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
13. Seed team aliases from anomalies
14. Apply community corrections (`applyCorrections.ts`) with `continue-on-error: true`
15. **Upload updated `lacrosse.db` to Azure File Share**
16. Restart Azure Container App revision (conditional on Azure login success)
17. Post anomaly delta to Discord (if webhook configured)
18. Azure logout

**Raw cache persistence:** `data/raw-cache/` lives on the self-hosted runner between runs. It is NOT downloaded from Azure each night — only the DB is. This means re-running on a fresh runner would start with an empty cache and would re-crawl everything.

---

## 7. Web Client & Routing

**Router:** `packages/web/src/router.ts` (hash-based, `#/...`)

| Route | View | Primary data |
|-------|------|-------------|
| `#/` | Dashboard | teams, games, calendar, leaders, freshness |
| `#/teams/:id` | Team detail | team + games + record + rankings + schedule |
| `#/games/:id` | Game detail | game + periods + player stats |
| `#/game/:id` | Game scrubber | same as game detail (alternate layout) |
| `#/players/:id` | Player detail | player + season stats + per-game |
| `#/compare/players` | Compare players | multi-player detail (no static export) |
| `#/top-teams` | Top 10 teams | top 10 teams by win record |
| `#/data-quality` | Data quality | anomalies + PIAA mismatches (partial static) |
| `#/leaders` | Leaders | player/team leaderboards + sparklines |
| `#/anomalies` | Anomalies | anomaly list |
| `#/graph` | Rivalry graph | rivalries data |
| `#/constellation` | Constellation | constellation dataset |
| `#/h2h` | Head to head | teams + players + H2H data |
| `#/schedule` | Schedule | full season schedule |
| `#/commitments` | Commitments | college commitments + self-service form |
| `#/sources` | Sources | freshness timestamps |
| `#/status` | Status | freshness + anomaly summary |
| `#/guide` | Site Guide | static content - how to use every feature |
| `#/coach/upload` | Coach Upload | spreadsheet upload form (live API only) |
| `#/coach/dashboard` | Coach Dashboard | coverage gaps, trends, scouting, practice focus |
| `#/admin/corrections` | Admin corrections | outlier inbox + recent approvals |
| `#/admin/dedup` | Admin dedup | dedup candidates |
| `#/admin/hudl` | Admin Hudl | Hudl team registration |

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
| GET | `/api/coach/dashboard` | `coachDashboard.ts` | ❌ Coach tool — live API only |
| GET | `/api/coach/trends` | `coachDashboard.ts` | ❌ Coach tool — live API only |
| GET | `/api/coach/scouting` | `coachDashboard.ts` | ❌ Coach tool — live API only |
| GET | `/api/coach/practice-focus` | `coachDashboard.ts` | ❌ Coach tool — live API only |
| POST | `/api/commitments/submit` | `commitments.ts` | ❌ Write endpoint — live API only |
| GET | `/api/corrections/flagged` | `corrections.ts` | ❌ Admin only — intentionally excluded |
| GET | `/api/corrections/recent` | `corrections.ts` | ❌ Admin only — intentionally excluded |
| GET | `/api/admin/dedup-candidates` | `adminDedup.ts` | ❌ Admin only — intentionally excluded |
| PATCH | `/api/admin/dedup-candidates/:id` | `adminDedup.ts` | ❌ Admin only |
| POST | `/api/admin/dedup-candidates/:id/merge` | `adminDedup.ts` | ❌ Admin only |

---

## 10. Deployment

The site is deployed via a **single Azure Container App** (`pll-server`, `min-replicas=1`). The `deploy.yml` workflow:
1. Builds the monorepo (typecheck + tests)
2. Builds the Docker image — includes Vite SPA build (`pnpm --filter @pll/web build`) and bakes `packages/web/dist` into the image
3. Pushes to GHCR and deploys to ACA via `azure/container-apps-deploy-action`

All views call the Fastify API on the same origin. The Fastify server serves:
- `/api/*` — API routes
- `/logos/*` — static team logos (GIFs, `Cache-Control: immutable`)
- `/*` — SPA files from `packages/web/dist/` with SPA fallback (`index.html`) for client-side routes

- **Production URL:** `https://phillylaxstats.com/`
- **API backend:** same origin — `https://phillylaxstats.com/api/*`
- **ACA FQDN:** `pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`

SPA routing is handled by `app.ts` `setNotFoundHandler` (returns `index.html` for non-API, non-logos paths).

---

## 11. Key Architectural Decisions

### ADR-001: SQLite as the primary database
**Decision:** Use SQLite (via `better-sqlite3`) rather than a hosted database.  
**Why:** The entire dataset is small enough to fit in one file (<50MB), the ingest pipeline runs on a single machine (Mac Mini self-hosted runner), and SQLite requires no separate server process. The DB file is uploaded to Azure File Share and downloaded at the start of each nightly run — effectively using Azure as a persistence layer.  
**Trade-off:** Concurrent writes are not supported. The pipeline is designed to be single-writer. Read-heavy API queries are fine.

### ADR-002: Single container serving SPA + API (2026-06-24)
**Decision:** Azure Container App (`pll-server`, `min-replicas=1`) serves both the Vite SPA and the Fastify API from `https://phillylaxstats.com`.  
**Why:** The previous two-service split (Azure SWA + ACA scale-to-zero) produced 15-20 second cold starts because GitHub Actions scheduler jitter made keep-warm pings unreliable. With `min-replicas=1` required anyway, consolidation costs the same (~$5-8/mo) but removes SWA tooling, cross-origin proxy rewrites, and a second CI deploy job.  
**Trade-off:** No CDN for static assets (negligible for a Philadelphia-metro audience; assets served with `Cache-Control: immutable`).

### ~~ADR-003: Static JSON export~~ (SUPERSEDED)
**Status:** Superseded. The static export pattern (`exportStatic.ts`, `staticLoader.ts`, `IS_STATIC` guards) was removed in May 2026 when the site moved fully to Azure SWA with live API calls.

### ADR-004: Season hardcoded to 2026
**Decision:** `DEFAULT_SEASON = 2026` in `seasons.ts`.  
**Why:** Multi-season support was not needed at build time. Adding it requires parameterizing all queries.  
**Trade-off:** At the end of the 2026 season, this value needs to be updated before the 2027 season begins.

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

### ~~Static export gaps~~ (RESOLVED)

Static export is no longer used. All views call the live API directly.

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
1. `packages/server/src/routes/seasons.ts` - hardcoded season list
2. Any hardcoded `2026` references in views or queries

---

## 13. Community Corrections Operations

### CORS configuration

The Azure Container App (`pll-server`) serves the frontend and API from the same origin (`https://phillylaxstats.com`), so CORS is only needed for local development. The `CORS_ORIGINS` environment variable defaults to `http://localhost:5173` for dev. No changes are needed for production correction POSTs.

### Required GitHub Actions secret

Add `VITE_API_URL` as a GitHub Actions secret (Settings -> Secrets -> Actions):
- Value: the Azure Container Apps URL for the server (for example, `https://pll-server.<hash>.azurecontainerapps.io`)
- This is used at build time so the SPA knows where to send API requests

### Correction lifecycle

1. User submits via the edit button -> `POST /api/corrections` -> stored as `pending`
2. Nightly ingest runs (`ingest-nightly.yml`)
3. `applyCorrections.ts` runs after ingest, applies all `pending` non-outlier corrections
4. Outlier corrections (for example, goals: 2 -> 200) are marked `outlier` and skipped
5. Admins can review flagged items via `GET /api/corrections/flagged` or the `#/admin/corrections` inbox on the live web app
6. Recent applied/outlier activity is exposed via `GET /api/corrections/recent` for the inbox summary table
7. Applied corrections survive re-ingest because `applyCorrections.ts` runs after ingest each night
