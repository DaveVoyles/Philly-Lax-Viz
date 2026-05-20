# Philly Lacrosse Viz — Docs Hub

> Cold-start entrypoint for agents and contributors. Read this first.
> For repo-wide onboarding (commands, DB schema, conventions), see `AGENTS.md` at the repo root.

### Doc responsibilities

| Doc | Owns | Read when |
|-----|------|-----------|
| `AGENTS.md` (repo root) | Quick-start: commands, hard rules, conventions, key file map | Always — first thing to read |
| `docs/architecture.md` | Deep architecture: data flow, all sources, full DB schema, API inventory, ADRs | Understanding internals |
| `docs/pipeline-gaps.md` | Actionable backlog of missing CI steps and static export gaps | Planning ingest improvements |
| `docs/improvements/` | RFC proposals for future work | Choosing next project |
| `docs/runbooks/` | Step-by-step guides for specific operations | Deploying, importing data, Hudl onboarding |
| `docs/archive/` | Historical wave plans and session artifacts | Archaeology only |

When both `AGENTS.md` and `architecture.md` cover the same topic, `AGENTS.md` is authoritative for conventions and commands; `architecture.md` is authoritative for system design and data flow.

---

## Reading Order

Start here when joining the project cold:

| Step | Doc | Why |
|------|-----|-----|
| 1 | [architecture.md](./architecture.md) | System map, data flow, package layout, API inventory, static export coverage |
| 2 | [azure-deployment.md](./azure-deployment.md) | How the stack is deployed; cost model; known pitfalls from live runs |
| 3 | [pipeline-gaps.md](./pipeline-gaps.md) | What the nightly pipeline does NOT do yet; actionable fix snippets |
| 4 | [runbooks/source-priority.md](./runbooks/source-priority.md) | Trust hierarchy across data sources; when to invoke each one |
| 5 | [runbooks/deploy-to-pages.md](./runbooks/deploy-to-pages.md) | How to deploy code and data changes to the live site |
| 6 | [runbooks/local-data-import.md](./runbooks/local-data-import.md) | Importing external data (spreadsheets, corrections) safely |
| 7 | [runbooks/correction-workflow.md](./runbooks/correction-workflow.md) | Community corrections lifecycle: submission, outlier detection, auto-approval |
| 8 | [runbooks/hudl-invitation-flow.md](./runbooks/hudl-invitation-flow.md) | Invite the service account to a Hudl team and register it in admin UI |
| 9 | [improvements/00-INDEX.md](./improvements/00-INDEX.md) | Prioritized RFC backlog; choose your next wave from here |
| 10 | [level-up.md](./level-up.md) | Long-term product roadmap: domain, coach uploads, PBLA, Hudl expansion |

---

## System Map (one-minute version)

```
External Sources
  |- phillylacrosse.com (RSS)   game scores + summaries
  |- piaad1.org  (HTML/CSV)     district rankings + schedule
  |- maxpreps.com (HTML)        team logos
  +- laxnumbers.com (API)       PA-wide supplementary stats

          | crawl.ts / syncPiaa.ts / syncLogos.ts
         v
  data/lacrosse.db  (SQLite, 4 packages as monorepo)

         | ingest-nightly.yml (GitHub Actions)
         v
  Azure File Share          live DB storage

         | deploy.yml (push to main)
         v
  Azure Static Web App      phillylaxstats.com (Vite SPA)
  Azure Container App  <->  Fastify API (api.phillylaxstats.com)
```

Single deployment target — Azure SWA serves the web client, ACA serves the API:

| Component | URL | Data source |
|-----------|-----|-------------|
| Web (SPA) | `https://www.phillylaxstats.com` | Live API calls |
| API | `https://api.phillylaxstats.com` | SQLite on Azure File Share |

**After local-only data changes** (workbook imports, manual corrections, dedup): run `pnpm db:upload` to sync the local DB to Azure File Share. The nightly CI handles this automatically for RSS-sourced data, but ad-hoc local scripts require this manual sync step.

---

## What Each Doc Covers

### [architecture.md](./architecture.md)
Full architecture reference. Covers package map (`@pll/ingest`, `@pll/server`, `@pll/shared`, `@pll/web`),
all data sources, DB schema overview, ingest pipeline stages, nightly CI workflow, static export coverage
map, API endpoint inventory, key architectural decisions, and known tech debt.

**When to use:** Any time you need to understand how data moves from source to screen, or where a
specific piece of logic lives.

---

### [azure-deployment.md](./azure-deployment.md)
Deployment guide and cost model. Covers Azure Static Web Apps + Container Apps + ACR setup, known
pitfalls from live v3 deployment (SQLite on SMB, SWA region restrictions, CI billing limits), and the
local fallback path when GitHub Actions billing is blocked.

**When to use:** When deploying, updating infrastructure, debugging production issues, or estimating costs.

---

### [pipeline-gaps.md](./pipeline-gaps.md)
Actionable gap list from Wave 0 audit. Covers nightly pipeline steps that are missing or unwired
(rankings crawl, logo sync, dedup automation, `applyCorrections` scheduling, LaxNumbers reconciliation),
each with a ready-to-use fix snippet.

**When to use:** Before wiring a new ingest step or when investigating why data is stale.

---

### [runbooks/source-priority.md](./runbooks/source-priority.md)
Trust hierarchy runbook. Defines which source wins when data sources disagree (PIAA > MaxPreps > PhillyLacrosse
for team records; MaxPreps > PhillyLacrosse for per-game scores; PhillyLacrosse only for per-player stats).
Includes commands to invoke each source for on-demand reconciliation.

**When to use:** Whenever two sources disagree on a score or record, or before touching reconciliation logic.

---

### [runbooks/deploy-to-pages.md](./runbooks/deploy-to-pages.md)
Step-by-step deploy guide. Covers why push-to-main does NOT auto-deploy, how to trigger the Pages workflow
manually, how to deploy data-only changes via `pnpm db:deploy`, and troubleshooting common deploy failures.

**When to use:** After any push to main, after local data imports, or when the live site is stale.

---

### [runbooks/local-data-import.md](./runbooks/local-data-import.md)
Runbook for importing external data (spreadsheets, manual corrections, dedup operations) into the local DB
and syncing to the live site. Covers the standard backup-import-verify-deploy workflow and common mistakes.

**When to use:** Whenever running a script that writes to `data/lacrosse.db` from an external source.

---

### [improvements/00-INDEX.md](./improvements/00-INDEX.md)
Prioritized RFC backlog (10 proposals). Covers data quality, performance, visualizations, tech debt,
and DevOps improvements — each with effort/risk rating and a recommended wave sequence.

**When to use:** Choosing the next piece of work. Ranked by `Impact x Urgency - Effort - Risk`.

---

## Session and Wave Artifacts

Wave-specific plans and analysis are archived in `docs/archive/` (repo-level plans) and formerly in `.github/docs/` (now moved to `docs/archive/` as well). All date-prefixed files are historical records.

These are historical records. Current work should reference running plans only, not these archives.

---

## Quick Reference

```bash
# Typecheck, test, build everything
pnpm typecheck && pnpm test && pnpm build

# Full ingest pipeline
pnpm crawl && pnpm ingest

# Static export (generates public/data/ for GitHub Pages)
pnpm --filter @pll/web export:static

# On-demand source reconciliation
pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts
pnpm --filter @pll/ingest reconcile:scores --dry-run
```

For the full command reference, see `AGENTS.md` section 3.
