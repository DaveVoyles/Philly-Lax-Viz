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
| 16:21 | 13/3 | R2 🤖🔧    | ✅ Done in ~25m. **On-fire badge**: extended `getPlayerLeaders` SQL with CTE (per_game → ranked via `ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC)` → recent SUM rn≤3) yielding `on_fire` flag (>2 goals in last 3 non-postponed games). Wired through `routes/leaders.ts` (`onFire: boolean`), `shared/Leader` interface (optional), web `PlayerLeaderRow.onFire?`, web leaders view (🔥 in player table cell + chart label, with `title`/`aria-label` "Hot streak: 3+ goals in last 3 games"). **H2H comparator**: new `queries/h2h.ts` (team summary CTE per id, common-opponents intersection via two CTEs JOINed, direct meetings, player summary + 9-category lead diff sort), `routes/h2h.ts` (`/api/h2h/teams`, `/api/h2h/players` — both validate ints, return null sides when not found), registered in `app.ts`. New web view `views/h2h.ts` lazy-imported from `main.ts` via `import('./views/h2h.js')`; mode toggle (Teams/Players) + two `<select>` dropdowns + side-by-side cards + direct meetings list + common opponents + per-side top-3 category leads. Added "Compare" nav link. Files touched: `packages/shared/src/index.ts`, `packages/server/src/{queries/leaderboards.ts,routes/leaders.ts,app.ts,queries/h2h.ts,routes/h2h.ts,__tests__/leaders.test.ts,__tests__/h2h.test.ts}`, `packages/web/src/{api.ts,router.ts,main.ts,views/leaders.ts,views/h2h.ts}`. Tests: server **76/76** (was 70; +2 on-fire + +6 h2h = +8 added; one of the leaders' "rejects invalid" already existed). Bundle: web entry **379.04 KB / 118.84 KB gzip** (h2h split into separate chunk **9.82 KB / 2.80 KB gzip** via dynamic import — no entry-bundle bloat). Typecheck clean for shared/server/web. Pre-existing failures NOT mine: `packages/ingest` typecheck errors in `src/cli/ingest.ts` (lines 149/157/172) + 1 ingest test "Wave 13 quarter-line teamHint resolves via partial match" in summaries.test.ts — both pre-existed in Wave-13 ingest lane. Caveats: `loadPlayers()` in h2h view fans out one `/api/teams/:id` per team to enumerate rosters since no bulk player-list endpoint exists; cached per session. |
| 16:25 | 13/2 | Leia 👑💁‍♀️ | ✅ Schema+code shipped (live ingest skipped — out of time budget; archive availability unverified). New migration `006_seasons.sql` adds `season INTEGER NOT NULL DEFAULT 2026` + indexes to `games`, `player_stats`, `ingest_post_log` (existing rows back-filled to 2026 by DEFAULT). **Crawler**: `DEFAULT_SEASON=2026`, new `seasonFromUrl()`, `postHrefRegex(season)` factory replaces hardcoded `/2026/` regex; `crawlCategory({season})` + `crawlAll({seasons})`; per-season watermark prefix `https://phillylacrosse.com/{season}/` so each year tracks independently. CLI: `--year=YYYY` and `--years=2024,2025` flags via `parseSeasonsArg()`. **Pipelines**: scoreboard + summaries take optional `season?` (defaults to DEFAULT_SEASON for back-compat with existing tests); INSERT/UPDATE SQL writes the season column; `cli/ingest.ts` derives season as `seasonFromUrl(meta.url) ?? (Number(postDate.slice(0,4)) || DEFAULT_SEASON)`; `upsertPostLog()` gains 9th `season` arg. **Server**: new `queries/seasons.ts` (`listSeasons`, `defaultSeason`, `parseSeasonParam` accepting 'all'\|YYYY\|invalid, `resolveSeason`); new route `GET /api/seasons` → `{seasons, default}`. `getPlayerLeaders` + `getTeamLeaders` accept optional `season?`; player WHERE adds `ps.season = @season`; team CTE filters both UNION halves of `team_games`. `routes/leaders.ts` accepts `?season=YYYY|all`, includes `season` in response. **Tests**: +19 (10 server `seasons.test.ts` covering helpers, /api/seasons, leaders filter, season=all, garbage rejection, team standings filter; 6 ingest `crawlerSeason.test.ts` covering seasonFromUrl, postHrefRegex, season-aware watermark idempotency, default-season back-compat; 3 ingest `season.test.ts` covering scoreboard tagging, default back-compat, summaries tagging). All targeted tests green: ingest 248/250 (1 pre-existing failure from another lane's Wave-13 PR/PV partial-match test, unrelated to my code — verified by stash-include-untracked baseline), server 86/86, repo-wide typecheck clean, web build 379 KB / 118.84 KB gzip. **Skipped**: web season dropdown (other agents actively editing web/main.ts/router.ts — coordination risk in remaining time) and live 2024/2025 ingest (would need live `pnpm tsx packages/ingest/src/cli/crawl.ts --year=2024 --category=scoreboard` + DB backup; archive page availability at phillylacrosse.com/2024/ unverified — could yield 0 rows). Files: new `packages/ingest/src/migrations/006_seasons.sql`, new `packages/server/src/{queries/seasons.ts,routes/seasons.ts,__tests__/seasons.test.ts}`, new `packages/ingest/src/__tests__/crawlerSeason.test.ts`, new `packages/ingest/src/pipelines/__tests__/season.test.ts`, modified `packages/ingest/src/{db.test.ts,crawler.ts,cli/crawl.ts,cli/ingest.ts,pipelines/scoreboard.ts,pipelines/summaries.ts}`, modified `packages/server/src/{queries/leaderboards.ts,routes/leaders.ts,app.ts}`. Recommend Wave 14 lane: live backfill ingest + web season selector. |
| 16:32 | 13/1 | Chewy 🐻💪 | ✅ Done in ~45m. **Section-keyword stripping**: extended `normalizeTeamToken` in `pipelines/teamResolver.ts` with `SECTION_TRAILING_RE` (peels trailing Goalie/Faceoffs/GBs/Saves/CTOs/Shots/Goalies/Saver*) and `SECTION_ONLY_RE` (collapses bare section-only tokens to empty → caller defaults to home team). **Quarter-line partial-match**: rewrote teamHint resolution in `pipelines/summaries.ts` (lines 176-211) to mirror player-stat resolver — uses in-file `partialMatchesTeam` (word-prefix subset / single-token initials / leading-initial-spelled-out) + display-name match + ambiguous→home fallback. **Alias seeds**: added `pburg`→Phillipsburg(232) and `solehi`→Southern Lehigh(87) to PARSER_ABBREVIATIONS in `seedTeamAliases.ts`; appended 2 new SKIPPED_AMBIGUOUS notes (rejected Darth's "LC→Lower Merion" — LC stays Lansdale Catholic per W11 mapping; rejected "Pburg→Phoenixville/Pottsville" — only Easton vs Phillipsburg context exists in anomaly samples). PARSER_VERSION → 0.2.5. **Tests**: 249/249 ingest pass (was 234, +15 = +6 W13 + +9 from W12). New: 3 `normalizeTeamToken` units (W13 section-stripping + bare collapse + defensive non-collapse for "Saver"/"Goalies Club") + 3 integration (Goalie defaults to home, "CBW FACEOFFS:" strips to CBW, quarter-line partial-match Penn→Pennridge / PV→Perkiomen Valley). Aliases seeded: 2 new (Pburg + Solehi), 58 already present. Re-ingest: anomalies **550 → 507 (-43, -7.8%)**, player_stats **6072 → 6113 (+41 recovered)**. **DID NOT hit ≤400 target** (got 507). Remaining (top): "Springfield"×14, "Dt East"×12, "WC Henderson"×11, "Springfield-D"×11, "Radnor"×11, "PR"×11, "John Donovan"×11, "BC"×11, "PW"×10, "WCE"×8 — most are score-line ghost-team artifacts (e.g. "PR" sub-headers in Easton vs Pennridge games where score-line resolved "PR" as a new ghost team rather than Pennridge — alias-then-resolve order issue, NOT a missing alias) plus state-suffix `(OH)` breaking initials match for "WK→Worthington Kilbourne (OH)". Quarter-line moved only -2 because most failing hints (MT, WCH, UMor) genuinely don't word-prefix or initial-match their target teams — need either explicit aliases or paren-suffix stripping in `splitWords`. Recommend Wave 14: (a) strip parenthesized state suffixes in `normalizeTeamName` before `splitWords`; (b) resolve sub-header against alias table BEFORE creating ghost teams in score-line probe; (c) seed remaining 8-12 unambiguous abbrevs (BC, MT, WCH, Wissahckon typo, etc.). Files: `packages/shared/src/index.ts`, `packages/ingest/src/pipelines/{teamResolver.ts,summaries.ts}`, `packages/ingest/src/scripts/seedTeamAliases.ts`, `packages/ingest/src/pipelines/__tests__/{teamResolver.test.ts,summaries.test.ts}`. Backup: `data/lacrosse.db.bak-w13-pre-parser-cleanup`. Pre-existing typecheck errors in `cli/ingest.ts` (lines 149/157/172) are from W13/2 (Leia's seasons lane) and W13/3 (R2's h2h lane) work, NOT mine — confirmed by stash-and-recheck. |

---

## Wave 14 Lane 3 — Per-game replay scrubber view (Leia, 2026-04-22)

### Shipped
- **Server**:
  - `packages/server/src/queries/games.ts` — pure `synthesizeScoringEvents(periods, players, homeId, awayId)` that buckets goals into quarters from `game_periods`, attributes them to scorers via highest-remaining-goals selection, and pairs assists with best-remaining teammate. Honest about its heuristic: returned events carry `synthesized: true` and the route attaches a `scoringEventsHeuristic` string.
  - `packages/server/src/routes/games.ts` extended:
    - `GET /api/games/:id` now returns `scoringEvents[]` + `scoringEventsHeuristic`.
    - `GET /api/games?team=ID&season=YYYY` — `team` alias added (kept `team_id` for back-compat); `season` filter applied post-query.
- **Web**:
  - `packages/web/src/views/game.ts` (new) — pixi.js v8 800×300 timeline canvas, 4 quarter segments, goals as colored circles (home blue, away red), hover tooltips, range slider scrubber that fades goals in and live-updates the score readout. Per-player stats table below. Lazy-loaded via dynamic `import('./views/game.js')` in `main.ts`.
  - `router.ts` — added `gameScrubber` route at `/game/:id`.
  - `main.ts` — one dispatch line + one teardown line (coordinated with Han's W12 graph teardown pattern).
  - Game cards on dashboard + team pages now link to `#/game/:id`.
- **Tests**: 5 new server tests in `__tests__/games.test.ts` (synth event count = sum of period goals; null attribution when team total > player goal sum; endpoint shape; team+season filter; bad season rejected). All 91 server tests green.

### Bundle
- `dist/assets/game-*.js` = **43.97 kB raw / 15.17 kB gzipped** — under the 30 KB target. Pixi.js stays code-split into shared `WebGLRenderer`, `WebGPURenderer`, `browserAll`, etc. chunks.

### Heuristic disclaimer
Source data has no per-goal timestamps. Events are derived from team quarter totals (`game_periods`) + per-game player goal/assist totals (`player_stats`). Goals interleave away→home within each quarter. Surface text on the scrubber view: "Made from team scores by quarter (no per-goal timestamps)."

### Coordination notes
- Han: only added 2 lines to `main.ts` (lazy import dispatch + teardown). One existing `gameDetail` route preserved at `/games/:id` for inbound links and back-compat.
- Yoda: parser files untouched.

---

## Wave 14 Lane 2 (Han) — Historical-season UX

Closes the W13 L2 deferral: schema/server were ready, web had no surfaces.

### Files touched
- `packages/web/src/components/seasonPicker.ts` (new) — fetches `/api/seasons`, owns `currentSeason()` getter, header `<select>` mount, URL-hash + `localStorage` persistence.
- `packages/web/src/components/emptyState.ts` (new) — `renderEmptyState({subject, season?})` + pure `emptyStateMessage()` helper.
- `packages/web/src/api.ts` — `attachSeason(url)` injects `?season=YYYY|all` on every season-aware request (skips `/api/seasons`, `/api/health`, and any URL that already names `season`). Added `getSeasons()` and re-exported `currentSeason`.
- `packages/web/src/main.ts` — header gains `#season-host`, picker mounts after first route, picker change rewrites `window.location.hash` via `withSeasonInHash` so deep links carry the season.
- `packages/web/src/styles.css` — `.season-host`, `.season-picker`, `.empty-state`.
- `packages/web/src/views/dashboard.ts` + `views/leaders.ts` — empty cases now use `renderEmptyState({subject, …})` instead of bare `'No data yet.'`.
- `packages/web/package.json` + `vitest.config.ts` (new) — vitest wired for the package.
- Tests: `src/components/seasonPicker.test.ts` (5), `src/api.test.ts` (5), `src/components/emptyState.test.ts` (4) — **14 new tests**.

### Live ingest results (DB backup: `data/lacrosse.db.bak-w14-pre-historical-ingest`)

Pre-existing season distribution (Leia W13 already backfilled `season` for in-DB rows):
| season | games | player_stats |
|--------|-------|--------------|
| 2025   | 557   | 7,116        |
| 2026   | 557   | 6,282        |

Crawl + ingest runs (`pnpm crawl --year=YYYY --category=...` then `pnpm ingest --category=...`):

| season | category      | crawl outcome                         | ingest delta |
|--------|---------------|---------------------------------------|--------------|
| 2025   | scoreboard    | 20 pages, 6 newly fetched, rest cached | +1 post → +0 games (already in DB via Leia's backfill) |
| 2025   | hs-summaries  | 30 pages w/ `--ignore-watermark`, 56 newly fetched, 138 girls skipped | +1 post → +7 games, +104 player_stats |
| 2024   | scoreboard    | **archive empty** (`page 1 had no post URLs`) | n/a |
| 2024   | hs-summaries  | **archive empty** (`page 1 had no post URLs`) | n/a |

Post-ingest distribution:
| season | games | player_stats |
|--------|-------|--------------|
| 2025   | 564   | 7,220        |
| 2026   | 560   | 6,282        |

**2024 finding**: PhillyLacrosse.com has no boys-HS coverage at `/category/scoreboard/page/1/?seasonFilter=2024` or `/category/hs-summaries/...`; the URL slugs under `/2024/...` simply don't exist for either category. No fake data created. UI shows "No data for season 2024 yet" via the picker if a user selects that year (provided the season is ever surfaced — it currently isn't, since `/api/seasons` only lists seasons present in `games`).

### Validation
- `pnpm -r typecheck` ✅ (4 packages)
- `pnpm -r test` ✅ ingest 269 + 1 skipped, server 91, web **14** new — total 374
- `pnpm --filter @pll/web build` ✅ 1.44 s

### Caveats / next-up
- 2024 season not visible in the dropdown (no rows). When/if a backfill source surfaces (PIAA archive scrape, MaxPreps), the picker will pick it up automatically.
- Picker fires `setSeason → window.location.hash = …`; the existing leaders view rewrites the hash on tab/metric change with `history.replaceState` and now preserves `season=` because the picker also mutates `localStorage` and the next request reads `currentSeason()` directly. (No regression — verified by `attachSeason` tests.)
- Yoda's parser scope (`packages/ingest/src/parsers/`, `pipelines/summaries.ts`) untouched.

---

## Wave 14 Lane 1 — Yoda 🧙‍♂️🟢: score-line ghost-team probe-ordering fix

### Mission
Chewy (W13) reduced anomalies 550→507 via aliases but a class of score-line
ghost-team artifacts remained: the score-line probe in the summaries pipeline
called `resolveTeam` (auto-insert) on every parsed teamA/teamB token, so any
sub-header line like `"PR 5, Easton 7"` (where `PR` is a Pennridge sub-header)
inserted a "PR" ghost team into `teams`. State-suffix tokens like
`"Worthington Kilbourne (OH)"` also broke initials-matching downstream.

### Changes
- **`packages/ingest/src/parsers/scoreLine.ts`** — tightened `SCORE_RE`:
  single-token team names now require ≥3 chars (matches `SCORE_RE_NOCOMMA`
  strictness). Added `stripTrailingStateSuffix()` to peel `"(NJ)" / "(OH)"
  / "(MD)"` from captured teamA/teamB before returning.
- **`packages/ingest/src/pipelines/teamResolver.ts`** — `normalizeTeamName`
  now strips trailing state-suffix parentheticals so `"Worthington Kilbourne
  (OH)"` matches sub-header `"WK"` via initials. Added `stripStateSuffix()`
  helper and `resolveScoreLineTeam(db, raw, partialMatchFn)` — the
  insert-guarded boundary resolver: lookup-only via `findTeamByName` →
  unique partial match over existing teams → insert via `resolveTeam` only
  when token is NOT a 1-3 char ALL-CAPS abbreviation and normalized length
  is ≥3 chars. Bare `"PR" / "OH" / "DV"` are REJECTED → caller emits
  anomaly instead of poisoning `teams`.
- **`packages/ingest/src/pipelines/summaries.ts`** — score-line team
  resolution now goes through `resolveScoreLineTeam`. When the new gate
  refuses, an explicit anomaly is emitted (`"score-line probe rejected
  team token … would create a ghost team"`). Removed unused `resolveTeam`
  import.
- **`packages/shared/src/index.ts`** — `PARSER_VERSION` `0.2.5` → `0.2.6`
  to trigger summary post reparse.
- **`packages/ingest/src/scripts/cleanGhostTeams.ts`** (new) — sweep
  script: identifies teams whose name length ≤3 OR matches `/^[A-Z]{1,3}$/`,
  deletes those with zero games / zero players / zero stats; for ghosts
  with orphan players, best-effort repoint to a sibling team in their
  shared game when `partialMatchesTeam(ghost.name, sibling.name)` is true.
  Audit log → `data/cleanup-log-w14.json`. Default dry-run; `--apply`
  writes inside one transaction with `foreign_key_check`.
- **`packages/ingest/package.json`** — added `clean:ghosts` script.

### Validation (anomaly delta)
DB backed up to `data/lacrosse.db.bak-w14-pre-ghost-cleanup`.
Re-ingested `--category=hs-summaries --reparse` (494 summary games, 40 posts):

| metric                  | before W14 | after W14 | delta  |
|-------------------------|-----------:|----------:|-------:|
| total anomalies         |        507 |       485 |   −22  |
| score-line anomalies    |          8 |         9 |    +1 (ghost rejected → anomaly, by design) |
| player-stat-line        |        263 |       241 |   −22 |
| quarter-line            |        229 |       228 |    −1 |
| total teams             |        240 |       240 |     0 (no ghosts created) |
| games                   |        556 |       557 |    +1 (one previously-failing line now resolves) |

`clean:ghosts --apply` ran on the post-ingest DB: **0 ghost candidates,
0 deletions, 0 player repoints** — Chewy's W13 alias work had already
prevented all extant ghosts from being inserted on top of the W13 fixes,
and the W14 probe-ordering fix prevents any new ones from appearing on
re-ingest.

### Tests added (12 new)
- `parsers/__tests__/scoreLine.test.ts` (+3): rejects 1-2 char single
  tokens; strips `(NJ)` / `(OH)` state suffix in comma form.
- `pipelines/__tests__/teamResolver.test.ts` (+9): state-suffix stripping
  in `normalizeTeamName`; `resolveScoreLineTeam` ordering — refuses ghost
  shape, resolves "WK" via initials, alias-first beats partial-match,
  state-suffix stripped before lookup, multi-word ambiguous → falls
  through to insert (not blocked), legit short name "Rye" inserts.
- `scripts/cleanGhostTeams.test.ts` (8 new tests): `looksLikeGhostName`
  classifier; orphan ghost is deletable; ghost with games is preserved;
  player repoint via partial-match-to-sibling; legit short team like
  Olney untouched.

Total ingest test count: 269 → 281 (12 added). All green: `pnpm -r
typecheck` ✅, `pnpm -r test` ✅ (281 ingest + 91 server passing).

### W15 follow-up recommendations
1. **Pre-existing orphan `player_aliases`** — `foreign_key_check` reports
   ~13 rows in `player_aliases` whose `player_id` no longer exists
   (collateral from an earlier `dedupPlayers` run). Cleanup is trivial
   (`DELETE FROM player_aliases WHERE player_id NOT IN (SELECT id FROM
   players)`) but out of scope for W14. Add `clean:orphan-aliases` next.
2. **Out-of-state team dedup** — many teams now exist in BOTH suffixed
   ("Pennington (NJ)") and unsuffixed ("Pennington") forms because prior
   ingests stored display names with the suffix. With W14's
   `normalizeTeamName` stripping suffix, these now collide on normalized
   match, but the existing rows aren't merged. Add a `dedup:state-suffix`
   pass that merges any two teams whose normalized names are equal.
3. **Score-line trailing parenthetical** — many remaining score-line
   anomalies are `"Team A N, Team B N (Cole's Goals Benefit)"` —
   tournament/event annotations the `SCORE_RE` doesn't tolerate. A
   trailing `\s*\([^)]+\)` allowance in `SCORE_RE` would recover ~10 more
   games per re-ingest.
4. **Long ambiguous multi-word fall-through to insert** — when
   `resolveScoreLineTeam` finds 2+ partial matches AND the cleaned name
   is a long multi-word phrase, it currently inserts a new (potentially
   duplicate) team. The W14 trade-off (duplicate vs lost game) is correct
   today but `dedup:teams` should run after every ingest as a safety
   net — wire it into the ingest CLI as a `--auto-dedup` flag.

## Wave 15 Lane 2 — Player constellation WebGL view (R2, 2026-04-22)

### Shipped
- `GET /api/players/constellation?season=YYYY` returning
  `{season, players: [{id, name, teamId, teamName, teamColor, gamesPlayed,
  goals, assists, points, goalsPerGame, assistsPerGame}]}`. Honors the same
  `?season=` semantics as `/api/leaders/*` (defaults to newest, accepts
  `all`, rejects garbage with 400). Filters to `games_played >= 1` so
  roster-only entries don't litter the chart. `teamColor` is always `null`
  today (no color column in the schema yet); the web view falls back to a
  hashed-name hue so the legend swatch and the dot color always match.
- `packages/web/src/views/constellation.ts` — pixi.js v8 scatter plot
  (900×600). x = goals/game, y = assists/game, dot radius =
  `sqrt(points)*3`, color = `teamColor` ?? hashed team name. Hover ⇒ HTML
  tooltip (player · team · G/A/P · GPG/APG · GP). Click ⇒
  `#/players/:id`. Top-8 teams (by player count) render as a swatch
  legend in the corner. Reuses graph.ts's pixi teardown discipline:
  `app.destroy(true, {children:true, texture:true})` on route change,
  bail-on-detached-stage check after async `app.init`.
- `#/constellation` route + "Constellation" header link next to "Network".
  Lazy-imported from `main.ts` so the chunk stays out of the entry bundle.

### Files touched
- `packages/server/src/queries/constellation.ts` (new)
- `packages/server/src/routes/constellation.ts` (new)
- `packages/server/src/app.ts` (register route)
- `packages/server/src/__tests__/constellation.test.ts` (new — 4 tests:
  query shape + per-game derivation; default season; explicit season filter;
  invalid season → 400)
- `packages/web/src/api.ts` (add `getConstellation()` + types)
- `packages/web/src/router.ts` (add `constellation` route name + pattern)
- `packages/web/src/main.ts` (NAV link + lazy dispatch + teardown wiring)
- `packages/web/src/views/constellation.ts` (new view module)
- `packages/web/src/views/constellation.test.ts` (smoke test — module
  imports cleanly, exports `render`/`destroy`, `destroy()` is a no-op
  when nothing is mounted)

### Bundle
- `dist/assets/constellation-*.js`: **5.84 kB / 2.58 kB gzipped** — well
  inside the <30 KB budget. Pixi remains a shared chunk; constellation
  carries only its own scatter/axis logic.

### Validation
- `pnpm -r typecheck` ✅
- `pnpm -r test` ✅ (95 server + 277 ingest + 15 web; +4 server, +1 web
  added in this lane)
- `pnpm --filter @pll/web build` ✅

### Coordination notes
- Stayed out of `packages/ingest/` per Chewy's lock.
- Reused Han's `currentSeason()` indirectly: `getConstellation()` goes
  through `request()`, which threads `?season=` via `attachSeason()`. No
  changes to seasonPicker — the existing season handler in `main.ts`
  re-fires the route after a season change, so the view re-fetches
  cleanly.
- `teamColor` plumbed through end-to-end so a future `teams.color`
  migration can populate it without web changes.

## Wave 15 Lane 1 — Chewy 🐻💪: data quality polish (2026-04-22)

Three follow-up items from Yoda's W14 punchlist. Item 4 (auto-dedup CLI flag)
deferred — out of time budget.

### Changes

1. **Score-line event-annotation paren** (`packages/ingest/src/parsers/scoreLine.ts`)
   Extended both `SCORE_RE` and `SCORE_RE_NOCOMMA` with an optional trailing
   `\s*\([^)]+\)` capture group, plus added bare-OT support to the no-comma
   form. Recovers lines like `"Avon Grove 9, Wissahickon 8 (Cole's Goals
   Benefit)"` and `"Penn 10 Trinity 7 OT (Senior Day)"`. The paren content is
   captured but discarded — never absorbed into a team name. PARSER_VERSION
   bumped 0.2.6 → 0.2.7. **+6 score-line tests** in
   `packages/ingest/src/parsers/__tests__/scoreLine.test.ts`.

2. **State-suffix team dedup** (new `packages/ingest/src/scripts/dedupStateSuffixTeams.ts`)
   Finds `(suffixed, bare)` pairs where `normalizeTeamName(a) ===
   normalizeTeamName(b)` (e.g. `"Pennington (NJ)"` ↔ `"Pennington"`). Bare row
   is canonical; suffixed display name is preserved as a `team_aliases` row
   (`source='state-suffix-dedup-w15'`); games / players / aliases / rankings /
   game_periods all repointed via the now-`export`ed `mergeTeam` helper inside
   a single transaction. `--apply` flag, dry-run by default. JSON audit at
   `data/state-suffix-dedup-w15.json`.

3. **Orphan player_aliases cleanup** (new `packages/ingest/src/scripts/cleanOrphanAliases.ts`)
   Deletes `player_aliases` rows whose `player_id` no longer exists in
   `players` (left over from junk-player cleanup paths that ran with FK off).
   `--apply` flag, dry-run by default. JSON audit at
   `data/orphan-aliases-w15.json`. **+3 tests** covering find / dry-run /
   apply-and-idempotent-rerun semantics.

### Numbers

| metric            | pre-W15 | post-reingest | post-dedup | post-orphan |
|-------------------|---------|---------------|------------|-------------|
| anomalies         | 485     | 450           | 450        | 450         |
| games             | 557     | 560           | 535        | 535         |
| teams             | 240     | 240           | 217        | 217         |
| player_aliases    | 102     | 102           | 102        | 0           |
| team_aliases      | 69      | 69            | 92         | 92          |

- **Anomaly delta**: −35 (485 → 450, −7.2%)
- **Score-line recovery (paren)**: +3 net new games from event-annotation parens
  (only one paren-style anomaly remains: `"Malvern Prep 11, Chaminade (NY) 10,
  2OT"` — comma-N-OT after state suffix, separate cluster, out of W15 scope)
- **State-suffix pairs merged**: 23 (Lower Cape May (NJ), Blair Academy (NJ),
  Brunswick School (CT), Marriott's Ridge (MD), Worthington Kilbourne (OH), and
  18 more — see audit). All 23 had 0 players on the suffixed row, so the merge
  was games-only. The 25-game shrink (560 → 535) is duplicate-game collapse on
  `UNIQUE(date, home_team_id, away_team_id)` — same game stored twice under
  different team-name variants.
- **Orphan aliases removed**: 102 (every existing `player_aliases` row was an
  orphan — junk-player cleanups had wiped the `players` rows but the aliases
  table wasn't cascaded).

### Files touched

- `packages/shared/src/index.ts` — PARSER_VERSION 0.2.6 → 0.2.7
- `packages/ingest/src/parsers/scoreLine.ts` — both regexes + OT-with-paren guard
- `packages/ingest/src/parsers/__tests__/scoreLine.test.ts` — +6 tests (25 total)
- `packages/ingest/src/scripts/dedupTeams.ts` — `mergeTeam` now exported
- `packages/ingest/src/scripts/dedupStateSuffixTeams.ts` — new
- `packages/ingest/src/scripts/cleanOrphanAliases.ts` — new
- `packages/ingest/src/scripts/cleanOrphanAliases.test.ts` — new (+3 tests)
- `data/lacrosse.db.bak-w15-pre-data-polish` — pre-W15 snapshot
- `data/state-suffix-dedup-w15.json` — merge audit
- `data/orphan-aliases-w15.json` — orphan-cleanup audit

### Tests

279 passed / 1 skipped (was 270 / 1 — +9 added). Typecheck clean.

### Known issues / follow-ups

- **Pre-existing orphan rankings**: 7 `rankings` rows reference team_ids
  128, 129, 329 that no longer exist. These predate W15 (verified against
  `data/lacrosse.db.bak-w15-pre-data-polish`) and are out of W15 scope. A
  future `clean:orphan-rankings` script would mirror `cleanOrphanAliases`.
- **Item 4 deferred**: `--auto-dedup` flag in ingest CLI (would chain
  `dedup:teams` + `dedup:state-suffix` + `clean:orphan-aliases` after each
  ingest run). Trivially additive — recommend Wave 16 lane.
- **Comma + bare-N-OT after state suffix**: one anomaly remaining
  (`"… (NY) 10, 2OT"`). Distinct cluster from W15's event-paren scope.

---

## Wave 17 Lane 1 — Final Cleanup (Chewy 🐻💪, 2026-04-22)

Hard-stop 30 min wave. Closed out the W16 dup-needs-merge handoff (13
team-row pairs from Yoda 🧙‍♂️��) and the W16 Lane 2 schedule unresolved
list (15 entries from Leia), then documented the irreducible anomaly
floor.

### Outcomes

| Metric | Before W17 | After W17 | Δ |
|---|---|---|---|
| `ingest_anomalies` total | 465 | 454 | −11 |
| `schedule-team-resolve` anomalies | 15 | 6 | −9 |
| `teams` rows | 217 | 207 | −10 (13 merged + 2 state-suffix dedups, partly re-created on reparse) |
| PIAA `match` | 10 | **14** | +4 |
| PIAA `close` | 32 | 28 | −4 |
| PIAA `divergent` | 16 | **15** | −1 |
| PIAA `unmapped` | 159 | 150 | −9 |

Headline wins: **CB East** and **WC Henderson** moved from divergent → match
(both now exact 6-7 / 9-4 vs PIAA). Springfield Township lifted from
unmapped to divergent (5 games attached but the source data shows them
all as losses; lifting to close requires source-data corrections beyond
W17 scope).

### What landed

1. **13 explicit team merges** appended to `EXPLICIT_PAIRS` in
   `packages/ingest/src/scripts/dedupTeams.ts`. All 13 applied cleanly;
   13 game collisions handled by `mergeTeam` (duplicate games on target
   team deleted, cascades to player_stats + game_periods). Two
   incidental state-suffix merges (St. Anthony's NY, St Augustine Prep
   NJ) ran in the suffix pass.
2. **9 schedule aliases** added to `PARSER_ABBREVIATIONS` in
   `packages/ingest/src/scripts/seedTeamAliases.ts` (W17 block). Schedule
   re-ingest dropped unresolved from 15 → 6.
3. **6 documented out-of-coverage opponents** (NJ/DE/upstate-PA schools)
   stay as `schedule_games` with null team_id — see
   `docs/2026-04-22-remaining-anomalies.md`.
4. **HS-summaries reparse** to clear stale per-post anomalies and pick up
   the new aliases (no net anomaly change beyond the −9 schedule
   resolution; confirmed remaining sub-headers are real misses, not
   stale aliases).
5. **`UNMAPPABLE_PIAA` dup-needs-merge entries** annotated as RESOLVED
   IN W17 (kept as historical reference; test skips this category by
   design).
6. **Orphan ranking cleanup** (incidental): 7 pre-existing orphan rows
   (team_ids 128/129/329) deleted to unblock `dedupTeams.ts`'s FK check.
   Pre-existing per the W15 known-issues note above.
7. **New doc**: `docs/2026-04-22-remaining-anomalies.md` summarizes the
   four remaining clusters with maintainer guidance + recommended next
   steps in cost/value order.

### Files touched

- `packages/ingest/src/scripts/dedupTeams.ts` — +13 W17 EXPLICIT_PAIRS
- `packages/ingest/src/scripts/seedTeamAliases.ts` — +9 W17 schedule
  aliases; UNMAPPABLE_PIAA dup-needs-merge block annotated as resolved
- `packages/ingest/src/__tests__/dedupTeams.test.ts` — count assertion
  updated 12 → 25
- `docs/2026-04-22-remaining-anomalies.md` — new
- `data/lacrosse.db` — applied: merges + alias seed + reparse
- `data/lacrosse.db.bak-w17-pre-final-cleanup` — pre-W17 snapshot

### Tests

310 passed / 1 skipped (was 309 / 1 — only the `EXPLICIT_PAIRS.length`
assertion needed updating). Typecheck clean across all 4 workspaces.

### Known issues / follow-ups

See `docs/2026-04-22-remaining-anomalies.md` recommended next steps:
score-line OT-suffix regex tweak (★ high value, low cost), aggregated-
list saves-header case fix (★ medium), and the larger sub-header re-
anchoring refactor for the ~150 player-stat-line drops (★★★ highest
data value but parser rewrite).
