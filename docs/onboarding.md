# Onboarding Guide

> **Quick-start for agents joining this repo cold.**  
> **Token cost:** ~1,800 tokens  
> **For specific info, load quick-refs instead:** [commands](./quick-refs/commands.md) | [db-schema](./quick-refs/db-schema.md) | [api-endpoints](./quick-refs/api-endpoints.md) | [data-sources](./quick-refs/data-sources.md)

---

## Project at a Glance

TypeScript pnpm monorepo that scrapes, parses, and visualizes Philadelphia high-school boys lacrosse data from **phillylacrosse.com** (RSS scoreboards & summaries), **piaad1.org** (official PIAA District 1 rankings), **phillylaxnumbers.com** (LaxNumbers — per-game player stats), and **maxpreps.com** (team logos). Four workspace packages handle ingestion, an HTTP API, shared types, and a D3-based web client.

The site is deployed via:
- **Azure Container App** — single Fastify container (`pll-server`) at `https://phillylaxstats.com`. Serves the Vite SPA, all `/api/*` routes, and `/logos/*` static files. DB baked into the image (`/tmp/lacrosse.db`) and refreshed nightly from Azure Files. `min-replicas=1` (always-on, no cold starts).

---

## Package Map

| Package | Path | Role | Key entry files |
|---|---|---|---|
| `@pll/ingest` | `packages/ingest/` | Scrapers, parsers, pipelines, migrations, CLI/scripts that write to SQLite | `src/cli/crawl.ts`, `src/cli/ingest.ts`, `src/scripts/syncLogos.ts`, `src/scripts/syncHudl.ts`, `src/db.ts`, `src/parsers/index.ts` |
| `@pll/server` | `packages/server/` | Fastify HTTP API + static logo serving | `src/index.ts`, `src/app.ts`, `src/routes/`, `src/queries/`, `src/plugins/responseCache.ts` |
| `@pll/shared` | `packages/shared/` | Single source of truth for shared TS types (`Team`, `Game`, `Player`, etc.) | `src/index.ts` |
| `@pll/web` | `packages/web/` | Vite + D3 client (charts, views, simple router) | `src/main.ts`, `src/router.ts`, `src/api.ts`, `src/views/`, `src/charts/` |

---

## Quick Commands

📖 **Full command reference:** [quick-refs/commands.md](./quick-refs/commands.md)

```bash
# Install & dev
pnpm install
pnpm dev                # server :3001 + web :5173

# Ingest pipeline
pnpm crawl              # RSS → data/raw-cache/
pnpm ingest             # parse → data/lacrosse.db

# Azure sync (after local DB changes)
pnpm db:upload          # push to Azure File Share

# Test & build
pnpm typecheck
pnpm test
pnpm build
```

**Important:** After running any local-only script (workbook imports, dedup, manual corrections), you must run `pnpm db:upload` to make changes visible on the live site. The nightly CI workflow syncs automatically, but ad-hoc local imports require this manual step.

---

## Database Conventions

📖 **Full schema reference:** [quick-refs/db-schema.md](./quick-refs/db-schema.md)

- **Live DB:** `data/lacrosse.db` (SQLite, `user_version = 23`).
- **Test DB:** `data/lacrosse.test.db` (auto-seeded by vitest setup). Tests must never touch the live DB.
- **Migrations:** `packages/ingest/src/migrations/NNN_*.sql`, applied by `user_version` pragma.

**Key tables:**
- `teams` — id, name, slug, logo_url (bare filename), maxpreps_slug
- `team_aliases` — alternate team names for matching during ingest
- `players` — id, name, team_id, jersey_number
- `player_stats` — per-game stats: goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken, source, upload_id
- `games` — id, date, home_team_id, away_team_id, home_score, away_score, source, laxnumbers_game_id
- `community_corrections` — status IN ('pending','approved','rejected','outlier'); nightly auto-applies non-outliers
- `ingest_anomalies` — unresolved ingest rows

**Logo URLs:** `teams.logo_url` stores the BARE FILENAME (e.g. `harriton.gif`). The server prefixes `/logos/` when emitting to clients. Do not store full paths.

**Backups before destructive scripts:**
```bash
cp data/lacrosse.db data/lacrosse.db.bak-<context>
```

---

## Hard Rules (Non-Negotiable)

1. **ASCII-only in HTTP-bound text and runnable code blocks.** Em-dash `—`, middle-dot `·`, and multiplication `×` break undici headers. Use `-`, `*`, `x` in any string sent over HTTP. Markdown prose is fine for unicode.
2. **No `pkill` / `killall`** (env policy). Use `kill <PID>` or `lsof -ti:PORT | xargs kill`.
3. **Don't delete files outside your scope.**
4. **No secrets in code or committed config.**
5. **Don't read `.env` files** (project policy).
6. **Stay in your lane.** Lane assignments are in the current wave plan in `docs/`.
7. **Logo files are `.gif` not `.png`.** MaxPreps serves .gif logos. Storing as `.png` will break display.
8. **After any local-only DB mutation, run `pnpm db:upload`.** The live site reads from the Azure-hosted DB. If you run a script that writes to `data/lacrosse.db` (workbook imports, dedup, manual corrections, migrations), you **must** sync to Azure with `pnpm db:upload` or the changes will not appear on the live site. The nightly CI handles RSS-sourced data automatically, but ad-hoc local scripts do not sync themselves.
9. **Azure mutations require the `AZURE_CREDENTIALS` service principal** via the `update-azure-config.yml` workflow. Local `az` CLI (`dvoyles@microsoft.com`) lacks Container App write permissions.

---

## Runtime Logs & Dev Servers

- **Logs:**
  - `.runtime-logs/server.log`
  - `.runtime-logs/web.log`
- **Server:** http://localhost:3001 (Fastify, `@pll/server`)
- **Web:** http://localhost:5173 (Vite, `@pll/web`)
- Static logos served at `/logos/*` from `data/logos/` with 1y immutable cache
- Coach tooling routes include `#/coach/dashboard` (coverage, trends, scouting, practice-focus analytics) and `#/coach/upload` (spreadsheet import)
- Selected read-only `GET /api/*` routes opt into `packages/server/src/plugins/responseCache.ts` via the exported `cacheable` route option. The plugin keeps a 60s in-memory LRU cache, emits `ETag`, `Cache-Control`, and `x-cache` headers, keys entries by `request.url`, and skips requests with `Authorization` headers.

---

## Where Things Live (Quick Map)

| Area | Path |
|---|---|
| HTTP scrapers (sources) | `packages/ingest/src/sources/` |
| Parsers (HTML -> structured) | `packages/ingest/src/parsers/` |
| Pipelines (parsed -> DB) | `packages/ingest/src/pipelines/` |
| Migrations | `packages/ingest/src/migrations/` |
| CLI entrypoints | `packages/ingest/src/cli/` |
| One-off scripts | `packages/ingest/src/scripts/` |
| Server routes | `packages/server/src/routes/` |
| Server queries | `packages/server/src/queries/` |
| Web views | `packages/web/src/views/` |
| Dashboard view modules | `packages/web/src/views/dashboard/` |
| Web charts (D3) | `packages/web/src/charts/` |
| Web shared components | `packages/web/src/components/` |
| Web utilities | `packages/web/src/util/` |
| Static export data | `packages/web/public/data/` |
| Static SEO assets | `packages/web/public/robots.txt`, `packages/web/public/sitemap.xml` |
| Shared types | `packages/shared/src/index.ts` |
| Team overrides (MaxPreps slugs) | `data/team-overrides.json` |
| Logo assets | `data/logos/` |
| HTML fixtures | `fixtures/` (see `fixtures/README.md`) |
| Architecture + plans | `docs/` |
| PBLA system guide | `docs/pbla-guide.md` |
| CI/CD workflows | `.github/workflows/` |

**Key server routes** (all under `packages/server/src/routes/`):
`teams.ts`, `games.ts`, `players.ts`, `commitments.ts`, `schedule.ts`, `rankings.ts`, `laxnumbersRatings.ts`, `h2h.ts`, `coachDashboard.ts`, `corrections.ts`, `upload.ts`, `hudl.ts`, `search.ts`, `dataExport.ts`, `sources.ts`

**Key web views** (all under `packages/web/src/views/`):
`adminCorrections.ts`, `adminHudl.ts`, `coachDashboard.ts`, `coachUpload.ts`, `commitments.ts`, `compare.ts`, `constellation.ts`, `dashboard.ts`, `dataQuality.ts`, `gameDetail.ts`, `h2h.ts`, `leaders.ts`, `pbla.ts`, `pblaData.ts`, `pblaTeam.ts`, `playerCompare.ts`, `playerDetail.ts`, `ratings.ts`, `sources.ts`, `status.ts`, `teamDetail.ts`, `topTeams.ts`

**Key CI workflows** (all under `.github/workflows/`):
- `ingest-nightly.yml` — crawl + parse + ingest + applyCorrections + restart ACA
- `deploy.yml` — build server image (includes web bundle), push to GHCR, deploy to ACA (triggered on push to main)
- `sync-logos.yml` — weekly Sunday logo sync from MaxPreps
- `sync-pbla.yml` — Tue/Thu 6AM ET: scrape PBLA data from Sportability, upload DB, trigger Pages rebuild
- `update-azure-config.yml` — ops tool: updates CORS_ORIGINS / env vars on Azure Container App

---

## Source Data Attribution

📖 **Full source details:** [quick-refs/data-sources.md](./quick-refs/data-sources.md)

- **phillylacrosse.com** — RSS feed: scoreboards + game summaries. Primary source for all game scores.
- **piaad1.org** — official PIAA District 1 standings & rankings.
- **phillylaxnumbers.com (LaxNumbers)** — per-game player stats (goals, assists, etc.) scraped by game ID match.
- **hudl.com** — authenticated coach-account scraper scaffold for roster + per-game stats.
- **maxpreps.com** — team logos. Required footer attribution on the web client: *"Team logos courtesy of MaxPreps.com"*.
- **secure.sportability.com** — PBLA league data: standings, schedule, player/goalie stats. League IDs: 2026=50731, 2025=50247.
- **youtube.com/@PBLA_Official** — PBLA livestream videos. Channel ID: `UC8dQQ4Z-MjxCCBu380ViuEg`.

---

## Conventions for Sub-Agents

- Read the most recent file in `docs/` first when joining mid-project.
- Track work via SQL todos. Status values: `pending` / `in_progress` / `done` / `blocked`. Update as you progress.
- Follow the communication-log format in the current wave plan. Lead with a status emoji, max ~3 lines per entry.
- Common emoji markers: ✅ done · 🔍 recon · 📋 plan · 🎯 target · ⚠️ warning · 🔧 fix.
- When adding a new parser, put it under `packages/ingest/src/parsers/` and register in `parsers/index.ts`. Co-located tests go in `parsers/__tests__/`.
- When adding a new HTML fixture, drop it in `fixtures/` and update `fixtures/README.md`.
- When adding a new web view, register it in `packages/web/src/router.ts`.
- When adding a new server route, register it in `packages/server/src/app.ts`.
- Don't touch other agents' files. If unsure, check the lane table in the current wave plan.

### Doc Sync (Mandatory — Same Commit as Code)

**Whenever you add or change any of the following, update `docs/onboarding.md` and relevant quick-refs in the same commit:**

| What changed | Update target |
|---|---|
| New migration | `quick-refs/db-schema.md` migrations list + DB user_version |
| New DB table or column | `quick-refs/db-schema.md` key tables |
| New script in `src/scripts/` | `quick-refs/commands.md` |
| New server route | This file (§7 key server routes) + `quick-refs/api-endpoints.md` |
| New web view | This file (§7 key web views) |
| New CI workflow | This file (§7 key CI workflows) |
| New data source | `quick-refs/data-sources.md` |
| New architectural pattern | `architecture-full.md` |

Stale docs cause agents to work from false assumptions and introduce bugs. This is not optional.

---

## Community Corrections

Readers can submit corrections via ✏️ buttons on `playerDetail` and `gameDetail`. Data flow:

1. Browser: `correctionModal.ts` component POSTs to `${VITE_API_BASE_URL}/api/corrections`.
2. Server: `packages/server/src/routes/corrections.ts` validates, detects outliers, stores in `community_corrections`.
3. Nightly CI: `applyCorrections.ts --db=$DB_PATH` auto-approves non-outliers, marks outliers as 'outlier' (not applied).
4. Admin view: `#/admin/corrections` (`adminCorrections.ts`) shows flagged outliers + recent approvals.

**Outlier bounds** (corrections outside these are flagged, not auto-applied):

| Field | Hard cap | Ratio guard |
|-------|----------|-------------|
| goals / assists | 15 | proposed/current > 5 |
| ground_balls | 30 | — |
| caused_turnovers | 20 | — |
| saves | 40 | — |
| fo_won | 40 | — |
| fo_taken | 50 | — |
| home_score / away_score | 30 | proposed/current > 10 |

---

## Common Mistakes (Avoid These)

These are pitfalls that have bitten agents and contributors multiple times:

| Mistake | Why it fails | Correct approach |
|---------|-------------|-----------------|
| Import data locally without `pnpm db:upload` | Azure DB (used by live site) still has old data | Always run `pnpm db:upload` after any local DB mutation |
| Store logo files as `.png` | MaxPreps serves `.gif`; mismatch breaks display | Use `.gif` extension for all logo files |
| Use unicode characters in HTTP-bound strings | Em-dashes, smart quotes break undici headers | Use ASCII-only: `-` not `—`, `'` not curly quotes |
| Open the DB writably during another agent's wave | SQLite WAL conflicts can corrupt data | Use read-only `sqlite3` queries when another agent is active |

See `docs/runbooks/` for detailed step-by-step guides.

---

**For deeper understanding:** [architecture-full.md](./architecture-full.md)
