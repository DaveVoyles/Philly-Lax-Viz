# Data Sources Quick Reference

> **Token cost:** ~600 tokens  
> **When to load:** Need to understand where data comes from, source priorities, when to sync  
> **See also:** [architecture-full.md](../architecture-full.md) for detailed source documentation

---

## Source Summary

| Source | URL | What it provides | Sync frequency | Trust priority |
|--------|-----|------------------|----------------|----------------|
| **phillylacrosse.com** | RSS feed | Game scores, summaries, player stats | Nightly | 🥉 3rd (scores) |
| **piaad1.org** | HTML/CSV | District 1 rankings, schedule | Nightly | 🥇 1st (rankings) |
| **maxpreps.com** | HTML | Team logos | Weekly (Sunday) | 🥈 2nd (team names) |
| **phillylaxnumbers.com** | API | PA-wide player stats | On-demand | 🔄 Supplementary |
| **hudl.com** | Web scraper | Authenticated roster + per-game stats | Manual | ⭐ Coach-provided |
| **secure.sportability.com** | HTML | PBLA league data (standings, schedule, stats) | Tue/Thu 6AM ET | 🥇 1st (PBLA) |
| **youtube.com/@PBLA_Official** | API | PBLA livestream videos | Manual | 📹 Video only |

---

## Trust Hierarchy (when sources disagree)

### Team Names & Records
1. **PIAA** (`piaad1.org`) — official District 1 source
2. **MaxPreps** (`maxpreps.com`) — national database
3. **PhillyLacrosse** (`phillylacrosse.com`) — local reporting

### Game Scores
1. **PIAA** (for playoff games)
2. **MaxPreps** (if available)
3. **PhillyLacrosse** (most comprehensive for regular season)

### Player Stats
1. **Coach uploads** (manual_uploads via spreadsheet) — ground truth
2. **Hudl** (authenticated scraper) — verified by coaches
3. **LaxNumbers** (phillylaxnumbers.com) — supplementary
4. **PhillyLacrosse** (RSS) — fallback

**Rule:** When stats differ, higher-trust source wins. `player_stats.source` tracks provenance.

---

## Source Details

### 1. phillylacrosse.com (RSS)

**URL:** RSS feed items (HTML bodies embedded in `<description>`)  
**Format:** HTML embedded in RSS  
**Categories:** `scoreboard`, `hs-summaries`  
**Sync:** Nightly via `ingest-nightly.yml`  
**Parsers:** `scoreboardPost.ts`, `summariesPost.ts`, `text.ts`  
**DB tables:** `games`, `game_periods`, `players`, `player_stats`, `ingest_anomalies`, `raw_cache_meta`, `ingest_post_log`

**What it provides:**
- Final scores for all games (via scoreboard posts)
- Quarter-by-quarter breakdowns (via summary posts)
- Per-player stats: goals, assists, ground balls, caused TOs, saves, faceoffs
- Post images (linked from recap pages)

**What it does NOT provide:**
- Shots, clears, turnovers, penalties, attendance
- Goalie save percentage
- Player rosters or profiles
- Games where phillylacrosse.com hasn't published a recap yet (lag: 1-3 days)

**Commands:**
```bash
pnpm crawl              # RSS → data/raw-cache/
pnpm ingest             # parse → data/lacrosse.db
```

---

### 2. piaad1.org — PIAA District 1 Rankings

**URL:** `https://piaad1.org` (HTML + CSV downloads)  
**Format:** HTML tables, downloadable CSVs  
**Sync:** Nightly via `ingest-nightly.yml` → `syncPiaa.ts`  
**DB tables:** `rankings`, `piaa_official_teams`, `schedule`

**What it provides:**
- Official District 1 standings & power rankings
- Team records (wins-losses)
- Playoff brackets
- Future scheduled games (not yet played)

**What it does NOT provide:**
- Per-game scores or player stats
- Quarter-by-quarter breakdowns
- Non-District-1 teams

**Commands:**
```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts
```

**Trust:** ✅ **Authoritative** for District 1 team names, records, and rankings.

---

### 3. maxpreps.com — Team Logos

**URL:** `https://www.maxpreps.com`  
**Format:** HTML scraping  
**Sync:** Weekly (Sunday) via `sync-logos.yml`  
**DB tables:** `teams.logo_url`, `teams.maxpreps_slug`

**What it provides:**
- Team logos (`.gif` format)
- MaxPreps team slugs for future scraping

**What it does NOT provide:**
- Scores or stats (not used as a data source for games)

**Commands:**
```bash
pnpm --filter @pll/ingest sync:logos
```

**Important:**
- Logo files are `.gif` not `.png` (MaxPreps serves .gif)
- `teams.logo_url` stores **bare filename** only (e.g., `harriton.gif`)
- Server prefixes `/logos/` when emitting to clients
- Required footer attribution: *"Team logos courtesy of MaxPreps.com"*

**Override:** Manual slug overrides in `data/team-overrides.json` for teams not found automatically.

---

### 4. phillylaxnumbers.com (LaxNumbers)

**URL:** `https://phillylaxnumbers.com` (API access)  
**Format:** JSON API  
**Sync:** On-demand via `syncLaxNumbersRatings.ts`  
**DB tables:** `player_stats` (supplementary), `games.laxnumbers_game_id`, `laxnumbers_ratings`

**What it provides:**
- PA-wide per-game player stats (goals, assists, etc.)
- Team power ratings (national/regional)
- Game IDs for cross-referencing

**What it does NOT provide:**
- Philadelphia-specific coverage (much broader)
- Quarter-by-quarter breakdowns

**Commands:**
```bash
# Sync team ratings
pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts              # dry-run
pnpm --filter @pll/ingest exec tsx src/scripts/syncLaxNumbersRatings.ts --apply      # write

# Emit CSV of unknown teams
pnpm --filter @pll/ingest exec tsx src/scripts/emitLaxNumbersAliasCsv.ts
```

**Challenge:** Team name matching requires `team_aliases` table. LaxNumbers uses different team names than phillylacrosse.com.

**Trust:** 🔄 **Supplementary** — used to fill gaps when phillylacrosse.com has no recap.

---

### 5. hudl.com — Authenticated Coach Access

**URL:** `https://www.hudl.com` (web scraper, authenticated)  
**Format:** HTML scraping via Playwright  
**Sync:** Manual via `syncHudl.ts`  
**DB tables:** `hudl_teams`, `players`, `player_stats`

**What it provides:**
- Team rosters (names + jersey numbers)
- Per-game stats for Hudl-tracked teams
- Coach-verified data

**What it does NOT provide:**
- Opponent stats (only own team)
- Data for teams not using Hudl

**Requirements:**
- `HUDL_EMAIL` / `HUDL_PASSWORD` env vars
- First-run selector discovery in `--headed` mode
- Service account invited to team's Hudl account

**Commands:**
```bash
# Inspect Hudl DOM / selectors
pnpm --filter @pll/ingest sync:hudl -- --headed

# Scrape Hudl without DB writes
pnpm --filter @pll/ingest sync:hudl -- --dry-run

# Sync all active managed Hudl teams
pnpm --filter @pll/ingest sync:hudl -- --all --db=data/lacrosse.db
```

**Trust:** ⭐ **Coach-provided** — highest confidence for covered teams.

**Admin UI:** `#/admin/hudl` for registering/managing Hudl team links.

---

### 6. secure.sportability.com — PBLA League Data

**URL:** `https://secure.sportability.com/spx/Leagues/` (HTML tables)  
**Format:** Server-rendered HTML (no JS execution needed)  
**Sync:** Tue/Thu 6AM ET via `sync-pbla.yml`  
**DB tables:** `pbla_teams`, `pbla_players`, `pbla_goalies`, `pbla_games` (note: PBLA tables not in main schema yet)

**What it provides:**
- PBLA league standings (GP, W-L-T, OTW/OTL, Pts, PF, PA, diff, streak)
- Per-team player stats (goals, assists, points, penalties, PIM)
- Per-team goalie stats (GP, min, GA, GAA)
- Schedule/results (game number, date, time, teams, scores, location)

**What it does NOT provide:**
- High school lacrosse data (PBLA is box lacrosse only)
- Shot charts, advanced metrics

**League IDs:**
- 2026 season: `50731`
- 2025 season: `50247`

**Commands:**
```bash
# Check for updates
pnpm pbla:check                    # diff live vs. snapshot
pnpm pbla:check -- --save          # overwrite snapshot
pnpm pbla:check -- --generate      # fetch standings + print TS
pnpm pbla:check -- --verify        # compare snapshot vs. pblaData.ts
pnpm pbla:check -- --roster        # diff rosters

# Auto-patch pblaData.ts
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaData.ts

# Sync to DB
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts --dry-run
```

**Trust:** 🥇 **Authoritative** for PBLA — official league management system.

**Guide:** See `docs/pbla-guide.md` for full PBLA workflow documentation.

---

### 7. youtube.com/@PBLA_Official — PBLA Videos

**URL:** `https://www.youtube.com/@PBLA_Official`  
**Format:** YouTube Data API v3  
**Sync:** Manual via `syncPblaVideos.ts`  
**DB tables:** None (video IDs stored in `pblaData.ts`)

**What it provides:**
- PBLA livestream video IDs
- Game video links for embedding

**What it does NOT provide:**
- Stats or scores (video only)

**Channel ID:** `UC8dQQ4Z-MjxCCBu380ViuEg`

**Commands:**
```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts --dry-run
```

---

## Nightly CI Workflow

`.github/workflows/ingest-nightly.yml` runs:

1. `pnpm crawl` — RSS → raw cache
2. `pnpm ingest` — parse → DB
3. `syncPiaa.ts` — PIAA rankings → DB
4. `applyCorrections.ts` — auto-approve non-outliers
5. `pnpm db:upload` — push to Azure File Share
6. Restart Azure Container App

**NOT in nightly:**
- Logo sync (weekly via `sync-logos.yml`)
- PBLA sync (Tue/Thu via `sync-pbla.yml`)
- LaxNumbers sync (on-demand)
- Hudl sync (manual)

---

## Source Attribution (Required)

**On the web client:**
- Footer must include: *"Team logos courtesy of MaxPreps.com"*
- PBLA data: *"PBLA data courtesy of Sportability.com"*

---

## Common Issues

### Team Name Mismatches
**Problem:** LaxNumbers/PIAA/MaxPreps use different team names than phillylacrosse.com  
**Solution:** Populate `team_aliases` table with alternate names  
**Commands:**
```bash
pnpm --filter @pll/ingest exec tsx src/scripts/seedAliasesFromAnomalies.ts
```

### Stale Data
**Problem:** Live site doesn't reflect recent changes  
**Solution:** Ensure `pnpm db:upload` was run after local mutations  
**Check:** `GET /api/freshness` shows last sync timestamp per source

### Missing Player Stats
**Problem:** Player has no stats despite playing  
**Solution:** Check `ingest_anomalies` table for parse failures. May need to add team alias or manually correct.

---

**For detailed source documentation, see:** [architecture-full.md](../architecture-full.md) §3  
**For data reconciliation, see:** [runbooks/source-priority.md](../runbooks/source-priority.md)
