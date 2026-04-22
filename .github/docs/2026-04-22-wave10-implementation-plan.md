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
| 15:35 | 3    | Leia 👑💁‍♀️ | ✅ Done in 5m. 6 files (Dockerfile, 2 workflows, infra script, deploy doc, .dockerignore). |
| 15:35 | 2    | Yoda 👽✨   | ✅ Done in ~5m. Saves/FO%/GB leaders surfaced; latent HAVING bug fixed. 52/52 server tests. |
| 15:39 | 1    | Han 😉🚀    | ✅ Done in ~9m. Anomalies 3140→2012 (-35.9%). Below 60% gate; remainder needs parser suffix-strip (Wave 11). 190/190 ingest tests. |
| 15:42 | —    | Orchestrator | ✅ Wave 10 complete. Repo-wide tests + typecheck green. Initial commit `fbcf7b8`. |

## Wave 10 retrospective

### Actual vs estimated
- Lane 1 (Han, M): ~9m → ✅ on time, scope-limited result
- Lane 2 (Yoda, M): ~5.5m → ✅ ahead of estimate
- Lane 3 (Leia, M): ~5m → ✅ ahead of estimate

### Critical path
- All 3 lanes truly independent — no blocking. Synthesis trivial (run tests + commit).

### What went well
- Pre-discovery of team IDs in orchestrator step saved Han ~5min of lookup
- Lane boundaries crystal clear → zero merge conflict risk
- Yoda found and fixed a latent SQL bug as bonus value
- Leia confirmed server already has env-var DB_PATH support → no code change needed

### What to improve
- Lane 1 anomaly target (60-80%) was overoptimistic without parser-side analysis. Should have run a 5-min anomaly-shape audit before sizing. The remaining 1,703 anomalies all share the suffix pattern (`"X Scorers"`, `"X Scoring:"`) that aliases can't catch — needs parser layer fix.
- Should have included `git init && git commit` discovery in pre-flight; was caught at synthesis.

## Wave 11 — Parser cleanup, PIAA badge, anomaly browser ✅ COMPLETE (commit 9501f74)

| Lane | Fleet      | Effort | Scope                                                                                                                                                | Result |
| ---- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Chewy 🐻💪 | M      | Parser sub-header suffix-strip; normalize `\s+(scorers?\|scoring\|stats?)\s*:?$` before alias lookup; re-ingest.                                       | Anomalies 2012→1114 (-44.6%); +1220 stats. Below ≤500 target — bottleneck moved to score-line block-boundary detection (Wave 12 L1). |
| 2    | R2 🤖🔧    | M      | PIAA validation badge: derivedRecord + PiaaValidation types; ✅/⚠️/🔴/⚪ badge on cards + panel on team detail.                                       | 8 match / 31 close / 19 divergent / 178 unmapped. +11 server tests. |
| 3    | Luke 🌟⚔️  | M      | `/anomalies` browser page: `/api/anomalies/summary` endpoint + hash-route page with by-reason chart + top-50 raw lines.                              | Done in 7m. +4 server tests. |

## Wave 12 — Block-boundary parser + WebGL headline + player dedup

| Lane | Fleet      | Effort | Scope                                                                                                                                                          | Blocked by | Status     | Hard stop |
| ---- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- | --------- |
| 1    | Darth 😈⚡  | L      | Score-line block-boundary parser fix in `parsers/scoreLine.ts` + `parsers/summariesPost.ts`. Cross-game contamination is the #1 remaining anomaly cluster. Target anomalies 1114 → ≤400. | —          | 🎯 Launch  | 45m       |
| 2    | Han 😉🚀   | L      | WebGL rivalry network graph using pixi.js. New `/graph` hash route. 236 nodes (teams), edges weighted by games played, color = avg margin. Pan/zoom/hover.     | —          | 🎯 Launch  | 45m       |
| 3    | Yoda 👽✨  | M      | Player-name dedup: Levenshtein ≤2 within same team_id. New `dedupPlayers.ts` script + `player_aliases` table. Idempotent, transactional, audit log.            | —          | 🎯 Launch  | 30m       |
| 15:32 | 1    | Han 😉🚀     | 🔍 Baseline captured: 3140 anomalies, 186/186 tests pass. Verified target team IDs exist. Dedup candidates confirmed (JBarrack: 53/102/277; Springside: 28/161). |
| 15:36 | 1    | Han 😉🚀     | 🔧 Seeded 32 PARSER_ABBREVIATIONS + 5 SKIPPED_AMBIGUOUS notes. Extended EXPLICIT_PAIRS to 12 (added Jack Barrack ×3, Springside ×1, Hatboro-Horsham, WC East, WC Henderson). PARSER_VERSION → 0.2.1. |
| 15:39 | 1    | Han 😉🚀     | ✅ Re-ingested hs-summaries with new aliases. Anomalies 3140 → 2012 (-35.9%). Player stats 3388 → 4305 (+917 recovered). 190/190 tests pass, typecheck clean. Below 60% target — bottleneck is parser-side normalization of sub-headers like "DV Scorers", "CB South ", "PJP Scoring" (trailing "Scorers"/"Scoring"/colon variants), out of Lane-1 scope. Recommend Wave 11 parser-normalize follow-up. |
| 15:31 | 3    | Leia 👑💁‍♀️ | 🔍 Scoping. Server uses `DB_PATH` env, port 3001 (override to 8080), tsx runtime. Drafting Dockerfile + workflows + docs in parallel. |
| 15:35 | 3    | Leia 👑💁‍♀️ | ✅ Done. Files: `Dockerfile`, `.dockerignore`, `.github/workflows/{deploy,ingest-nightly}.yml`, `infra/azure-bootstrap.sh`, `docs/azure-deployment.md`. Both YAMLs parse-valid; all 7 secrets cross-referenced in the doc. No server/web/ingest code touched. Docker daemon unavailable locally so image build skipped per spec. |
| 15:31 | 2    | Yoda 👽✨  | 🔍 Schema confirmed: `goals,assists,ground_balls,caused_turnovers,saves,fo_won,fo_taken`. No `goals_against`. Existing `/api/leaders/players` already supports saves/ground_balls/fo_pct metrics. Plan: bump fo_pct default `minAttempts` to 20, plumb `minAttempts` through web `api.ts`, add 3 dashboard panels (Saves / FO% / GBs). |
| 15:35 | 2    | Yoda 👽✨  | ✅ Done. Server: per-metric defaults (saves/GB minGames=3, fo_pct minAttempts=20); fixed latent SQL bug — HAVING `fo_taken` resolved to raw column, not SUM; now uses `COALESCE(SUM(ps.fo_taken),0)`. Web: added 3 horizontal-bar leader panels (Saves / FO% / Ground Balls) to dashboard, responsive grid, uses existing `renderHorizontalLeaderboard`. Tests: 52 pass (was 49). Web build OK (124 KB), typecheck clean both packages. |
| 15:44 | 2    | R2 🤖🔧    | 🔍 Schema confirmed: `piaa_official_teams(name_official, name_normalized, classification, seed, wins, losses, ties, ...)`. PIAA enrichment already wired into `team.piaa` block via SQL LEFT JOIN. Plan: extend `listTeams`/`getTeamById` SQL to include derived W/L/T; add `validation` block (status: match/close/divergent/unmapped, diff, sourceUrl) to mapTeam; render compact badge on dashboard cards + panel on team detail. |
| 15:50 | 2    | R2 🤖🔧    | ✅ Done. Server: extended SQL to include derived W/L/T per team; added `classifyPiaaValidation` + `PIAA_SOURCE_URL` in mappers; new fields `derivedRecord` & `piaaValidation` on `Team` (shared types). Web: new `piaaBadge.ts` component renders ✅/⚠️/🔴/⚪ with hover tooltip; wired into dashboard team cards (next to gap badge) and team detail header (badge in PIAA Record callout + verification panel with click-through to PIAA D1 page). Tests: 67/67 server pass (was 52); +15 tests (8 parametric + 4 integration + existing 3 piaa.test.ts unchanged). Web build clean (130 KB / 8 KB css). Live distribution across 236 teams: 8 ✅ match · 31 ⚠️ close · 19 🔴 divergent · 178 ⚪ unmapped (most unmapped are non-PIAA programs: NJ teams, MAPL/Inter-Ac independents, etc.). |
| 15:46 | 3    | Luke 🌟⚔️  | ✅ Done in ~6m. New `GET /api/anomalies/summary?limit=&reason=` (kept legacy `/api/anomalies` list for back-compat with W9 dataQuality view). New `/anomalies` web page: by-reason horizontal bar chart + top-50 raw-line table with source links. Nav link added. Tests: 56/56 server (52 baseline + 4 new). Web build clean (127.85 KB). Files: `packages/server/src/queries/anomalies.ts`, `packages/server/src/routes/anomalies.ts`, `packages/server/src/__tests__/anomalies.test.ts`, `packages/web/src/views/anomalies.ts`, `packages/web/src/api.ts`, `packages/web/src/router.ts`, `packages/web/src/main.ts`. |
| 15:48 | 1    | Chewy 🐻💪 | 🔧 Added `normalizeTeamToken` helper (suffix-strip + trailing punctuation) in teamResolver; integrated into findTeamByName/resolveTeam; broadened sub-header regex in summaries to allow trailing colon; enriched anomaly raw_line with `[unresolved sub-header: "..."]` token for diagnosability. PARSER_VERSION → 0.2.2. |
| 15:54 | 1    | Chewy 🐻💪 | 🔧 First re-ingest exposed 30+ unambiguous abbrev tokens (PV, Rustin, MN, HGP, Stoga, Carroll…). Added 25 new high-confidence aliases to PARSER_ABBREVIATIONS; expanded SKIPPED_AMBIGUOUS notes for prep/nhs. |
| 15:56 | 1    | Chewy 🐻💪 | ✅ Done. Anomalies 2012 → 1114 (-44.6%). Player stats 4305 → 5525 (+1220 recovered). 206/206 ingest tests pass (added 16 new: 12 normalizeTeamToken units + 4 integration). Repo-wide typecheck clean. Did NOT hit ≤500 target — bottleneck shifted from "missing aliases" to "score-line parser misses transition between consecutive game blocks" (cross-game contamination: e.g. Pennsbury/Haverford headers correctly resolve to known teams that aren't in the current block). That's a parser-strictness fix, out of Lane-1 scope; recommend Wave 12 lane for score-line block-boundary detection. |
| 16:03 | 3    | Yoda 👽✨   | ✅ Done. New `005_player_aliases.sql` migration + Wave-12 fuzzy block in `dedupPlayers.ts` (`levenshtein`, `normalizeForFuzzy`, `findDuplicateCandidates`, `mergePlayers`, `pickKeepFromCandidate`). Live DB dedup: 169 candidates (112 high / 57 medium); applied 105 high-confidence + 32 legacy-normalize + 3 cascaded-normalize merges. Players 1801 → 1661 (-140). 102 audit rows in `player_aliases` (source=`auto-dedup-w12`). Tests: 225 pass (was 206; +19 new — Levenshtein, normalizer, candidate finder, merge transaction, idempotency, keep-side picker). Typecheck clean. CLI: `pnpm --filter @pll/ingest players:dedup` (dry-run default) / `-- --apply` writes; `--threshold=N`, `--include-medium`, `--no-fuzzy` flags. Backup at `data/lacrosse.db.bak-w12-pre-player-dedup`. Caveats: medium-confidence pairs surface obvious false positives (Kevin Ford vs Evan Federsel) and are NOT auto-applied — manual review only via `--include-medium`. Pre-existing rankings→teams FK orphans observed but unrelated; FK gate scoped to players/player_stats/player_aliases. |
| 15:57 | 2    | Han 😉🚀    | 🔍 Scope confirmed (server endpoint + pixi WebGL view). Installed `pixi.js@^8` + `d3-force` + `@types/d3-force`. Reused dashboard "ghost-team" filter (≥1 game OR ≥1 player OR PIAA-mapped) so node set matches the rest of the site. |
| 16:00 | 2    | Han 😉🚀    | ✅ Done in ~3m. Live: 235 nodes / 543 edges from `/api/rivalries`; layout settles in ≤1s headlessly (300 d3-force ticks pre-render, then `alphaMin=0.01`). Server: new `queries/rivalries.ts` + `routes/rivalries.ts` + `__tests__/rivalries.test.ts` (3 teams, 2 played + 1 postponed → 1 edge, totalMarginSum=7, avgMargin=3.5). Tests 68/68. Web: new `/graph` hash route + nav link "Network"; pixi v8 `Application` with pan (drag empty space) / mouse-anchored wheel zoom / hover-highlight (incident edges + tooltip W-L-games) / click-to-`#/teams/:id`. HTML legend overlay. `app.destroy(true,{children:true,texture:true})` wired into `dispatch()` so route changes free GPU. Bundle: entry 130 KB → 378 KB (+248 KB) with pixi v8's WebGL/WebGPU/CanvasRenderer/etc lazy-chunked separately (gzip entry 119 KB). Files: server `queries/rivalries.ts`, `routes/rivalries.ts`, `app.ts`, `__tests__/rivalries.test.ts`; web `views/graph.ts`, `router.ts`, `main.ts`, `api.ts`, `package.json`. |
| 16:05 | 1    | Darth 😈⚡  | 🔍 Reproduced bug. Two root causes (NOT just the score-line probe Chewy named): (a) **alias mismatch** — sub-headers like "Haverford" resolve to "Haverford High" (id=36) but current game's home is "Haverford School" (id=11); same for "WC Henderson" vs in-game "Henderson"; (b) **parser desync** — `assignAndUpsertPlayerStats` re-walked `block.rawLines` with a `looksLikePlayer` regex that disagreed with `parsePlayerStatLine` on `"Andrew Murray: 8/14 F/O"`-style lines, causing `psIdx` to drift out of sync with `block.playerStats`. |
| 16:08 | 1    | Darth 😈⚡  | 🔧 Eliminated parallel-walk: added `playerStatTeamHints: (string \| null)[]` to `ParsedSummariesGameBlock`; parser now records the most recent sub-header line as it pushes each stat. Rewrote `assignAndUpsertPlayerStats` to consume hints directly + new exported `partialMatchesTeam(sub, teamName)` helper with three strategies: (1) word-prefix subset aligned at start/end ("Haverford" → "Haverford School"); (2) single-token initials ("PV" → "Perkiomen Valley", "DB" → "Daniel Boone"); (3) leading-initial spelled-out form ("UMoreland" → "Upper Moreland"). PARSER_VERSION → 0.2.3. Added 5 Wave-12 tests (3-block iteration, partial-prefix, suffix-word, initials, NULL_HEADER default-to-home). |
| 16:09 | 1    | Darth 😈⚡  | 🔧 First re-ingest: 1114 → 653 (-41%); +353 stats. Bottleneck moved to score-line probe — `"Notre Dame (NJ) 21 Pennsbury 10"` rejected (parens not allowed in `SCORE_LINE_PROBE_NOCOMMA`/`SCORE_RE_NOCOMMA`); `"Avon Grove 9, West Chester East 8 2OT"` rejected (bare-trailing OT not in `SCORE_RE`). Bishop Shanahan + Notre Dame + Pennsbury merged → Pennsbury sub-header has no in-game team. |
| 16:11 | 1    | Darth 😈⚡  | ✅ Done. Widened all three regexes: optional `(?:\s*\([A-Z]{2,3}\))?` state-suffix on each team in both probes; new ` (\d+)?\s*OT` bare-trailing alt in `SCORE_RE`. PARSER_VERSION → 0.2.4. Re-ingest: anomalies 1114 → **550 (-50.6%)**, players 1697 → 1942, stats 5525 → 6072 (+547). 234/234 ingest tests pass (+4 new scoreLine probe tests, total +9 vs Wave 11 baseline). Typecheck clean across all 4 packages. **DID NOT hit ≤400 target** (got 550). Remaining buckets (top): "sub-header did not match either game team" (261, mostly bare section headers like "Goalie", "CBW FACEOFFS:", or section labels like "Springfield-D" / "WCE" abbreviations not in alias table), "quarter-line team hint did not resolve" (72), "period sum mismatch" (64). To close further: (1) treat bare section-only words ("Goalie", "Notes") as null hint → default to home (~10 anomalies), (2) seed remaining unambiguous abbrevs ("WCE", "Pburg", "PW", "LC", "Solehi") as aliases (~15-30), (3) widen quarter-line resolver with same partial-match helper (~70). Recommend Wave 13 lane. Backups: `data/lacrosse.db.bak-w12-pre-block-fix`, `data/lacrosse.db.bak-w12-pre-probe-widen`. |
