# Philly Lacrosse Viz — Docs Hub

> **⚡ For agents:** Start with [index.md](./index.md) (~600 tokens) for token-efficient navigation  
> **For humans:** This README provides a comprehensive reading order and system overview

---

## Agent Quick-Start (Token-Optimized)

**Read this first:** [index.md](./index.md) — ultra-minimal decision tree with token costs

**Then load ONE quick-ref based on your task:**
- [commands.md](./quick-refs/commands.md) — CLI reference (~600 tokens)
- [db-schema.md](./quick-refs/db-schema.md) — DB tables (~900 tokens)
- [api-endpoints.md](./quick-refs/api-endpoints.md) — API inventory (~750 tokens)
- [data-sources.md](./quick-refs/data-sources.md) — Source summary (~600 tokens)

**Only load full docs when needed:**
- [onboarding.md](./onboarding.md) — Getting started (~1,800 tokens)
- [architecture-full.md](./architecture-full.md) — Deep architecture (~5,400 tokens)

**Token savings:** Quick-refs reduce baseline load from ~10,800 to ~1,800 tokens (83%).

---

## Doc Responsibilities (Human-Readable Guide)

## Doc Responsibilities (Human-Readable Guide)

| Doc | Owns | Read when |
|-----|------|-----------|
| `index.md` | Ultra-minimal agent index with decision tree | Always — first thing for agents |
| `quick-refs/commands.md` | All CLI commands, organized by category | Running scripts, dev servers, Azure sync |
| `quick-refs/db-schema.md` | Table schemas, columns, relationships | DB queries, understanding data model |
| `quick-refs/api-endpoints.md` | API paths, params, responses | Calling API, adding endpoints |
| `quick-refs/data-sources.md` | Source URLs, trust hierarchy, sync commands | Understanding data flow, reconciliation |
| `onboarding.md` | Quick-start: conventions, hard rules, key file map | First-time setup, learning conventions |
| `architecture-full.md` | Deep architecture: data flow, all sources, full DB schema, ADRs | Understanding internals, major changes |
| `pipeline-gaps.md` | Actionable backlog of missing CI steps | Planning ingest improvements |
| `improvements/` | RFC proposals for future work | Choosing next project |
| `runbooks/` | Step-by-step guides for specific operations | Deploying, importing data, Hudl onboarding |
| `archive/` | Historical wave plans and session artifacts | Archaeology only |

**Note:** `onboarding.md` replaces the old `AGENTS.md` content with redundancy removed. `AGENTS.md` at the repo root now symlinks to `docs/onboarding.md` for GitHub discoverability.

---

## Reading Order (by depth)

### 🚀 Quick Start (load first — ~1,800 tokens total)
1. [index.md](./index.md) — decision tree with token costs (~600 tokens)
2. One quick-ref based on your task:
   - [commands.md](./quick-refs/commands.md) — CLI reference (~600 tokens)
   - [db-schema.md](./quick-refs/db-schema.md) — DB tables (~900 tokens)
   - [api-endpoints.md](./quick-refs/api-endpoints.md) — API inventory (~750 tokens)
   - [data-sources.md](./quick-refs/data-sources.md) — Source summary (~600 tokens)

### 🧭 Intermediate (as needed)
3. [onboarding.md](./onboarding.md) — conventions, hard rules, common patterns (~1,800 tokens)
4. [azure-deployment.md](./azure-deployment.md) — deployment architecture (~1,200 tokens)
5. [runbooks/](./runbooks/) — operational guides (~varies)

### 🏗️ Deep Dive (rare — only when quick-refs insufficient)
6. [architecture-full.md](./architecture-full.md) — full system design (~5,400 tokens)
7. [pipeline-gaps.md](./pipeline-gaps.md) — known missing pieces (~800 tokens)
8. [improvements/00-INDEX.md](./improvements/00-INDEX.md) — future work (~800 tokens)

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
  Azure Container App       phillylaxstats.com (Fastify serves SPA + API)
```

Single deployment target — Azure Container App hosts both web client and API:

| Component | URL | Data source |
|-----------|-----|-------------|
| Web + API | `https://phillylaxstats.com` | SQLite on Azure File Share |

**After local-only data changes** (workbook imports, manual corrections, dedup): run `pnpm db:upload` to sync the local DB to Azure File Share. The nightly CI handles this automatically for RSS-sourced data, but ad-hoc local scripts require this manual sync step.

---

## What Each Doc Covers

### [index.md](./index.md)
Ultra-minimal agent entrypoint. Decision tree: "If you need X, load Y". Token cost estimates for each doc.
**Token cost:** ~600 tokens.

### Quick-Reference Cards ([quick-refs/](./quick-refs/))

#### [commands.md](./quick-refs/commands.md)
All CLI commands organized by category: ingest pipeline, PBLA sync, data quality, dedup, Azure sync, etc.
**Token cost:** ~600 tokens.

#### [db-schema.md](./quick-refs/db-schema.md)
Table schemas, key columns, relationships, migration history. Excludes implementation details.
**Token cost:** ~900 tokens.

#### [api-endpoints.md](./quick-refs/api-endpoints.md)
API endpoint paths, params, responses, cache behavior. Excludes query implementation.
**Token cost:** ~750 tokens.

#### [data-sources.md](./quick-refs/data-sources.md)
Source URLs, what they provide, trust hierarchy, sync commands, common issues.
**Token cost:** ~600 tokens.

---

### [onboarding.md](./onboarding.md)
Getting started guide. Conventions, hard rules, package map, key file locations, sub-agent protocols.
**Token cost:** ~1,800 tokens.  
**When to use:** First-time setup, learning project conventions.

---

### [architecture-full.md](./architecture-full.md)
Full architecture reference. Covers package map, all data sources, DB schema overview, ingest pipeline 
stages, nightly CI workflow, API endpoint inventory, key architectural decisions, and known tech debt.
**Token cost:** ~5,400 tokens.  
**When to use:** Any time you need to understand how data moves from source to screen, or where a
specific piece of logic lives. **Load only if quick-refs don't answer your question.**

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

# On-demand source reconciliation
pnpm --filter @pll/ingest exec tsx src/scripts/syncPiaa.ts
pnpm --filter @pll/ingest reconcile:scores --dry-run
```

For the full command reference, see `AGENTS.md` section 3.
