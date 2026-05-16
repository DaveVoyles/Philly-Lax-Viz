# Philly Lacrosse Vis 🥍

**[View the live site](https://davevoyles.github.io/Philly-Lax-Viz/)**

A stats hub for Philadelphia-area high school boys lacrosse. It tracks scores,
standings, player stats, and rankings for the current season — all in one place,
updated nightly.

## What you can explore

- **Teams** — season record (wins/losses), top scorers, and every game played
- **Players** — season totals and a per-game trend chart for goals, assists, and points
- **Games** — full scoreboard with quarter-by-quarter breakdown and player stat tables
- **League Leaders** — ranked leaderboards for goals, assists, saves, faceoff %, and more
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
```

## Architecture

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

## Where to find what

| Concern             | Location |
| ------------------- | -------- |
| HTML parsers        | `packages/ingest/src/parsers/` |
| Ingest pipelines    | `packages/ingest/src/pipelines/` |
| DB schema / migration | `packages/ingest/src/db.ts`, `packages/ingest/src/migrations/` |
| Prepared SQL        | `packages/server/src/queries/statements.ts` |
| API route handlers  | `packages/server/src/routes/` |
| Test fixtures       | `fixtures/` (raw HTML samples) |
| Chart renderers     | `packages/web/src/charts/` |
| Page views          | `packages/web/src/views/` |
| Anomaly UI          | `packages/web/src/views/dataQuality.ts` + `/data-quality` route |

## Pages

- `#/` — dashboard with system health, teams grid, recent games table.
- `#/teams/:id` — team page with W-L record donut, top-scorers chart, full season game log.
- `#/games/:id` — scoreboard, by-quarter chart + table, player stat tables (player names link to player page).
- `#/players/:id` — player header, season totals, per-game points trend chart, per-game table.
- `#/leaders` — league leaders for players and teams across all aggregate stats.
- `#/data-quality` — anomalies feed for triage.

## API

The Fastify server (`:3001`) exposes JSON endpoints consumed by the SPA:

- `GET /api/health` — service liveness.
- `GET /api/teams` · `GET /api/teams/:id` · `GET /api/teams/:id/topScorers`
- `GET /api/games` · `GET /api/games/:id`
- `GET /api/players` · `GET /api/players/:id`
- `GET /api/rankings`
- `GET /api/anomalies`
- `GET /api/leaders/players?metric=&limit=&minGames=&minAttempts=&teamId=`
  - `metric` ∈ `points` (default), `goals`, `assists`, `ground_balls`, `caused_turnovers`, `saves`, `fo_pct`, `points_per_game`
  - `limit` default 25, max 100; `minGames` default 1 (default 2 for `points_per_game`); `minAttempts` default 10 (used by `fo_pct`); `teamId` optional.
- `GET /api/leaders/teams?metric=&limit=`
  - `metric` ∈ `wins` (default), `losses`, `win_pct`, `goals_for`, `goals_against`, `goal_diff`, `gpg`, `gapg`
  - `limit` default 25, max 100.

### Metrics glossary

**Player metrics**

- `points` — goals + assists (G+A).
- `goals` — total goals scored.
- `assists` — total assists.
- `ground_balls` (GB) — total ground balls recovered.
- `caused_turnovers` (CT) — total turnovers caused on defense.
- `saves` — total goalie saves.
- `fo_pct` — faceoff win percentage (`fo_won / fo_taken`); requires `minAttempts` (default 10).
- `points_per_game` — `points / gamesPlayed`; requires `minGames` (default 2).

**Team metrics**

- `wins` / `losses` — game outcomes (team score vs. opponent).
- `win_pct` — `wins / (wins + losses)`, ties excluded.
- `goals_for` / `goals_against` — totals across all games.
- `goal_diff` — `goals_for − goals_against`.
- `gpg` — goals per game (`goals_for / gamesPlayed`).
- `gapg` — goals against per game (`goals_against / gamesPlayed`).

## Data sources & authority

Per-game scores: **MaxPreps** > PhillyLacrosse.
Season W/L records: **PIAA** > computed-from-games > PhillyLacrosse.
Per-player stats: **PhillyLacrosse** (sole source).

When sources conflict, the higher-authority source wins. PIAA publishes season totals only — it cannot resolve disputes about an individual game's score. See `docs/runbooks/source-priority.md` for the full reconciliation flow.

## Data quality

Some real-world phillylacrosse.com posts don't fit any clean parser strategy.
Rather than silently drop them, the pipelines write to `ingest_anomalies` and
the web app surfaces them at [`/data-quality`](http://localhost:5173/#/data-quality).

Common anomaly kinds:

- **`player-stat-line`** — a stat line that didn't attach to any game (e.g.
  orphan `FO – 14/18` continuation we couldn't merge into the previous game).
- **`score-line`** — a scoreboard line we couldn't pin to two known teams or
  a sane score format.
- **`rankings`** — rankings post we recognised but couldn't fully parse
  (e.g. NXT format).
- **`categorize`** — a post we couldn't route to a pipeline at all.

## Known gaps / backlog

- **NXT-format rankings** parser (a second weekly rankings post style with a
  different layout — currently filed as anomalies).
- **`Saves for <team>` aggregated form** — sometimes mis-read as a score
  line; needs a dedicated catalogue entry.
- **Orphan FO continuation merge** — `FO – X/Y` lines that appear after a
  paragraph break sometimes can't be matched back to their parent game.
- Top scorers + per-game trend charts only consider games already ingested;
  re-run `pnpm ingest` after a fresh `pnpm crawl` to refresh.

## Logging

Server and ingest packages emit structured logs through a shared Pino-based
logger (`packages/shared/src/logger.ts`). Set `LOG_LEVEL` to one of
`fatal | error | warn | info | debug | trace | silent` to control verbosity:

```bash
LOG_LEVEL=warn pnpm --filter @pll/ingest dedup:players  # quiet
LOG_LEVEL=debug pnpm dev                                # verbose request logs
```

Output is human-readable (`pino-pretty`) when stdout is a TTY and JSON
otherwise (CI, container runs). The `web` package is exempt and continues
to use `console.*` for browser dev-tools ergonomics. See
`docs/improvements/07-centralized-logger-rollout.md` for the full RFC and
`scripts/lint-no-console.sh` for the regression guard.
