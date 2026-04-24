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

| Time  | Lane | Fleet name      | Update |
|-------|------|-----------------|--------|
| 13:30 | —    | —               | ✅ Wave 2 design phase complete (10 RFCs in `/docs/improvements/` + INDEX) |
| 13:38 | —    | —               | ✅ Pushed `e78da7a` (10 RFCs + index) |
| 13:40 | A    | Han 😉🚀        | 🚀 Implementing RFC #03 (API cache + ETag) |
| 13:40 | B    | Yoda 👽✨       | 🚀 Implementing RFC #01 (alias auto-seeder, dry-run only) |
| 13:40 | C    | Leia 👑💁‍♀️     | 🚀 Implementing RFC #06 (game flow chart) |
| 13:43 | C    | Leia 👑💁‍♀️     | ✅ Done in 247s, commit `b683db1` (also swept Han+Yoda WIP via `git add -A`) |
| 13:45 | A    | Han 😉🚀        | ✅ Done in 283s, marker commit `9b667f0` (code shipped in `b683db1`) |
| 13:54 | B    | Yoda 👽✨       | ✅ Done in 832s, commit `5ecfac3` — dry-run produced 6 candidates ≥0.80 confidence |
| 13:54 | —    | —               | 🔧 Cleanup: removed `.tmp/logos-*` fixtures, added gitignore rule (`cb53543`) |
| 13:55 | —    | —               | ✅ Verification: pnpm typecheck (4/4 pkgs), server tests 136/136, web tests 89/89 |

---

## Decision log
- Plans go in `.github/docs/` per agent skill; user-facing improvement RFCs go in `/docs/improvements/` per user request.
- 5 lanes × 2 proposals each chosen over 10 lanes × 1 proposal to keep fleet overhead reasonable while still parallelizing by category.
- Wave 4 picked RFCs #03 + #01 + #06 (server/ingest/web split, all S–M, all Low risk). Deferred #09/#10 because they need user-side Azure AD work.
- Yoda's seeder explicitly run dry-run only — applying aliases is a destructive DB mutation requiring user approval.
- Test-fixture scratch dirs (`**/__tests__/.tmp/`) added to `.gitignore` after Leia's `git add -A` accidentally committed binary logo fixtures.

## Handoff notes
None — Wave 4 closed cleanly.

---

## Wave 4 Retrospective

### Actual vs. Estimated
| Lane | Fleet | Estimated | Actual | Notes |
|------|-------|-----------|--------|-------|
| A | Han 😉🚀 | M (10m) | 4m43s | ✅ 50% under |
| B | Yoda 👽✨ | M (10m) | 13m52s | ⚠️ 38% over (large alias-mining test suite) |
| C | Leia 👑💁‍♀️ | M (10m) | 4m07s | ✅ 60% under |

### Critical path analysis
- Yoda was the long pole. Han and Leia each finished in ~4m and could have absorbed scope.
- No lane was blocked by another (perfect package-level isolation: server/ingest/web).
- Synthesis (cleanup + verification) took ~2m — well under the 5m deadline.

### What went well
- Package-boundary lane split → zero merge conflicts at the file level.
- All 3 lanes pushed directly to `main`; no rebase needed.
- Test discipline: every lane shipped tests (8/13/11 = +32 tests). Total suite green.
- 1569 net LOC delivered in 14 wall minutes.

### What didn't go well
- **Race on `git add -A`**: Leia's commit (`b683db1`) swept up Han's and Yoda's untracked working files plus binary `.tmp/logos-*` fixtures. Caused commit-attribution confusion (Han's marker commit `9b667f0` is empty) and committed 84 bytes of binary cruft.
- **Yoda 38% over estimate**: alias-mining is more complex than a typical M (token extraction + confidence scoring + ambiguity rejection + 11 unit tests). Should have been L.
- **No pre-flight gitignore audit**: `.tmp/` test-fixture pattern wasn't ignored; would have prevented binary commit.

### Decision log
- ✅ Cleaned up `.tmp/` cruft in follow-up commit `cb53543` rather than rewriting Wave 4 history.
- ✅ Did not block on Han's marker-commit asymmetry; documented in commit message instead.
- 🔴 Wave 5+: lanes that need to commit must `git add <specific-files>`, never `git add -A`.

---

## Next Wave Improvements (Wave 5)

### Identified issues from Wave 4
1. `git add -A` race in parallel lanes → cross-lane file capture + binary cruft.
2. Effort sizing: alias-mining type tasks (token + confidence + dedup logic) systematically underestimated as M.
3. No pre-flight gitignore audit when adding new test patterns.

### Proposed changes for Wave 5
- **[P0] Explicit-path-only commits**: prompt template line — *"When committing, run `git add <explicit-path-list>` and never `git add -A` or `git add .`. List exact files in your commit message."*
- **[P1] Resize heuristics**: any lane that involves "miner + scorer + dedup + tests" defaults to L, not M.
- **[P2] Pre-flight gitignore check**: orchestrator scans new test fixtures for `.tmp/`, `.cache/`, `*.bak` patterns before launch.

### Wave 5 candidate options (awaiting user choice)

**Option A — Pure-code wave (no Azure work needed):**
| Lane | RFC | Fleet | Size | Scope | Risk |
|------|-----|-------|------|-------|------|
| A | #04 web bundle code-splitting | Han 😉🚀 | M | packages/web vite config + dynamic imports | Low |
| B | #07 centralized logger rollout | Yoda 👽✨ | L | packages/server + ingest replace `console.*` | Low |
| C | #05 team strength radar chart | Leia 👑💁‍♀️ | M | packages/web new component | Low |

**Option B — DevOps wave (needs user-side Azure AD app reg):**
| Lane | RFC | Fleet | Size | Scope | Risk |
|------|-----|-------|------|-------|------|
| A | #09 GHA OIDC self-hosted-runner replacement | R2 🤖🔧 | L | `.github/workflows/*.yml` + Azure federated creds | Med (auth) |
| B | #10 pre-deploy validation + rollback | Chewy 🐻💪 | M | `.github/workflows/deploy.yml` health gates | Med (deploy) |

**Option C — Apply Yoda's 6 aliases first**: small solo task (~10m) to apply aliases, replay ingest, push DB to Azure. Predicted ~210 anomaly reduction (119 → ~-90 net change after fan-out).

### Success metrics for Wave 5
- Zero `git add -A` events
- All lanes within ±20% of estimate
- Synthesis < 3m
- Zero test fixture commits

### Decision: Ready for Wave 5? (Y/N)
- Awaiting user input on Option A / B / C
- Recommended: **C then A** — apply alias seeds first to clean up the dataset, then ship the pure-code wave while DevOps decisions stay queued for when Azure AD time is available.

---

## Phase C — Alias seed application (solo, ~7 min, 14:00–14:07)

| Step | Result |
|------|--------|
| `pnpm seed:aliases --apply` | 6 aliases inserted (cr south, khs, dt east, pr, parland, dccs) |
| `pnpm ingest --reparse --category=hs-summaries` | 42 posts reprocessed in 465ms |
| Anomalies | 708 → **663** (-45) |
| Player stats | 6790 → **6825** (+35 newly attributed to correct teams) |
| Players | 1929 → **2023** (+94 new player records spawned by alias-resolved sub-headers) |
| WAL checkpoint + Azure Files upload | ✅ pllstorage3426/pll-data |
| Container restart | revision 0000006 restarted, /api/freshness confirms 605/2023 |

Predicted ~210 anomaly drop didn't materialize (-45 actual) because most were "team hint did not resolve" anomalies whose root cause is the long tail of unique abbreviations rejected as ambiguous, not the 6 high-confidence ones. The +94 player records / +35 stats are the real win.

---

## Wave 5 — Pure-code fleet (Han/Yoda/Leia, 14:08–14:25)

| Lane | Fleet | RFC | Estimated | Actual | Status | Commit |
|------|-------|-----|-----------|--------|--------|--------|
| A | Han 😉🚀 | #04 web bundle splitting | M (30m) | 8m28s | ✅ | `3e55333` |
| B | Yoda 👽✨ | #07 centralized logger | L (45m) | 12m30s | ✅ | `7641220` |
| C | Leia 👑💁‍♀️ | #05 team radar chart | M (30m) | 9m26s | ✅ | `4d13ec7` |

### Headline metrics
- **Bundle:** entry chunk 411 KB → **15 KB** uncompressed (96% reduction); 15 lazy routes; shared `charts` chunk 77 KB
- **Logger:** 338 → **27** `console.*` in server+ingest (all 27 documented exempt: 5 CLI safety, 20 just-shipped Wave 4 files, 2 comments)
- **Radar chart:** new component, +27 tests, wired into `teamDetail.ts`
- **Test totals across workspace:** shared 6 / server 136 / ingest 473+1skip / web 116 = **731 passing**

### Wave 5 Retrospective

**What went well**
- Explicit `git add <paths>` rule from Wave 4 retro held in all 3 lanes — zero cross-lane file capture even though 38 files were in the worktree from Yoda mid-wave.
- All lanes finished WELL under hard stop (Han 28%, Leia 31%, Yoda 28% of budget). Pre-flight L sizing for Yoda was generous; could have been M.
- Package-boundary discipline again perfect: vite-only / shared+server+ingest / web-component — zero conflicts.
- Lane C used Lane Wave-4-A (gameFlowChart) as a reference pattern → consistent a11y story across both new charts.

**What didn't go well**
- Phase C anomaly delta (-45) far below RFC #01 prediction (-210). The miner needs a smarter ambiguity rule (e.g., context-aware: same alias resolves differently in different game blocks).
- RFC #07 mechanically mapped `console.log → log.info` instead of doing the level reclassification the spec called for. Yoda flagged this as a follow-up — a future wave should grade calls into debug/info/warn.
- No Azure redeploy after RFC #07 — production server is still running pre-logger image. Decision deferred.

**Decision log**
- ✅ Yoda L sizing acceptable (tasks-with-tests systematically run high; better to overshoot than hit hard stop).
- ✅ `mineAliases.ts`/`seedAliasesFromMine.ts` added to don't-touch list for Yoda — Wave 4 work stayed unchanged.
- 🟡 Production Azure deploy of logger change deferred to user choice (not destructive but rebuilds image).

### Next Wave Improvements (Wave 6)

**Identified issues from Wave 5**
1. Logger level reclassification (debug vs info vs warn) wasn't mechanical-safe — needs human-graded pass.
2. Anomaly miner is too conservative on ambiguous aliases — left ~140 anomalies on the table.
3. RFC #07 changes need Azure container rebuild to take effect in prod.

**Wave 6 candidate options**
- **#04+05 redeploy** — push web changes to a static host (none exists yet — would need Azure SWA provisioning, which is medium-risk infra work).
- **#08 domain type consolidation** (Chewy 🐻💪, M) — convert `: any` usages, share types between server/web via @pll/shared.
- **#02 losing-side stats backfill** (Han 😉🚀, M) — uses stats-only posts to backfill 70 "period sum != total" anomalies.
- **#09 OIDC + #10 deploy gates** (R2 + Chewy, L+M) — needs Azure AD app registration, user must be in the loop.
- **Alias miner v2** (Yoda 👽✨, M) — context-aware ambiguity resolution to recover the 140 rejected candidates.

**Decision: Ready for Wave 6? (Y/N)** — awaiting user input.

