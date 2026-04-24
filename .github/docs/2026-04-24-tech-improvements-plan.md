# 2026-04-24 — Technical Improvements Fleet Plan

## User request
Identify and implement broad technical improvements across the Philly Lacrosse Vis project — tech debt, docs, performance, visualizations, data quality. Use a fleet to design 10 improvement proposals stored in `/docs/`, then begin implementation in waves.

## Target outcome
1. 10 well-scoped improvement proposals in `/docs/improvements/` (numbered RFC-style, with motivation, design, scope, validation)
2. A prioritization synthesis that ranks them by impact/effort/risk
3. Implementation starts on the top tier; ship at least one improvement end-to-end this session

## Risk level
Low–Medium. Design docs are zero-risk. Implementation risk varies per proposal — gated by per-proposal review.

---

## Wave plan

### Wave 1 — Reconnaissance (solo, S, 5m)
Orchestrator surveys repo structure, recent checkpoints, current pain points, and produces a categorized improvement seed list. No fleet needed (sequential dependency for Wave 2 scoping).

### Wave 2 — Design fleet (5 lanes in parallel, S each)
Five agents each produce 2 design proposals → 10 total in `/docs/improvements/`. Each lane owns a category to avoid overlap.

| Lane | Fleet name | Effort | Category | Blocked by | Status | Checkpoint |
|------|------------|--------|----------|------------|--------|-----------|
| 1 | Han 😉🚀 | S | Data quality (ingest, anomaly resolution, alias system) | — | Pending | 8m |
| 2 | Yoda 👽✨ | S | Performance (DB indices, API caching, bundle, query plans) | — | Pending | 8m |
| 3 | Leia 👑💁‍♀️ | S | Visualizations (charts, WebGL, dashboard UX) | — | Pending | 8m |
| 4 | Chewy 🐻💪 | S | Tech debt (typing, error handling, test coverage, refactors) | — | Pending | 8m |
| 5 | R2 🤖🔧 | S | Docs + DevOps (architecture docs, runbooks, CI/CD, observability) | — | Pending | 8m |

Filename convention: `/docs/improvements/NN-slug.md` where NN is 01–10.
Lane assignments fix the NN range:
- Han → 01, 02
- Yoda → 03, 04
- Leia → 05, 06
- Chewy → 07, 08
- R2 → 09, 10

### Wave 3 — Synthesis (solo, S, 5m)
Orchestrator reads all 10 proposals, scores by `Impact × Urgency − Effort − Risk`, writes `/docs/improvements/00-INDEX.md` with the ranking, picks top 2–3 for first implementation wave.

### Wave 4 — Implementation Wave A (fleet, sized per proposal)
Sized once Wave 3 completes. Each picked proposal becomes a lane with explicit scope.

### Wave 5+ — Subsequent implementation waves
Optional; depends on remaining time and user approval.

---

## Improvement seed list (Wave 1 output)

To be populated after recon. Each lane in Wave 2 picks 2 from this seed list (or proposes equivalents) and writes the design docs.

---

## Communication log

| Time | Lane | Fleet name | Update |
|------|------|------------|--------|
| pending | — | — | Plan drafted, awaiting approval |

---

## Decision log
- Plans go in `.github/docs/` per agent skill; user-facing improvement RFCs go in `/docs/improvements/` per user request.
- 5 lanes × 2 proposals each chosen over 10 lanes × 1 proposal to keep fleet overhead reasonable while still parallelizing by category.

## Handoff notes
None yet (plan only).
