# Agent Documentation Index

> **⚡ Start here.** Ultra-minimal index for agents joining this repo cold.  
> **Token cost:** ~600 tokens (vs. ~10,800 for full baseline load)

---

## Quick Context

**What:** TypeScript pnpm monorepo scraping & visualizing Philadelphia high-school boys lacrosse data  
**Sources:** phillylacrosse.com (RSS), piaad1.org (rankings), maxpreps.com (logos), laxnumbers.com (stats)  
**Stack:** SQLite → Fastify API → Vite + D3 SPA  
**Deployed:** Azure Static Web Apps + Container App

---

## Decision Tree: Load What You Need

| If you need... | Load this (token cost) | Why |
|----------------|------------------------|-----|
| **Run a script** | [quick-refs/commands.md](./quick-refs/commands.md) (~600 tokens) | All CLI commands, organized by category |
| **Understand DB** | [quick-refs/db-schema.md](./quick-refs/db-schema.md) (~900 tokens) | Tables, columns, relationships only |
| **Call the API** | [quick-refs/api-endpoints.md](./quick-refs/api-endpoints.md) (~750 tokens) | Endpoint paths, params, responses |
| **Know data sources** | [quick-refs/data-sources.md](./quick-refs/data-sources.md) (~600 tokens) | Source URLs, what they provide, trust hierarchy |
| **First-time setup** | [onboarding.md](./onboarding.md) (~1,800 tokens) | Getting started, hard rules, conventions |
| **Deep architecture** | [architecture-full.md](./architecture-full.md) (~5,400 tokens) | Full system design, data flow, decisions (⚠️ load only if needed) |
| **Deploy or ops** | [azure-deployment.md](./azure-deployment.md) (~1,200 tokens) | Azure setup, cost model, pitfalls |
| **Runbook task** | [runbooks/](./runbooks/) (~varies) | Step-by-step: deploy, import, corrections, Hudl |
| **Plan next work** | [improvements/00-INDEX.md](./improvements/00-INDEX.md) (~800 tokens) | RFC backlog, prioritized by impact |

---

## 5-Minute Commands Cheat Sheet

```bash
# Install & dev
pnpm install
pnpm dev                # server :3001 + web :5173

# Ingest pipeline
pnpm crawl              # RSS → data/raw-cache/
pnpm ingest             # parse → data/lacrosse.db

# PBLA sync
pnpm pbla:check         # diff live vs. snapshot
pnpm --filter @pll/ingest exec tsx src/scripts/patchPblaStats.ts

# Azure sync (after local DB changes)
pnpm db:upload          # push to Azure File Share

# Test & build
pnpm typecheck
pnpm test
pnpm build
```

📖 **Full command reference:** [quick-refs/commands.md](./quick-refs/commands.md)

---

## Reading Order (by depth)

### 🚀 Quick Start (load first)
1. This file (`index.md`) — you're here
2. One quick-ref based on your task (see decision tree above)

### 🧭 Intermediate (as needed)
3. [onboarding.md](./onboarding.md) — conventions, hard rules, common patterns
4. [azure-deployment.md](./azure-deployment.md) — deployment architecture
5. [runbooks/](./runbooks/) — operational guides

### 🏗️ Deep Dive (rare)
6. [architecture-full.md](./architecture-full.md) — full system design (~5,400 tokens)
7. [pipeline-gaps.md](./pipeline-gaps.md) — known missing pieces
8. [improvements/00-INDEX.md](./improvements/00-INDEX.md) — future work

---

## Common First Tasks

| Task | Load order | Estimated tokens |
|------|------------|------------------|
| "Run the ingest pipeline" | index.md → commands.md | ~1,200 |
| "Fix a failing workflow" | index.md → commands.md → runbooks/deploy-to-pages.md | ~2,400 |
| "Understand how data flows" | index.md → data-sources.md → architecture-full.md | ~6,600 |
| "Add a new API endpoint" | index.md → api-endpoints.md → onboarding.md | ~3,200 |
| "Import coach spreadsheet" | index.md → commands.md → runbooks/local-data-import.md | ~2,100 |
| "Debug DB query" | index.md → db-schema.md | ~1,500 |

---

## Hard Rules (non-negotiable)

1. **ASCII-only in HTTP-bound text** — em-dash `—` breaks undici; use `-`
2. **No `pkill`/`killall`** — use `kill <PID>` or `lsof -ti:PORT | xargs kill`
3. **After local DB changes:** run `pnpm db:upload` to sync to Azure
4. **Logo files are `.gif`** not `.png` (MaxPreps serves .gif)
5. **Never read `.env` files** (project policy)

📖 **Full conventions:** [onboarding.md](./onboarding.md)

---

## When to Load Full Architecture

⚠️ **Only load [architecture-full.md](./architecture-full.md) (~5,400 tokens) if:**
- You need to understand ALL data sources and their parsers
- You're refactoring core ingest/pipeline logic
- You're writing an ADR for a major architectural change
- Quick-refs don't answer your question

**Most tasks don't need full architecture.** Start with quick-refs.

---

## Doc Maintenance

These docs are the source of truth:
- **This file** (`index.md`) — always current
- **Quick-refs** — updated when schema/API changes (~quarterly)
- **onboarding.md** — updated with new conventions
- **architecture-full.md** — updated with major architectural changes

Stale docs? File an issue or update inline.

---

## Meta: Why This Structure?

**Problem:** Loading AGENTS.md + docs/README.md + architecture.md = **~10,800 tokens** upfront, even when agents only need "how do I run this script?"

**Solution:** Tiered docs with lazy loading:
- **Tier 1:** This index (~600 tokens)
- **Tier 2:** Quick-refs (~600-900 tokens each)
- **Tier 3:** Deep-dive docs (load only when needed)

**Result:** Typical cold-start load drops from ~10,800 to ~1,800 tokens (83% reduction).
