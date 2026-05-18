# Philly Lacrosse Vis 🥍

**[👉 View the live site](https://davevoyles.github.io/Philly-Lax-Viz/)**

> Data refreshes every night. All charts, leaderboards, and stats are available. PWA-installable on desktop and mobile.

<details>
<summary>Developer / admin deployment</summary>

An Azure Static Web Apps instance also exists at
[victorious-pond-0c5ff000f.7.azurestaticapps.net](https://victorious-pond-0c5ff000f.7.azurestaticapps.net)
with a live Fastify API backend. It exposes the player dedup admin UI (`#/admin/dedup`)
and the data-quality anomaly feed — both require a running server and are not intended for end users.

</details>

---

A stats hub for Philadelphia-area high school boys lacrosse. It tracks scores,
standings, player stats, and rankings for the current season — all in one place,
updated nightly.

## What you can explore

- **Teams** — season record (wins/losses), top scorers, and every game played
- **Players** — season totals and a per-game trend chart for goals, assists, and points
- **Games** — full scoreboard with quarter-by-quarter breakdown and player stat tables
- **League Leaders** — ranked leaderboards for goals, assists, saves, faceoff %, and more
- **Top 5 Teams** — a podium-style view of the best records in the league right now
- **Rankings** — PIAA District 1 official standings
- **Rivalries** — a force-directed graph showing head-to-head matchup history
- **Schedule** — upcoming games
- **Player Constellation** — a visual bubble chart plotting every player's goals vs. assists

> **Data is updated every night** by pulling the latest scores and summaries from
> [phillylacrosse.com](https://phillylacrosse.com) and
> [piaad1.org](https://piaad1.org). Team logos courtesy of
> [MaxPreps.com](https://www.maxpreps.com).

---

## For developers

Philadelphia boys high school lacrosse stats visualizer. Scrapes
[phillylacrosse.com](https://phillylacrosse.com) archives, parses scoreboard /
summaries / rankings posts into SQLite, serves a small Fastify API, and
renders D3 charts via a Vite TypeScript SPA. Everything runs locally — no
external services, no auth, no build pipeline beyond `pnpm`.

## Quickstart

Requires Node 24+, pnpm 10+, and a Unix-y shell.

```bash
pnpm install                                # install workspace deps
pnpm crawl --max-pages=5 --category=all     # fetch posts → data/raw-cache/
pnpm ingest                                 # parse cache → data/lacrosse.db
pnpm dev                                    # server :3001 + web :5173 in parallel
```

Then open <http://localhost:5173>.

Useful one-offs:

```bash
pnpm -r typecheck     # strict TS across all packages
pnpm -r test          # vitest across all packages
pnpm --filter @pll/web build
pnpm --filter @pll/ingest sync:hudl -- --headed      # inspect Hudl selectors with a visible browser
pnpm --filter @pll/ingest sync:hudl -- --dry-run     # scrape Hudl without DB writes
pnpm --filter @pll/ingest apply:harriton-workbook -- --workbook='/Users/.../HHS Lax 2026.xlsx' --db=data/lacrosse.db  # dry-run
pnpm --filter @pll/ingest apply:harriton-workbook -- --workbook='/Users/.../HHS Lax 2026.xlsx' --db=data/lacrosse.db --apply
```

---

## 📚 Documentation

| Doc | What it covers |
| --- | --- |
| [AGENTS.md](./AGENTS.md) | **Start here for agents.** Package map, all commands, DB conventions, hard rules, IS_STATIC pattern, community corrections |
| [docs/architecture.md](./docs/architecture.md) | Full system architecture, data-flow diagrams, API endpoint inventory, DB schema, static export coverage map |
| [docs/azure-deployment.md](./docs/azure-deployment.md) | Azure Container App + Static Web Apps deployment, CI/CD workflows, environment config |
| [docs/pipeline-gaps.md](./docs/pipeline-gaps.md) | Known ingest gaps, anomaly types, and improvement backlog |
| [docs/runbooks/source-priority.md](./docs/runbooks/source-priority.md) | Data source authority and score reconciliation rules (MaxPreps vs. PhillyLacrosse vs. PIAA) |
| [docs/improvements/00-INDEX.md](./docs/improvements/00-INDEX.md) | Index of 10 improvement RFCs (data quality, performance, visualizations, devops) |

---

## Architecture (overview)

```
                           ┌────────────────────────────┐
                           │     phillylacrosse.com     │
                           └─────────────┬──────────────┘
                                         │ HTTP (cheerio)
                                         ▼
                           ┌────────────────────────────┐
                           │     @pll/ingest crawler    │
                           │  (category archives + posts)│
                           └─────────────┬──────────────┘
                                         │ writes
                                         ▼
                ┌────────────────────────────────────────────┐
                │  data/raw-cache/<post-id>.html             │
                │  raw_cache_meta  (sqlite — etag, fetched)  │
                └─────────────┬──────────────────────────────┘
                              │ reads
                              ▼
                ┌────────────────────────────────────────────┐
                │  parsers (scoreLine, quarterLine,          │
                │  playerStat, scoreboardPost, summariesPost,│
                │  aggregatedList, rankings)                 │
                └─────────────┬──────────────────────────────┘
                              │ feed
                              ▼
                ┌────────────────────────────────────────────┐
                │  pipelines (categorize, teamResolver,      │
                │  scoreboard, summaries, rankings)          │
                └─────────────┬──────────────────────────────┘
                              │ writes
                              ▼
                ┌────────────────────────────────────────────┐
                │     data/lacrosse.db   (SQLite, WAL)       │
                │   teams, games, game_periods, players,     │
                │   player_stats, rankings, ingest_anomalies │
                └─────────────┬──────────────────────────────┘
                              │ read
                              ▼
                ┌────────────────────────────────────────────┐
                │    @pll/server  (Fastify, port 3001)       │
                │    GET /api/{health,teams,games,           │
                │            players,rankings,anomalies,     │
                │            teams/:id/topScorers,           │
                │            leaders/players,leaders/teams}  │
                └─────────────┬──────────────────────────────┘
                              │ JSON
                              ▼
                ┌────────────────────────────────────────────┐
                │       @pll/web  (Vite SPA, port 5173)      │
                │   hash router → views → D3 chart renderers │
                └────────────────────────────────────────────┘
```

## Package map

| Package        | Role                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `@pll/shared`  | Domain types (`Team`, `Game`, `PlayerStat`, …) shared across packages. |
| `@pll/ingest`  | Crawler, HTML parsers, ingest pipelines, SQLite migration & schema, CLIs (`crawl`, `ingest`). |
| `@pll/server`  | Fastify HTTP API over the SQLite DB. CORS-locked to `localhost:5173`. |
| `@pll/web`     | Vite + TypeScript SPA. Hash router, D3 charts, no framework runtime. |

Full package entry points, key files, and path map → **[AGENTS.md §2 & §7](./AGENTS.md)**.

## Data sources & authority

Per-game scores: **MaxPreps** > PhillyLacrosse.
Season W/L records: **PIAA** > computed-from-games > PhillyLacrosse.
Per-player stats: **PhillyLacrosse** by default, with optional authenticated **Hudl** imports for Harriton roster + game-level stat backfill.

When sources conflict, the higher-authority source wins. See **[docs/runbooks/source-priority.md](./docs/runbooks/source-priority.md)** for the full reconciliation flow.

## Data quality & known gaps

Ingest anomalies are surfaced at [`/data-quality`](http://localhost:5173/#/data-quality).
Known parser gaps and the improvement backlog → **[docs/pipeline-gaps.md](./docs/pipeline-gaps.md)**.

## API & metrics

Full API endpoint inventory, metrics glossary, and DB schema → **[docs/architecture.md](./docs/architecture.md)**.

## Logging

Server and ingest packages use a shared Pino-based logger (`packages/shared/src/logger.ts`).
Control verbosity with `LOG_LEVEL` (`fatal | error | warn | info | debug | trace | silent`).
Full RFC and regression guard → **[docs/improvements/07-centralized-logger-rollout.md](./docs/improvements/07-centralized-logger-rollout.md)**.

