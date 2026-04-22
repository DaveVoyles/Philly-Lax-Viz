# 2026-04-22 — Wave 10+ Implementation Plan

## User request
"Continue documenting and make further improvements. Mostly with data and accuracy. Also: Azure deployment plan for low-cost tier; what WebGL functionality would make this stand out; what data are we missing? Then implement the docs with a fleet."

## Target outcome
Implement the roadmap from `docs/2026-04-22-roadmap-data-azure-webgl.md` autonomously through multiple waves until all tracks are addressed.

## Pre-flight
- Repo: clean working tree, branch `main`
- DB: `data/lacrosse.db` (3.1 MB, 241 teams, 547 games, 3,140 anomalies — mostly recoverable)
- All tests passing (186 ingest, 49 server)
- Risk: Medium (data mutation + new infra files; no destructive ops; backups exist)

## Wave 10 — Data accuracy + leader depth + Azure scaffolding

| Lane | Fleet      | Effort | Scope                                                                                                                                    | Blocked by | Status     | Hard stop |
| ---- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- | --------- |
| 1    | Han 😉🚀   | M      | A1 — Extend `seedTeamAliases.ts` with parser abbrevs (UMerion, MHS, PHX, JBHA, OJR, etc.); team dedup for Jack Barrack & Springside; re-ingest; verify anomaly drop ≥80%. Update test. | —          | 🎯 Launch  | 30m       |
| 2    | Yoda 👽✨  | M      | D1+D2 — Surface goalie saves and FO/GB leaders. Extend `/leaders` API with new stat categories; add chart panels to dashboard.            | —          | 🎯 Launch  | 30m       |
| 3    | Leia 👑💁‍♀️ | M      | B — Azure deployment artifacts: server `Dockerfile`, `.github/workflows/deploy.yml` + `ingest-nightly.yml`, `docs/azure-deployment.md` with concrete `az` CLI commands.                  | —          | 🎯 Launch  | 30m       |

Synthesis after all 3 complete: integration smoke test (rebuild web, run all tests).

## Wave 11 — Visual standout + secondary data quality

| Lane | Fleet      | Effort | Scope                                                                                                                | Blocked by | Status      |
| ---- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| 1    | Chewy 🐻💪 | L      | C1 — WebGL rivalry network graph using pixi.js; new `/graph` page; team nodes sized by wins, edges by games played.   | Wave 10    | ⏸ Pending   |
| 2    | R2 🤖🔧    | M      | A3 — PIAA cross-validation badge; compare derived W-L vs official; render badge on team cards.                       | Wave 10    | ⏸ Pending   |
| 3    | Luke 🌟⚔️  | M      | A4 — `/anomalies` browser page; group by reason + raw_line; helps maintainer triage.                                 | Wave 10    | ⏸ Pending   |

## Wave 12 (deferred — high-effort, may need user input)
- Player-name dedup (A2) — needs fuzzy logic policy decision
- Schedule data (D3) — external scrape, may need separate source agreement
- Historical seasons (D5) — RSS pagination, larger scope

## Communication log
| Time  | Lane | Fleet      | Update                                                       |
| ----- | ---- | ---------- | ------------------------------------------------------------ |
| 15:30 | —    | Orchestrator | 🎯 Wave 10 launching: 3 lanes M/M/M, fully independent.    |
| 15:32 | 1    | Han 😉🚀     | 🔍 Baseline captured: 3140 anomalies, 186/186 tests pass. Verified target team IDs exist. Dedup candidates confirmed (JBarrack: 53/102/277; Springside: 28/161). |
| 15:36 | 1    | Han 😉🚀     | 🔧 Seeded 32 PARSER_ABBREVIATIONS + 5 SKIPPED_AMBIGUOUS notes. Extended EXPLICIT_PAIRS to 12 (added Jack Barrack ×3, Springside ×1, Hatboro-Horsham, WC East, WC Henderson). PARSER_VERSION → 0.2.1. |
| 15:39 | 1    | Han 😉🚀     | ✅ Re-ingested hs-summaries with new aliases. Anomalies 3140 → 2012 (-35.9%). Player stats 3388 → 4305 (+917 recovered). 190/190 tests pass, typecheck clean. Below 60% target — bottleneck is parser-side normalization of sub-headers like "DV Scorers", "CB South ", "PJP Scoring" (trailing "Scorers"/"Scoring"/colon variants), out of Lane-1 scope. Recommend Wave 11 parser-normalize follow-up. |
| 15:31 | 3    | Leia 👑💁‍♀️ | 🔍 Scoping. Server uses `DB_PATH` env, port 3001 (override to 8080), tsx runtime. Drafting Dockerfile + workflows + docs in parallel. |
| 15:35 | 3    | Leia 👑💁‍♀️ | ✅ Done. Files: `Dockerfile`, `.dockerignore`, `.github/workflows/{deploy,ingest-nightly}.yml`, `infra/azure-bootstrap.sh`, `docs/azure-deployment.md`. Both YAMLs parse-valid; all 7 secrets cross-referenced in the doc. No server/web/ingest code touched. Docker daemon unavailable locally so image build skipped per spec. |
| 15:31 | 2    | Yoda 👽✨  | 🔍 Schema confirmed: `goals,assists,ground_balls,caused_turnovers,saves,fo_won,fo_taken`. No `goals_against`. Existing `/api/leaders/players` already supports saves/ground_balls/fo_pct metrics. Plan: bump fo_pct default `minAttempts` to 20, plumb `minAttempts` through web `api.ts`, add 3 dashboard panels (Saves / FO% / GBs). |
| 15:35 | 2    | Yoda 👽✨  | ✅ Done. Server: per-metric defaults (saves/GB minGames=3, fo_pct minAttempts=20); fixed latent SQL bug — HAVING `fo_taken` resolved to raw column, not SUM; now uses `COALESCE(SUM(ps.fo_taken),0)`. Web: added 3 horizontal-bar leader panels (Saves / FO% / Ground Balls) to dashboard, responsive grid, uses existing `renderHorizontalLeaderboard`. Tests: 52 pass (was 49). Web build OK (124 KB), typecheck clean both packages. |
