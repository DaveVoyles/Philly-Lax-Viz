# AGENTS.md

Onboarding for sub-agents joining this repo cold. Read this first; you should be productive in < 2 minutes.

## 1. Project at a glance

TypeScript pnpm monorepo that scrapes, parses, and visualizes Philadelphia high-school boys lacrosse data from **phillylacrosse.com** (RSS scoreboards & summaries), **piaad1.org** (official PIAA District 1 rankings), **phillylaxnumbers.com** (LaxNumbers — per-game player stats), and **maxpreps.com** (team logos). Four workspace packages handle ingestion, an HTTP API, shared types, and a D3-based web client.

The site is deployed two ways:
- **GitHub Pages** (`IS_STATIC=true`) — static HTML/JS with pre-exported JSON snapshots in `packages/web/public/data/`. No live API. Graceful fallback for API-only views.
- **Azure Container App** — live Fastify API at `https://pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`. DB stored in Azure Files, mounted at `/data/`.

## 2. Package map

| Package | Path | Role | Key entry files |
|---|---|---|---|
| `@pll/ingest` | `packages/ingest/` | Scrapers, parsers, pipelines, migrations, CLI/scripts that write to SQLite | `src/cli/crawl.ts`, `src/cli/ingest.ts`, `src/scripts/syncLogos.ts`, `src/db.ts`, `src/parsers/index.ts` |
| `@pll/server` | `packages/server/` | Fastify HTTP API + static logo serving | `src/index.ts`, `src/app.ts`, `src/routes/`, `src/queries/` |
| `@pll/shared` | `packages/shared/` | Single source of truth for shared TS types (`Team`, `Game`, `Player`, etc.) | `src/index.ts` |
| `@pll/web` | `packages/web/` | Vite + D3 client (charts, views, simple router) | `src/main.ts`, `src/router.ts`, `src/api.ts`, `src/views/`, `src/charts/` |

## 3. Common commands

All run from repo root unless noted. Use `pnpm --filter @pll/<name> <script>` to scope to one package.

```bash
# install (uses pnpm@10.33.1 per packageManager pin)
pnpm install

# typecheck / test / build everything
pnpm typecheck
pnpm test
pnpm build

# dev: server on :3001 + web on :5173, color-tagged
pnpm dev

# ingest pipeline (RSS crawl -> parse -> write DB)
pnpm crawl
pnpm ingest

# refresh team logos from MaxPreps into data/logos/
pnpm --filter @pll/ingest sync:logos

# per-package examples
pnpm --filter @pll/ingest test
pnpm --filter @pll/server dev
pnpm --filter @pll/web build

# static export (generates packages/web/public/data/ for GitHub Pages build)
pnpm --filter @pll/web export:static
pnpm --filter @pll/web validate:export
```

Other ingest scripts (run via tsx, no root alias):

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts            # sync PIAA standings
pnpm --filter @pll/ingest exec tsx src/scripts/dedupTeams.ts           # interactive team dedup
pnpm --filter @pll/ingest exec tsx src/scripts/applyCorrections.ts --db=data/lacrosse.db   # apply pending community corrections
pnpm --filter @pll/ingest exec tsx src/scripts/applyCorrections.ts --db=data/lacrosse.db --dry-run
pnpm --filter @pll/ingest exec tsx src/scripts/seedAliasesFromAnomalies.ts   # auto-seed team aliases from anomalies
pnpm --filter @pll/ingest exec tsx src/scripts/emitLaxNumbersAliasCsv.ts     # emit CSV of unknown LaxNumbers teams
pnpm --filter @pll/ingest exec tsx src/scripts/dedupPlayers.ts         # interactive player dedup
pnpm --filter @pll/ingest exec tsx src/scripts/applyHarritonWorkbook.ts --workbook='/Users/.../HHS Lax 2026.xlsx' --db=data/lacrosse.db
pnpm --filter @pll/ingest exec tsx src/scripts/applyHarritonWorkbook.ts --workbook='/Users/.../HHS Lax 2026.xlsx' --db=data/lacrosse.db --apply
```

Azure DB sync (after any local-only ingestion):

```bash
pnpm db:upload                  # upload local DB to Azure File Share
pnpm db:deploy                  # upload + trigger GitHub Pages redeploy
./scripts/db-upload.sh --deploy # equivalent shell invocation
```

**Important:** After running any local-only script (workbook imports, dedup, manual corrections), you must run `pnpm db:deploy` to make changes visible on the live GitHub Pages site. The nightly CI workflow syncs automatically, but ad-hoc local imports require this manual step.

## 4. Database conventions

- **Live DB:** `data/lacrosse.db` (SQLite, `user_version = 16`).
- **Test DB:** `data/lacrosse.test.db` (auto-seeded by vitest setup). Tests must never touch the live DB.
- **Migrations:** `packages/ingest/src/migrations/NNN_*.sql`, applied by `user_version` pragma. All 16 migrations:
  - `001_init.sql` — core tables: teams, games, game_periods, players, player_stats, rankings, ingest_anomalies, raw_cache_meta
  - `002_ingest_post_log.sql` — ingest_post_log
  - `003_piaa_official_teams.sql` — piaa_official_teams
  - `004_team_logos.sql` — teams.logo_url, teams.maxpreps_slug
  - `005_community_corrections.sql` — community_corrections (submitter info, entity, field, old/new value, status)
  - `005_player_aliases.sql` — player_aliases; `006_seasons.sql` — seasons; `007_commits.sql` → `011_drop_commits.sql`
  - `008_schedule.sql` — schedule; `009_team_branding.sql` — team_branding; `010_post_images.sql` — post_images
  - `012_laxnumbers_provenance.sql` — LaxNumbers game provenance tracking
  - `013_score_sources.sql` — score source authority tracking
  - `014_team_alias_notes.sql` — team_aliases.notes column
  - `015_dedup_candidates.sql` — dedup_candidates
  - `016_player_jersey_number.sql` — players.jersey_number

- **Key tables for agents:**
  - `teams` — id, name, slug, logo_url (bare filename), maxpreps_slug
  - `team_aliases` — id, alias, team_id, source, confidence, notes (used to match alternate team names during ingest)
  - `players` — id, name, team_id, jersey_number
  - `player_stats` — per-game stats: goals, assists, ground_balls, caused_turnovers, saves, fo_won, fo_taken
  - `community_corrections` — status IN ('pending','approved','rejected','outlier'); nightly `applyCorrections.ts` auto-applies non-outliers
  - `ingest_anomalies` — unresolved ingest rows; source, raw_line, reason

- **Logo URLs:** `teams.logo_url` stores the BARE FILENAME (e.g. `harriton.gif`). The server prefixes `/logos/` when emitting to clients. Do not store full paths.
- **Backups before destructive scripts:**
  ```bash
  cp data/lacrosse.db data/lacrosse.db.bak-<context>
  ```
- **Read-only audits only when another agent is mid-wave.** Use:
  ```bash
  sqlite3 data/lacrosse.db ".mode column" "SELECT ..."
  ```
  Don't open the DB writably during another agent's wave.

## 5. Hard rules (non-negotiable)

- **ASCII-only in HTTP-bound text and runnable code blocks.** Em-dash `—`, middle-dot `·`, and multiplication `×` break undici headers. Use `-`, `*`, `x` in any string sent over HTTP. Markdown prose is fine for unicode.
- **No `pkill` / `killall`** (env policy). Use `kill <PID>` or `lsof -ti:PORT | xargs kill`.
- **Don't delete files outside your scope.**
- **No secrets in code or committed config.**
- **Don't read `.env` files** (project policy).
- **Stay in your lane.** Lane assignments are in the current wave plan in `docs/`.
- **Logo files are `.gif` not `.png`.** MaxPreps serves .gif logos. Storing as `.png` will break display.
- **Every new web view must handle IS_STATIC mode.** See §10 below — blank pages on GitHub Pages are the symptom of missing guards.
- **After any local-only DB mutation, run `pnpm db:deploy`.** The live GitHub Pages site exports from the Azure DB, not the local one. If you run a script that writes to `data/lacrosse.db` (workbook imports, dedup, manual corrections, migrations), you **must** sync to Azure with `pnpm db:deploy` or the changes will not appear on the live site. The nightly CI handles RSS-sourced data automatically, but ad-hoc local scripts do not sync themselves.
- **Azure mutations require the `AZURE_CREDENTIALS` service principal** via the `update-azure-config.yml` workflow. Local `az` CLI (`dvoyles@microsoft.com`) lacks Container App write permissions.

## 6. Runtime logs & dev servers

- Logs:
  - `.runtime-logs/server.log`
  - `.runtime-logs/web.log`
- **Server:** http://localhost:3001 (Fastify, `@pll/server`).
- **Web:** http://localhost:5173 (Vite, `@pll/web`).
- Static logos served at `/logos/*` from `data/logos/` with 1y immutable cache.

## 7. Where things live (quick map)

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
| Web charts (D3) | `packages/web/src/charts/` |
| Web shared components | `packages/web/src/components/` |
| Web utilities | `packages/web/src/util/` |
| Static export data | `packages/web/public/data/` |
| Shared types | `packages/shared/src/index.ts` |
| Team overrides (MaxPreps slugs) | `data/team-overrides.json` |
| Logo assets | `data/logos/` |
| HTML fixtures | `fixtures/` (see `fixtures/README.md`) |
| Architecture + plans | `docs/` |
| CI/CD workflows | `.github/workflows/` |

**Key server routes** (all under `packages/server/src/routes/`):
`teams.ts`, `games.ts`, `players.ts`, `schedule.ts`, `rankings.ts`, `h2h.ts`, `corrections.ts`, `search.ts`, `dataExport.ts`, `sources.ts`

**Key web views** (all under `packages/web/src/views/`):
`dashboard.ts`, `teamDetail.ts`, `gameDetail.ts`, `playerDetail.ts`, `leaders.ts`, `schedule.ts`, `compare.ts`, `h2h.ts`, `playerCompare.ts`, `constellation.ts`, `dataQuality.ts`, `sources.ts`, `adminCorrections.ts`

**Key CI workflows** (all under `.github/workflows/`):
- `ingest-nightly.yml` — crawl + parse + ingest + applyCorrections + export static + deploy
- `pages.yml` — GitHub Pages deploy (triggered by ingest-nightly or manual)
- `sync-logos.yml` — weekly Sunday logo sync from MaxPreps
- `update-azure-config.yml` — ops tool: updates CORS_ORIGINS / env vars on Azure Container App

## 8. Source data attribution

- **phillylacrosse.com** — RSS feed: scoreboards + game summaries. Primary source for all game scores.
- **piaad1.org** — official PIAA District 1 standings & rankings.
- **phillylaxnumbers.com (LaxNumbers)** — per-game player stats (goals, assists, etc.) scraped by game ID match. Required team alias resolution via `team_aliases` table before stats are usable.
- **maxpreps.com** — team logos. Required footer attribution on the web client: *"Team logos courtesy of MaxPreps.com"*.

## 9. Conventions for sub-agents

- Read the most recent file in `docs/` first when joining mid-project.
- Track work via SQL todos. Status values: `pending` / `in_progress` / `done` / `blocked`. Update as you progress.
- Follow the communication-log format in the current wave plan. Lead with a status emoji, max ~3 lines per entry.
- Common emoji markers: ✅ done · 🔍 recon · 📋 plan · 🎯 target · ⚠️ warning · 🔧 fix.
- When adding a new parser, put it under `packages/ingest/src/parsers/` and register in `parsers/index.ts`. Co-located tests go in `parsers/__tests__/`.
- When adding a new HTML fixture, drop it in `fixtures/` and update `fixtures/README.md`.
- When adding a new web view, register it in `packages/web/src/router.ts` and apply the IS_STATIC guard (§10).
- When adding a new server route, register it in `packages/server/src/app.ts`.
- Don't touch other agents' files. If unsure, check the lane table in the current wave plan.

### Doc sync (mandatory — same commit as code)

**Whenever you add or change any of the following, update `AGENTS.md` and `README.md` in the same commit:**

| What changed | Update target |
|---|---|
| New migration | §4 migrations list + DB user_version |
| New DB table or column | §4 key tables |
| New script in `src/scripts/` | §3 commands list |
| New server route | §7 key server routes |
| New web view | §7 key web views |
| New CI workflow | §7 key CI workflows |
| New data source | §8 source data attribution |
| New architectural pattern | Add or update the relevant section |
| README feature list / API list | README only |

Stale docs cause agents to work from false assumptions and introduce bugs. This is not optional.

## 10. IS_STATIC mode — GitHub Pages

The GitHub Pages build sets `VITE_STATIC_MODE=true`. In this mode:
- **No live API calls.** All data comes from pre-exported JSON files in `packages/web/public/data/`.
- **`staticLoader.ts`** defines `IS_STATIC`, `staticFetch()`, and `staticUnavailableNode()`.
- Every view **must** guard API-only behavior with `IS_STATIC`.

**Pattern for any view with live API calls:**

```typescript
import { IS_STATIC, staticFetch, staticUnavailableNode } from '../staticLoader';

async function loadData() {
  if (IS_STATIC) {
    // Use staticFetch('/data/snapshot.json') or staticUnavailableNode('Feature name')
    return staticFetch<MyType[]>('/data/my-snapshot.json');
  }
  // Live API call
  return api.getLiveData();
}
```

- If a feature is simply unavailable in static mode, render `staticUnavailableNode('Feature name')` instead of a blank screen.
- Static JSON exports are generated by the `export:static` script (runs in nightly CI before Pages deploy).
- **Symptom of missing guard:** page appears blank on the live GitHub Pages site but works fine locally.

## 11. Community corrections

Readers can submit corrections via ✏️ buttons on `playerDetail` and `gameDetail`. Data flow:

1. Browser: `correctionModal.ts` component POSTs to `${VITE_API_URL}/api/corrections` (bypasses IS_STATIC — always hits Azure).
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

**Correctable entity types:** `player_stat`, `game`, `player` (name + jersey_number).

## 12. Common mistakes (avoid these)

These are pitfalls that have bitten agents and contributors multiple times:

| Mistake | Why it fails | Correct approach |
|---------|-------------|-----------------|
| Push to `main` and assume site updates | `pages.yml` only triggers on `workflow_dispatch` or `ingest-nightly` completion | Run `gh workflow run pages.yml --ref main` after push |
| Import data locally without `pnpm db:deploy` | Azure DB (used by Pages export) still has old data | Always run `pnpm db:deploy` after any local DB mutation |
| Store logo files as `.png` | MaxPreps serves `.gif`; mismatch breaks display | Use `.gif` extension for all logo files |
| Use unicode characters in HTTP-bound strings | Em-dashes, smart quotes break undici headers | Use ASCII-only: `-` not `--`, `'` not curly quotes |
| Add a new view without IS_STATIC guard | Page renders blank on GitHub Pages | Always add `staticFetch` or `staticUnavailableNode` fallback |
| Assume `packages/web/public/data/` is committed | It is gitignored; generated at deploy time | Don't manually edit static exports; they are rebuilt from Azure DB |
| Open the DB writably during another agent's wave | SQLite WAL conflicts can corrupt data | Use read-only `sqlite3` queries when another agent is active |
| Upload DB to Azure and immediately trigger Pages | Race condition: workflow may download pre-upload version | Wait a few seconds after upload completes before dispatching |

See `docs/runbooks/` for detailed step-by-step guides.
