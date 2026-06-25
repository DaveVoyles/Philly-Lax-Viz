# PBLA (Philadelphia Box Lacrosse Association) System Guide

> Complete reference for future agents working on the PBLA section of PhillyLaxStats.

## 1. Overview

The PBLA section is a standalone league tracker within PhillyLaxStats that covers the Philadelphia Box Lacrosse Association adult league. It tracks standings, player stats, goalie stats, game schedules, rosters, and livestream videos.

**Live API + hardcoded fallback architecture (as of 2026-06-25):**

The web views load data from the **live API** first (via `pblaLoader.ts`) and fall back to the hardcoded TypeScript file (`pblaData.ts`) only if the API is unavailable. The API reads from `pbla_*` SQLite tables, which are updated by `syncPbla.ts` via the `sync-pbla.yml` CI workflow every Tue/Thu at 6 AM ET.

```
Sportability (HTML scrape)
        │
        ▼
  syncPbla.ts  ──►  pbla_* SQLite tables  ──►  /api/pbla/* (live)
                                                      │
  pblaData.ts (hardcoded) ◄─── patchPblaData.ts      │ fetched by
  (auto-patched by CI)                                ▼
                                              pblaLoader.ts
                                              (browser-side, 5-min cache)
                                                      │
                                              pblaTeam.ts / pbla.ts
```

**Important:** The container copies the Azure File Share DB to `/tmp/lacrosse.db` at startup. After `syncPbla.ts` uploads a fresh DB, the container **must be restarted** to pick up the new data. `sync-pbla.yml` handles this automatically via `az containerapp revision restart` after every upload.

## 2. Data Source: Sportability

All PBLA data originates from Sportability:

| Data type | URL | Notes |
|-----------|-----|-------|
| Standings | `secure.sportability.com/spx/Leagues/Standings.asp?LgID={leagueId}` | Team records, points, streaks |
| Schedule | `secure.sportability.com/spx/Leagues/Schedule.asp?LgID={leagueId}` | Full season schedule with scores |
| Player Stats | `secure.sportability.com/spx/Leagues/Statistics.asp?LgID={leagueId}&Pkg=1` | Goals, assists, points, penalties |
| Goalie Stats | `secure.sportability.com/spx/Leagues/Statistics.asp?LgID={leagueId}&Pkg=2` | Games, minutes, GA, GAA |
| Rosters | `secure.sportability.com/spx/Leagues/Rosters.asp?LgID={leagueId}` | Per-team rosters |

**League IDs:**
- 2026 season: `50731`
- 2025 season: `50247`

### Sportability Limitations

1. **JavaScript dropdowns** - The Statistics page uses a `<select>` dropdown to switch between Player Stats (`Pkg=1`) and Goalie Stats (`Pkg=2`). Each is a separate URL parameter, not a JS-only toggle.
2. **No API** - Sportability has no public API. All data must be scraped from HTML or copy-pasted.
3. **Schedule page is static HTML** - Unlike stats, the schedule page renders all games in a single HTML table without JS interaction. It can be fetched directly.
4. **Scores appear inline** - Played games show scores inline in the team names column (e.g., "Outlaws 5 at More Dudes LC 14"). Unplayed games show just team names.

## 3. File Map

| File | Role |
|------|------|
| `packages/web/src/views/pblaData.ts` | Hardcoded fallback data + `PBLA_VIDEOS` map; auto-patched by CI |
| `packages/web/src/views/pblaLoader.ts` | **Primary data path:** fetches live API, merges with team metadata (`TEAM_META`), falls back to `pblaData.ts`; 5-min browser cache |
| `packages/web/src/views/pbla.ts` | PBLA landing page (standings, leaders, upcoming games, WebGL particles) |
| `packages/web/src/views/pblaTeam.ts` | Team detail page (roster, stats, game history, video links) |
| `packages/server/src/routes/pbla.ts` | API routes: `/api/pbla/standings`, `/api/pbla/games`, `/api/pbla/players`, `/api/pbla/goalies`, `/api/pbla/scrape-log`, `POST /api/pbla/scrape` |
| `packages/server/src/scheduler/pblaScheduler.ts` | In-process scheduler; runs `syncPbla.ts` Mon-Fri at 11 PM ET inside the container |
| `packages/ingest/src/scripts/syncPbla.ts` | Scrapes Sportability, upserts into `pbla_*` SQLite tables |
| `packages/ingest/src/scripts/syncPblaVideos.ts` | Fetches YouTube RSS, parses game dates from titles, updates `PBLA_VIDEOS` in `pblaData.ts` |
| `packages/ingest/src/scripts/patchPblaData.ts` | Patches game scores from DB snapshot into `pblaData.ts` (run by CI when new results detected) |
| `packages/ingest/src/scripts/patchPblaStats.ts` | Updates player/goalie stats in `pblaData.ts` from DB |
| `packages/ingest/src/scripts/patchPblaRosters.ts` | Updates rosters in `pblaData.ts` from Sportability |
| `packages/ingest/src/scripts/parseSportability.ts` | Manual parser: paste text -> TS array output |
| `packages/ingest/src/sources/sportability.ts` | HTTP source module for Sportability scraping |
| `.github/workflows/sync-pbla.yml` | Tue/Thu 6AM ET: sync DB → restart container → patch pblaData.ts → sync videos → deploy |

## 4. Data Model

### Types (defined in `pblaData.ts`)

```typescript
interface PblaTeam {
  id: number;
  name: string;
  gp: number; wins: number; losses: number; ties: number;
  otw: number; otl: number; pts: number;
  pf: number; pa: number; diff: number;
  streak: string; color: string;
  captain?: string; jerseyImg?: string;
}

interface PblaPlayer {
  jersey: number; name: string; team: string;
  gp: number; goals: number; assists: number;
  points: number; penalties: number; pim: number;
}

interface PblaGoalie {
  jersey: number; name: string; team: string;
  gp: number; min: number; ga: number; gaa: number;
}

interface PblaRosterEntry {
  name: string; jersey: string; position: string; notes: string;
}

interface PblaGame {
  gameNum: number; date: string; time: string;
  homeTeam: string; awayTeam: string;
  homeScore: number; awayScore: number;
  location: string; isPlayoff: boolean; note: string;
}

interface PblaSeason {
  year: number; leagueId: number; label: string;
  teams: PblaTeam[];
  players: PblaPlayer[];
  goalies: PblaGoalie[];
  rosters: Record<string, PblaRosterEntry[]>;
  games: PblaGame[];
}
```

### Video Map

```typescript
// YouTube stream IDs keyed by ACTUAL GAME date (not YouTube published date,
// which is always one day later). Auto-synced by syncPblaVideos.ts.
export const PBLA_VIDEOS: Record<string, string> = {
  '2026-05-18': 'rE0TzPfV5SY',
  '2026-05-20': 'hMd-kLZXl7o',
  '2026-05-27': 't09kMS7NBE0',
  // ... continues through end of season
};
```

Each date has ONE stream covering both games played that night. Source: `@PBLA_Official` YouTube channel (channel ID `UC8dQQ4Z-MjxCCBu380ViuEg`).

**IMPORTANT:** YouTube RSS `<published>` dates are always the day AFTER the game. `syncPblaVideos.ts` parses the game date from the video title (e.g. `"PBLA: June 22, 2026 - Livestream..."`) — do not use `published` dates as keys.

### Helper Functions

| Function | Purpose |
|----------|---------|
| `getPblaSeason(year)` | Get season data by year |
| `getTeamGames(teamName, season)` | All games for a team |
| `getTeamPlayers(teamName, season)` | Player stats for a team |
| `getTeamGoalies(teamName, season)` | Goalie stats for a team |
| `getTeamRoster(teamName, season)` | Full roster for a team |
| `getGameVideoId(date)` | YouTube video ID for a game date |
| `teamColor(name)` | Team's primary color |
| `teamPalette(name)` | Full color palette for a team |
| `teamSlug(name)` | URL-safe slug for routing |
| `findTeamBySlug(slug, season)` | Reverse lookup from slug to team |

## 5. Automation Scripts

### `parseSportability.ts` — Manual Text Parser

**When to use:** After copy-pasting player or goalie stats from the Sportability website.

**Why it exists:** The Sportability stats page uses JavaScript dropdowns. The simplest workflow is: open page in browser, select the correct view, copy the table text, pipe it through this parser.

```bash
# Player stats
cat players.txt | pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=players

# Goalie stats
cat goalies.txt | pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=goalies
```

**Input format (players):**
```
1  92 - Brian Beatson  Outlaws  2  2  6  8  0  0  0
```

**Output:** TypeScript object literals ready to paste into `pblaData.ts`.

**Handles both tab-separated (browser copy) and 2+ space-separated (chat paste) formats.**

### `syncPbla.ts` — Automated DB Sync

**When to use:** Runs automatically Tue/Thu via `sync-pbla.yml`. Run manually to force a refresh.

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts --dry-run
pnpm --filter @pll/ingest exec tsx src/scripts/syncPbla.ts --league=50731
```

**What it does:**
1. Calls `scrapePblaLeague()` from `sources/sportability.ts`
2. Parses standings, player stats, goalie stats, and schedule
3. Upserts into `pbla_teams`, `pbla_players`, `pbla_goalies`, `pbla_games`, `pbla_scrape_log`

**DB tables used:**
- `pbla_teams` — unique on `(league_id, name)`
- `pbla_players` — unique on `(league_id, name, team)`
- `pbla_goalies` — unique on `(league_id, name, team)`
- `pbla_games` — game schedule and scores
- `pbla_scrape_log` — audit trail of scrape runs

**After the workflow uploads the updated DB to Azure File Share, it restarts the container** so the server re-reads the file from `/tmp/lacrosse.db`. Without the restart, the container keeps serving stale data from its in-memory copy. Check `GET /api/pbla/scrape-log` on the live site to verify the latest `scraped_at` timestamp.

### `syncPblaVideos.ts` — YouTube Video Sync

**When to use:** Runs automatically on every `sync-pbla.yml` execution (Tue/Thu 6AM ET, the morning after Mon/Wed games). Run manually if you need to backfill links.

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts --dry-run
```

**What it does:**
1. Fetches YouTube RSS feed for channel `UC8dQQ4Z-MjxCCBu380ViuEg` (@PBLA_Official)
2. For each entry, parses the **game date from the title** (e.g. `"PBLA: June 22, 2026 - Livestream..."`) — the RSS `<published>` date is always one day late and must not be used
3. Skips entries without a parseable date (generic "Live Stream" placeholder videos)
4. Reads current `PBLA_VIDEOS` map from `pblaData.ts`, adds any missing date→videoId pairs
5. Writes the updated block back to `pblaData.ts`

**Important:** This script directly edits `pblaData.ts`. The `sync-pbla.yml` workflow commits the change and triggers a deploy automatically.

## 6. Mid-Season Update Workflow

### Updating Player/Goalie Stats

1. Open `https://secure.sportability.com/spx/Leagues/Statistics.asp?LgID=50731&Pkg=1`
2. Select "All Teams" in the dropdown (should be default)
3. Copy the entire stats table text
4. Save to a temp file or pipe directly:
   ```bash
   pbpaste | pnpm --filter @pll/ingest exec tsx src/scripts/parseSportability.ts --type=players
   ```
5. Replace the `players` array in `pblaData.ts` with the output
6. Repeat with `Pkg=2` for goalies
7. Build, commit, push

### Updating Standings

1. Open `https://secure.sportability.com/spx/Leagues/Standings.asp?LgID=50731`
2. Manually update the `teams` array in `pblaData.ts` with current W/L/T/Pts values
3. (Or run `syncPbla.ts --dry-run` to see parsed standings, then copy values)

### Updating Game Scores

1. Open `https://secure.sportability.com/spx/Leagues/Schedule.asp?LgID=50731`
2. Find games with new scores (format: "Team A {score} at Team B {score}")
3. Update `homeScore` and `awayScore` in the corresponding game entries in `pblaData.ts`

### Adding Video Links

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPblaVideos.ts
```

Or manually add to the `PBLA_VIDEOS` map if you know the video ID.

## 7. Web Views

### `pbla.ts` — Landing Page (`#/pbla`)

Features:
- WebGL particle constellation background (Pixi.js)
- Live badge (pulses when games are active Mon/Wed 7-9:30pm ET)
- "Next game" indicator derived from actual schedule dates
- Standings table (sortable by any column)
- Top scorers leaderboard
- Upcoming games grid (cards with dates, matchups)
- Season selector dropdown (2025, 2026)

**Live detection logic:**
- Season months: May-August
- Game nights: Mon & Wed
- Live window: 7:00pm - 9:30pm Eastern
- `isLiveNow()` checks all three conditions

**Next game logic:**
- Uses actual game dates from the schedule data
- Falls back to 'TBD' if all games are in the past

### `pblaTeam.ts` — Team Detail Page (`#/pbla/teams/:slug`)

Features:
- Team header with color branding + WebGL particle burst on click
- Full roster table (if roster data exists for team)
- Player stats table (filtered to team, sortable)
- Goalie stats table
- Game history with W/L indicators, scores, and YouTube "Watch" links
- CSS grid layout: `1fr auto auto 1fr` for balanced score alignment

**Game row grid:** Teams column (left flex) | Score | Meta (date+result) | Video column (right flex). The `1fr ... 1fr` ensures scores stay centered even when the Watch button is absent.

## 8. Routing

Registered in `packages/web/src/router.ts`:

```
#/pbla          -> pbla.ts (landing)
#/pbla/teams/:slug -> pblaTeam.ts (team detail)
```

Navigation label: "Box Lacrosse" (in main nav, lazy-loaded).

## 9. 2026 Season Teams

| Team | Color | Sportability Filter ID |
|------|-------|----------------------|
| Beer Wolves | `#22c55e` | 343513 |
| Edge | `#ef4444` | 343512 |
| More Dudes LC | `#800000` | 343517 |
| Outlaws | `#003087` | 343511 |
| Pups LC | `#a855f7` | 343514 |
| Revolution | `#3b82f6` | 343515 |
| Thunder | `#facc15` | 343516 |

**Note:** Team name is "More Dudes LC" in 2026 (was "More Dudes" in 2025).

## 10. Future Improvements (TODO)

1. **Migrate web views to read from API/DB** — `pblaLoader.ts` already does this as the primary path (live API first, hardcoded fallback). The remaining gap is that `pblaData.ts` hardcoded data is still needed as a fallback and for initial container seeding.
2. ~~**Add PBLA nightly sync to CI**~~ — ✅ Done. `sync-pbla.yml` runs Tue/Thu and handles the full pipeline: sync DB → restart container → patch pblaData.ts → sync video IDs → deploy.
3. ~~**Schedule page scraper**~~ — ✅ Done. `syncPbla.ts` includes schedule scraping.
4. **Full Playwright automation** for stats pages (if Sportability stats need JS interaction for all data)
5. **Roster scraper** — Sportability rosters page could be scraped to auto-populate `rosters` object (partially done via `patchPblaRosters.ts`)

## 11. Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| "Next game" shows wrong date | Fixed: now uses actual schedule data, not generic Mon/Wed algorithm |
| Stats don't include all players | Sportability stats page may require selecting "All" from dropdown; Pkg=1 shows all players by default |
| Team name mismatch between seasons | 2025 uses "More Dudes", 2026 uses "More Dudes LC". Helpers handle this via exact match. |
| Video link throws off grid alignment | Game row uses `1fr auto auto 1fr` grid. Video button has its own column with `justify-self: end`. |
| `homeTeam`/`awayTeam` confusion | Sportability format: "Away at Home". In our data: `homeTeam` = the team being visited. |
| Playoff games show TBD | Expected — playoff matchups determined at end of regular season. |
| Live site shows stale standings (e.g. gp=1) | The container copies the DB to `/tmp` at startup. After a DB upload, the container must be restarted. `sync-pbla.yml` does this automatically via `az containerapp revision restart`. Verify by checking `GET /api/pbla/scrape-log` — `scraped_at` should be recent. |
| Video links don't appear for new games | `syncPblaVideos.ts` parses game dates from video **titles**, not from the YouTube RSS `<published>` date (which is always one day late). If a video has a non-standard title without a date, it will be skipped. Add manually to `PBLA_VIDEOS` in `pblaData.ts`. |
| Season label shows "(Live)" | This was the old label set by `pblaLoader.ts` when data came from the live API. Changed to "Season" in 2026-06-25. |

## 12. Adding a New Team (Checklist)

When a new team joins the PBLA at the start of a season:

1. **Add to `pblaData.ts` teams array** — copy an existing team entry, update `id`, `name`, `gp`, `wins`, `losses`, `ties`, `otw`, `otl`, `pts`, `pf`, `pa`, `diff`, `streak`, `color`, `captain`, `jerseyImg`.
2. **Add to `pblaLoader.ts` TEAM_META** — add an entry with `captain` and `jerseyImg` to the `TEAM_META` map so the live API path picks it up.
3. **Add an empty roster block** to `pblaData.ts` rosters section: `TeamName: [],`
4. **CI auto-fills the roster** — the next `sync-pbla` run will call `patchPblaRosters.ts`, fetch the full roster from Sportability, and commit it automatically.

### How roster auto-patching works

The `sync-pbla` workflow (Tue/Thu 6AM ET) runs `patchPblaRosters.ts` on every execution:

- Fetches each team's roster page from Sportability
- Compares against `pblaData.ts` rosters block
- If any players are missing, inserts them and commits `chore(pbla): auto-sync rosters from Sportability`
- Triggers a deploy so the live site updates immediately

**You never need to manually enter roster data.** Just add the empty `TeamName: []` block and CI handles the rest on the next run.

### Manual trigger (if you can't wait for the nightly run)

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts --dry-run  # preview
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaRosters.ts             # apply
git add packages/web/src/views/pblaData.ts && git commit -m "chore(pbla): sync rosters" && git push
```

### Verifying roster state (read-only)

```bash
pnpm pbla:check -- --roster
```

Output:
- `OK` — team roster matches
- `MISSING` — players on Sportability but not in `pblaData.ts`
- `ONLY in pblaData.ts` — players in static data but no longer on Sportability
- `*** has NO roster block ***` — team was added without any roster block

### How Sportability team IDs work

Team IDs (`TmID`) are assigned per-season. The `patchPblaRosters.ts` script reads them automatically from the standings page — no manual ID lookup needed. See §9 for the current 2026 season team IDs.
