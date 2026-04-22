# AGENTS.md

Onboarding for sub-agents joining this repo cold. Read this first; you should be productive in < 2 minutes.

## 1. Project at a glance

TypeScript pnpm monorepo that scrapes, parses, and visualizes Philadelphia high-school boys lacrosse data from **phillylacrosse.com** (RSS scoreboards & summaries), **piaad1.org** (official PIAA District 1 rankings), and **maxpreps.com** (team logos). Four workspace packages handle ingestion, an HTTP API, shared types, and a D3-based web client.

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
```

Other ingest scripts (run via tsx, no root alias):

```bash
pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts
pnpm --filter @pll/ingest exec tsx src/scripts/dedupTeams.ts
```

## 4. Database conventions

- **Live DB:** `data/lacrosse.db` (SQLite, `user_version = 4`).
- **Test DB:** `data/lacrosse.test.db` (auto-seeded by vitest setup; see Wave 4 Lane 2). Tests must never touch the live DB.
- **Migrations:** `packages/ingest/src/migrations/NNN_*.sql`, applied by `user_version` pragma. Current migrations:
  - `001_init.sql`
  - `002_ingest_post_log.sql`
  - `003_piaa_official_teams.sql`
  - `004_team_logos.sql`
- **Logo URLs:** `teams.logo_url` stores the BARE FILENAME (e.g. `harriton.png`). The server prefixes `/logos/` when emitting to clients. Do not store full paths.
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

- **ASCII-only in HTTP-bound text and runnable code blocks.** Em-dash `—`, middle-dot `·`, and multiplication `×` break undici headers (Wave 2 lesson). Use `-`, `*`, `x` in any string sent over HTTP. Markdown prose is fine for unicode.
- **No `pkill` / `killall`** (env policy). Use `kill <PID>` or `lsof -ti:PORT | xargs kill`.
- **Don't delete files outside your scope**, even if they look like scratch (Wave 3 lesson: an agent nuked two untracked files at the repo root).
- **No secrets in code or committed config.**
- **Don't read `.env` files** (project policy).
- **Stay in your lane.** Lane assignments are in the current wave plan in `docs/`.

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
| Web views / charts | `packages/web/src/views/`, `packages/web/src/charts/` |
| Shared types | `packages/shared/src/index.ts` |
| HTML fixtures | `fixtures/` (see `fixtures/README.md`) |
| Plans / wave docs | `docs/` |

## 8. Source data attribution

- **phillylacrosse.com** — RSS feed: scoreboards + game summaries.
- **piaad1.org** — official PIAA District 1 standings & rankings.
- **maxpreps.com** — team logos. Required footer attribution on the web client: *"Team logos courtesy of MaxPreps.com"*.

## 9. Conventions for sub-agents

- Read the most recent file in `docs/` first when joining mid-project — wave plans contain hard-won lessons (sections like §10/§11/§12 + appendices).
- Track work via SQL todos. Status values: `pending` / `in_progress` / `done` / `blocked`. Update as you progress.
- Follow the communication-log format in the current wave plan. Lead with a status emoji, max ~3 lines per entry.
- Common emoji markers: ✅ done · 🔍 recon · 📋 plan · 🎯 target · ⚠️ warning · 🔧 fix.
- When adding a new parser, put it under `packages/ingest/src/parsers/` and register in `parsers/index.ts`. Co-located tests go in `parsers/__tests__/`.
- When adding a new HTML fixture, drop it in `fixtures/` and update `fixtures/README.md`.
- Don't touch other agents' files. If unsure, check the lane table in the current wave plan.
