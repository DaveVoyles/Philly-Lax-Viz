# Philly Lacrosse Viz — Docs Hub

> Cold-start entrypoint for agents and contributors. Read this first.
> For repo-wide onboarding (commands, DB schema, conventions), see `AGENTS.md` at the repo root.

---

## Reading Order

Start here when joining the project cold:

| Step | Doc | Why |
|------|-----|-----|
| 1 | [architecture.md](./architecture.md) | System map, data flow, package layout, API inventory, static export coverage |
| 2 | [azure-deployment.md](./azure-deployment.md) | How the stack is deployed; cost model; known pitfalls from live runs |
| 3 | [pipeline-gaps.md](./pipeline-gaps.md) | What the nightly pipeline does NOT do yet; actionable fix snippets |
| 4 | [runbooks/source-priority.md](./runbooks/source-priority.md) | Trust hierarchy across data sources; when to invoke each one |
| 5 | [improvements/00-INDEX.md](./improvements/00-INDEX.md) | Prioritized RFC backlog; choose your next wave from here |

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
  Azure Container App  <->  Fastify API (/api/*)
  Azure File Share          live DB storage

         | pages.yml + exportStatic.ts
         v
  packages/web/public/data/**/*.json  ->  GitHub Pages (static SPA)
```

Two deployment targets:

| Target | Data source | Live API |
|--------|-------------|----------|
| GitHub Pages (primary, user-facing) | Pre-built JSON snapshots | No — `staticLoader.ts` |
| Azure Container App (admin/dev) | Live SQLite via Fastify | Yes |

**After local-only data changes** (workbook imports, manual corrections, dedup): run `pnpm db:deploy` to upload the local DB to Azure and trigger a Pages redeploy. The nightly CI handles this automatically for RSS-sourced data, but ad-hoc local scripts require this manual sync step.

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

### [improvements/00-INDEX.md](./improvements/00-INDEX.md)
Prioritized RFC backlog (10 proposals). Covers data quality, performance, visualizations, tech debt,
and DevOps improvements — each with effort/risk rating and a recommended wave sequence.

**When to use:** Choosing the next piece of work. Ranked by `Impact x Urgency - Effort - Risk`.

---

## Session and Wave Artifacts

Wave-specific plans and analysis live alongside this file with date-prefixed names:

| File | Topic |
|------|-------|
| [2026-04-22-roadmap-data-azure-webgl.md](./2026-04-22-roadmap-data-azure-webgl.md) | Post-Wave-9 roadmap across 3 tracks |
| [2026-04-22-remaining-anomalies.md](./2026-04-22-remaining-anomalies.md) | Post-Wave-17 ingest anomaly status |
| [2026-04-22-wave16-lane2-schedule.md](./2026-04-22-wave16-lane2-schedule.md) | Wave 16 schedule scrape lane |
| [2026-04-22-wave3-logos-and-stat-leaders-analysis.md](./2026-04-22-wave3-logos-and-stat-leaders-analysis.md) | Wave 3 logos + stat leaders analysis |

These are historical records. Read the most recent one first when resuming a mid-project session.

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
