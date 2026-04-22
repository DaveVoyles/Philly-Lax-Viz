# 2026-04-22 — Roadmap: Data Accuracy, Azure Deployment, WebGL & Coverage Gaps

Forward-looking plan after the Wave 9 Harriton attribution fix + ghost-team cleanup. Three independent tracks; each can ship as its own wave.

---

## Track A — Data Accuracy (Wave 10)

### Current state (post-W9 cleanup)

| Metric | Value | Notes |
| --- | --- | --- |
| Teams | 241 | down from 375; ghost rows purged |
| Games | 547 | scoreboard + summaries |
| Players | 1,506 | post-Harriton fix |
| Player stats | 3,509 | post-Harriton fix |
| Anomalies | 3,140 | now a health signal, not noise |
| Aliases | 9 | only PIAA-name variants seeded |

### Anomaly breakdown (top reasons)

| Reason | Count | Fix path |
| --- | --- | --- |
| `sub-header did not match either game team` | 2,694 | **Curated alias seed** (biggest win) |
| `team hint did not resolve to either side of the score line` | 131 | Same alias seed catches these too |
| `period sum does not equal total` | 53 | Quarter-line parser tolerance |
| `no stat tokens recognized in line` | 34 | Add OCR-style fuzzy match for `g.`, `g`, `goals` variations |
| `score line did not match Team A N, Team B N pattern` | 16 | Manual review — likely truly malformed |
| `duplicate rank N in post` | 50 | Rankings dedup — pick latest week |

### A1 — Curated alias seeding (quick win, biggest impact)

Real abbreviations observed in anomalies, mapped from current data:

```
UMerion       -> Upper Merion
QHS           -> Quakertown
MHS           -> Methacton
PHX           -> Phoenixville
JBHA          -> Jack Barrack
HHS           -> Haverford High
DTE           -> Downingtown East
DTW           -> Downingtown West
OJR           -> Owen J. Roberts
PJP           -> Pope John Paul II
SJP           -> St. Joseph's Prep
WCH           -> West Chester Henderson
WCE           -> West Chester East
CBE / CB East -> Central Bucks East
CBW / CB West -> Central Bucks West
ABW           -> Archbishop Wood
SCH           -> Springside Chestnut Hill
SAHS          -> Springside / St. Andrew's (need disambiguation pass)
BHS           -> Boyertown? Bensalem? Bishop Shanahan? -- skip without source-post evidence
TV            -> Twin Valley
DV            -> Downingtown? Delaware Valley? Daniel Boone (rare) -- skip
GA            -> Germantown Academy
EA            -> Episcopal Academy
LM            -> Lower Merion
PC            -> Penn Charter
MR            -> Malvern Prep? -- needs check
Shanahan      -> Bishop Shanahan
O'Hara        -> Cardinal O'Hara
```

**Approach**: extend `seedTeamAliases.ts` with a "parser-abbreviation" section. For ambiguous tokens (BHS, DV, MR), grep raw post HTML and confirm before seeding. Skip rather than guess.

**Expected impact**: cuts anomaly count from ~3,140 → ~500-800; recovers ~2,000 player-stat rows that are currently dropped as "uncertain team."

### A2 — Player name dedup (Wave 11 candidate)

`Pierce Merill` vs `Peirce Merrill`, `Yusef` vs `Yusuf Abbas`, `Colin Ward` vs `Collin Ward` are the same player with one spelling variant per source post.

**Approach**: Levenshtein distance ≤ 2 within the same `team_id`, manual review of candidates above a threshold, merge with audit trail in a `player_aliases` table mirroring `team_aliases`.

### A3 — PIAA cross-validation badge

For every team with a PIAA mapping, compare our derived W-L vs PIAA's official W-L. Surface a small badge on the team card:
- ✅ Matches PIAA exactly
- ⚠️ Off by 1-2 (likely missing a non-Philly opponent)
- 🔴 Off by ≥3 (data quality concern)

Link the team page header to the source PIAA page so users can verify directly.

### A4 — Anomaly browser page

A simple `/anomalies` page that lists current anomalies grouped by reason + most common raw_line. Lets the maintainer (or a sub-agent) triage in one screen instead of hand-querying SQLite.

---

## Track B — Azure Deployment

### Architecture

```
┌────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│ Static Web App │────▶│  Azure Container │────▶│ Persistent storage │
│ (web/dist)     │     │  Apps (server)   │     │ (Azure Files mount │
│ free tier      │     │  consumption     │     │  for lacrosse.db)  │
└────────────────┘     └──────────────────┘     └────────────────────┘
        ▲                       ▲
        │                       │
   end users               GitHub Actions
                           runs ingest nightly,
                           commits db → blob upload
```

### Recommended SKUs (truly low-cost)

| Component | SKU | Monthly cost (USD, East US) | Notes |
| --- | --- | --- | --- |
| **Azure Static Web Apps** | Free tier | **$0** | 100 GB bandwidth/mo, custom domain, free SSL |
| **Azure Container Apps** | Consumption (scale-to-zero) | **~$0-3** | First 180k vCPU-sec + 360k GiB-sec free monthly; idle = $0 |
| **Azure Storage (Files)** | LRS, 1 GB used | **~$0.06** | DB is 3.1 MB, plenty of room |
| **Azure Container Registry** | Basic | **~$5** | Or skip — build directly from GHCR (free) |
| **GitHub Actions** | Free tier | **$0** | 2,000 min/mo for public repo unlimited |
| **Application Insights** | Free tier | **$0** | Up to 1 GB ingest/mo |
| **Total (steady state)** | | **~$0-8/mo** | |

**Even cheaper alternative**: Static Web App + bundled Functions backend (free tier). Trade-off: SQLite via better-sqlite3 needs file system; Functions Linux Consumption supports `/tmp` but reset on cold start. Container Apps is more durable.

**Cheapest of all** (if HTTPS isn't needed): **Azure Static Web Apps Free** alone with the database baked into the bundle as a static `.json` snapshot rebuilt nightly. Backend disappears entirely. Loses real-time queries, but for read-only weekly stats this is plausible.

### Deployment plan

#### B1 — Containerize the API
- Dockerfile in `packages/server/` running `node + tsx + better-sqlite3` on `node:20-alpine`
- Multi-stage: build `pnpm install --prod` → copy server + shared dist
- Mount DB at `/data/lacrosse.db` from Azure Files volume

#### B2 — GitHub Actions pipeline
- `.github/workflows/deploy.yml`:
  - On push to `main`: run all tests + typecheck
  - Build web bundle → deploy to SWA via `Azure/static-web-apps-deploy@v1`
  - Build server image → push to GHCR
  - Update Container App revision via `azure/container-apps-deploy-action@v1`
- `.github/workflows/ingest-nightly.yml`:
  - Cron at 02:00 ET daily
  - Run `pnpm ingest --category=hs-summaries` and `--category=hs-scoreboards`
  - If DB changed: upload to Azure Files via `azcopy` and restart Container App
  - Post commit log + anomaly delta to a Discord/Slack webhook (optional)

#### B3 — Domain + SSL
- Free `*.azurestaticapps.net` URL out of the box
- Custom domain (`phillylax.dev` or similar) — DNS CNAME, free SSL via SWA
- Upstream proxy to Container App via SWA's `linked APIs` feature (no CORS needed)

#### B4 — Observability
- App Insights instrumentation in `server/src/index.ts` (existing pino logger → AI Sink)
- Dashboards: request count, p50/p99 latency, error rate
- Anomaly count gauge published as a custom metric per ingest run

### Operational notes

- **DB backup**: Azure Files snapshot nightly (free, retained 7 days)
- **Rollback**: Container App revisions are immutable; previous revision can be activated in seconds
- **Scaling**: scale-to-zero default; can bump min-replicas if cold-start matters (~1s for our app)
- **Total provisioning time**: ~30 min once the Dockerfile + workflows exist

---

## Track C — Visualization Polish (WebGL & beyond)

The original brief said "WebGL + TypeScript" — we shipped D3/SVG instead because the data volume (547 games, 1,506 players) doesn't justify GPU acceleration. SVG renders these in milliseconds. WebGL becomes valuable when **the visualization itself is the experience**, not when the dataset demands it.

### Where WebGL genuinely shines for this app

#### C1 — Network graph: rivalry & strength-of-schedule
- Force-directed graph of all 241 teams; node size = wins, edge thickness = games played, edge color = score margin
- WebGL via [`pixi.js`](https://pixijs.com/) or [`sigma.js`](https://www.sigmajs.org/) handles 241 nodes + ~547 edges smoothly with pan/zoom/hover at 60 fps
- SVG version would lag at this density; canvas+webgl is the right tool
- **Stand-out factor**: high — nobody else publishes this view of the league

#### C2 — Player constellation
- Each player a glowing point in 2D, position from PCA on (goals, assists, save%, GBs, FOs)
- Hover for tooltip; click to navigate to player page
- WebGL particles via `regl` or `three.js` — easy to animate transitions when filters change
- Visualizes "who is similar to whom" — useful for college recruiters / fans

#### C3 — Season heat-map calendar
- Time × team grid; cell color = goal differential that day
- 60+ teams × 12 weeks = ~720 cells, fine in SVG, but a WebGL `gl-heatmap` lets you cross-fade between metrics (goals scored, allowed, differential) interactively

#### C4 — Animated ranking ladder
- "Bar chart race" of PIAA power rankings over the season
- d3 + canvas is enough; WebGL only needed if we add particle-trail effects per team

### Visualization features that don't need WebGL but stand out

- **Game replay scrubber**: scrub through quarters of a single game; bar chart of cumulative goals updates per-quarter, with player goal/assist tags appearing as they happen
- **Head-to-head comparator**: pick two teams, side-by-side season summary + their previous matchup history
- **"On fire" indicator**: players with >2 goals in their last 3 games get a flame badge on leaderboards
- **Photo + roster integration** — see Track D below
- **Embed-friendly chart export**: each chart gets a "copy embed" button for sharing on social

### Recommended near-term order

1. Network rivalry graph (WebGL, high stand-out) — **the headline visual**
2. On-fire indicator on leaderboards (data-only, low effort, high signal)
3. Game replay scrubber (per-game detail page enhancement)
4. Player constellation (after we have more depth in advanced stats)

---

## Track D — Data sources we're missing

### High-value additions (ranked by effort/value)

#### D1 — Goalie stats (saves, save %)
- Currently parsing but not surfacing. Add `/leaders?stat=saves` and a goalie tab on team pages.
- **Effort**: S (~30 min) — schema already supports it.

#### D2 — Faceoff and ground-ball leaders
- Same situation as D1 — already parsed from summary lines like "Caleb Goering 12 GB, 8/10 FO".
- Adds depth for midfielder appreciation (currently leaderboards are goals-heavy).

#### D3 — Schedule data (upcoming games)
- Source: PIAA District 1 schedule pages, or LaxNumbers (`https://laxnumbers.com/...`).
- Enables "next game" widget, win-prediction model, alerts.

#### D4 — College commits
- Source: scrape PhillyLacrosse's "commits" tag posts; or pull from Inside Lacrosse's commits API if affordable.
- Adds badges to player pages — huge engagement driver for the recruiting audience.

#### D5 — Historical seasons (2024, 2025)
- Same RSS feed structure works, just earlier date range. Multi-season view enables "team trajectory" charts and class-year cohort analysis.

#### D6 — Photos & rosters
- PhillyLacrosse posts often include featured images. Strip + cache for team headers.
- Roster pages from team websites would let us pre-create players (graduation year, jersey #, position) before any stats are reported.

#### D7 — Inter-Ac & private school coverage
- Currently weighted toward PIAA District 1 public schools. Inter-Ac (Penn Charter, Episcopal, Haverford School, Malvern, GA, Springside) and Friends Schools League have sparser coverage. Manual schedule import could close the gap.

#### D8 — Weather / venue data
- Game time temps + wind for outdoor games. Marginal value but adds richness to per-game pages.

---

## Suggested wave order

| Wave | Track | Effort | Impact |
| --- | --- | --- | --- |
| **W10** | A1 — alias seeding | M | 🔥 Recovers ~2,000 stats; cuts anomaly count 80%+ |
| **W11** | D1+D2 — goalies + FO/GB leaders | S | Easy depth for current page |
| **W12** | A2 — player dedup | M | Removes confusing duplicates from leaderboards |
| **W13** | B1+B2 — Containerize + deploy to Azure | L | Goes live for public access |
| **W14** | C1 — WebGL rivalry graph | M | Headline visualization |
| **W15** | A3+A4 — anomaly browser + PIAA badge | M | Self-service data quality |
| **W16** | D3+C3 — schedule + game replay | L | Engagement + retention |
| **W17** | D5 — historical seasons | M | Multi-year context |
| **W18** | D4+D6 — commits + photos | M | Recruiting audience |

---

## Open questions for the user

1. **Domain**: is there a domain you'd like to use, or should I check availability of `phillylax.{dev,app,info,vis}` for the live deployment?
2. **Alias confidence policy** (W10): should I auto-seed obvious abbreviations (CBE, CBW, OJR, PJP, SJP) and require human approval only for ambiguous ones (BHS, DV, MR), or require approval for all?
3. **Backend tier** (W13): Container Apps consumption (~$0-8/mo, real DB) or fully static SWA with bundled JSON snapshots ($0/mo, refreshed nightly)?
4. **WebGL choice** (W14): I'd lean `pixi.js` for the rivalry graph — well-maintained, TS-first, small bundle. OK to add?
