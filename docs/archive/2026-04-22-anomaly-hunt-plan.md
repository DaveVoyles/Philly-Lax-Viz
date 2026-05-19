# Anomaly Hunt Fleet — beyond stat-cap

**Date:** 2026-04-22
**Trigger:** User noticed Sullivan 174g (parser bug from "(Set School record 173 Goals)"). Hard caps + backfill landed in v8. Now sweep the rest of the DB for similar lurking issues.

---

## Goal

Find every remaining data anomaly we can detect with reasonable signal-to-noise and either fix it (delete/clamp/re-attribute) or surface it as a known anomaly. End state: zero rows where a per-game stat exceeds plausibility, zero player-name garbage, zero misattributed players, and a reusable audit script that can be re-run after every ingest.

## What we already know (probe results from `data/lacrosse.db`, schema v12)

| Check                                                  | Hits | Example                                                                                  |
| ------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------- |
| Individual player goals > their team's score that game | 3    | "Bonner-Prendergast" players show 1–3g in a 0–15 loss → wrong-team attribution           |
| Σ team's player goals > team_score + 3                 | 3    | (likely the same 3 above, plus possibly others)                                          |
| Goalie pattern (saves ≥5 AND goals ≥5)                 | 0    | clean for now; Thompson "19 goals against" was caught & fixed by v8 cap                  |
| Single-token player names with stats                   | 2    | "Fry", "Ray" — partial-name leftovers                                                    |
| Stat-word player names                                 | 1    | one of: Goals/Assists/Saves/Coach/Team/Stats                                             |
| Player names with trailing punct (`:` `;` `,`)         | 0    | fixed in v8 backfill (136 cleaned)                                                       |
| `stat-cap-exceeded` anomalies in `ingest_anomalies`    | 3    | Sullivan/Shohen/Thompson — landed in v8                                                  |

PhillyLacrosse search for "records" / "highest" / "career" returns mostly **girls + college** articles plus one daily summary. There is **no dedicated records page** to scrape. The real risk surface is the daily summary posts where milestones are narrated in parentheticals.

## Wave plan

### Wave 1 — Discovery (3 parallel lanes, all independent)

| Lane | Fleet           | Effort | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                  | Blocked by | Checkpoint |
| ---- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1    | Han 😉🚀        | M      | **Cross-validation audit (`auditCrossChecks.ts`)**. Adds a script that runs all of: (a) player_goals > team_game_score, (b) Σplayer_goals > team_score+3, (c) goalie pattern (saves≥5 AND goals≥5), (d) name in stat-word blacklist, (e) name <3 chars with stats, (f) season totals where one player ≥ 50% of team's season goals. Writes findings to `ingest_anomalies` with new strategies `cross-check-*`. Idempotent. Tested.     | —          | 10m        |
| 2    | Yoda 👽✨       | M      | **Re-scan summaries for tainted rows (`scanCareerProse.ts`)**. Iterate every 2026 summary post in `raw_cache_meta` (or re-fetch if missing). For each player-stat line, flag if it contains a parenthetical matching the broader prose set: `\b(career\|season\|school record\|state record\|all[- ]?time\|milestone\|now has\|on (his\|her\|the) (career\|season))\b`. Emit report listing player_id + game_id + raw line + suggested clamp. Does NOT mutate. | —          | 10m        |
| 3    | Leia 👑💁‍♀️    | S      | **Source recon**. (a) Confirm phillylacrosse has no records/leaders endpoint worth parsing (already 80% done — confirm). (b) Probe LaxNumbers for any player-stats endpoint beyond scoreboard/3453. (c) Document findings in `docs/data-sources.md`. (d) Sanity-check: visit 5 random `Sources → recap_url` pages and verify our DB matches.                                                                                          | —          | 8m         |

Wave 1 critical path: Lane 1 + Lane 2 (M, ~10m). Lane 3 is S so will finish first; rebalance window if needed.

### Wave 2 — Remediation + Surface (size depends on Wave 1 output)

After Wave 1 lands, orchestrator inspects the audit + scan reports and decides:

| Branch                                  | Lane plan                                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave 1 finds < 20 issues                | Single lane (M): apply fixes manually + add UI badge on `/players/:id` for any `ingest_anomalies` row mentioning the player                                                                                          |
| Wave 1 finds 20–100 issues              | 2 lanes parallel: (a) batch fix script, (b) UI surface. M each.                                                                                                                                                      |
| Wave 1 finds 100+ issues or systemic    | 3 lanes: (a) parser hardening pass (additional tests + tighter prose regex), (b) bulk fix + re-ingest of affected posts, (c) UI badge + dashboard counter on `/sources`. M each. Then Wave 3 to deploy + verify.    |

### Wave 3 — Deploy + Verify (orchestrator solo, M)

1. WAL-flush + VACUUM `data/lacrosse.db`
2. Build `:v9`, push to ACR
3. `az containerapp update --revision-suffix v9`
4. Rebuild web bundle + SWA deploy
5. Curl-verify: `/api/health` schemaVersion = 12 (or 13 if a migration), `/api/anomalies?limit=500` includes the new `cross-check-*` entries, sample 3 player pages confirm no regression
6. Push commits to both git remotes
7. Update `.github/docs/2026-04-22-cleanup-and-laxnumbers-plan.md` with retrospective

## Anomaly classes targeted

| Class                            | Detection                                                                | Action                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Stat-cap exceeded                | Already done in v8 (per-stat caps in parser + backfill)                  | Already clamped + logged                                                                |
| Career-milestone bleed-through   | Wave 1 Lane 2 — re-scan summary posts for prose parentheticals           | Clamp affected stats; log as `career-prose-bleed`                                        |
| Goalie misclassification         | saves ≥5 AND goals ≥5 (Thompson "19 goals against" pattern)              | Set goals=0 if saves dominate; log as `goalie-misclassified`                            |
| Wrong-team attribution           | player.team_id mismatch with team that scored those goals                | Need recap re-parse to fix; log as `team-mismatch` for now                              |
| Garbage names                    | Single-token, length <3, or stat-word literals                           | Merge into nearest plausible alias OR delete if clearly junk                            |
| Internal inconsistency           | Σplayer_goals(team, game) ≫ team_score                                   | Log as `team-total-mismatch`; root-cause case by case                                   |
| Implausible season concentration | Player season goals > 50% of team season goals AND > 30 goals            | Log as `season-concentration`; sanity check vs recap                                    |

## Done-when criteria (for each Wave 1 lane)

- **Lane 1 (Han)**: `auditCrossChecks.ts` exists, has tests, can be run dry/apply, produces a count summary, inserts new `cross-check-*` rows into `ingest_anomalies` only on `--apply`.
- **Lane 2 (Yoda)**: Report file `data/anomaly-scan-report.json` written with one entry per suspected tainted row (player_id, game_id, raw_line, parenthetical_match, suggested_action).
- **Lane 3 (Leia)**: `docs/data-sources.md` updated with findings; either confirmed "no other sources worth scraping" or proposes a follow-up wave.

## Risk / scope guardrails (locked at pre-flight)

- **No team additions.** Same as Wave 18 — additive ingest only.
- **No schema changes** unless a new `ingest_anomalies` strategy literal needs typing in `shared/index.ts`. That's a 1-line add, not a migration.
- **No re-attribution of historical games** in this fleet. If a wrong-team-attribution issue is found, log it; don't auto-reassign player.team_id (high blast radius).
- **No public re-fetch storms.** Lane 2 reads `raw_cache_meta` first; only re-fetches missing posts (rate limit: ≤1 req/sec).

## Communication log

| Time  | Lane | Fleet | Update |
| ----- | ---- | ----- | ------ |
| 5min  | 2    | Yoda 👽✨ | 🔍 Cache structure mapped — 89 boys-summary HTML files in data/raw-cache, 103 raw_cache_meta rows. Spot-check confirms TONS of suspect parentheticals: "100 goals on his career", "200 career points passed DiBattista as O'Hara's all-time leader", "Unionville All Time Career Goals Record Broken (185th career goal)". Building scanner now. |
| 10min | 2    | Yoda 👽✨ | ✅ Scanner built + typechecks. First run: 39 boys-summary posts, 18 suspect lines, **0 parsed-and-suspect**, 15 parsed-and-clean, 3 not-parsed. v8's PROSE_MARKERS list cleanly stripped EVERY case (Sullivan 173, Shohen 100-on-career, Kupsey 185th, Crowley 200-passed-DiBattista, Cox tied-school-record). Report at `.github/docs/2026-04-22-prose-scan-report.json`. |
| done  | 2    | Yoda 👽✨ | 🎯 Lane 2 complete. ⚠️ Real gap surfaced: text.ts MISSES bare ordinal-milestones like "(100th Point)" — Cole Tinsley case parsed clean only because of `point` neighborhood. Recommended new markers: `\d+(?:st\|nd\|rd\|th)\s+(?:career\|point\|goal\|save\|assist)`, `\bprogram record\b`, `\btied\b`, bare `\brecord\b`, `\bleader(?:s)?\b`. See final response for full list. |
| 5min  | 3    | Leia 👑💁‍♀️ | 🔍 Live `/api/health` healthy (schemaV12, 617 anomalies). Sullivan 48816 confirmed 28g/5a, max single-game = 6g ✅. phillylacrosse.com `/category/2026-2/` 404s; homepage + search return only daily summary posts → no records page exists. LaxNumbers exposes `player_stats.php?type=01..35` records pages (Angular-hydrated; XHR backed). |
| done  | 3    | Leia 👑💁‍♀️ | ✅ Recon doc landed at `.github/docs/2026-04-22-source-recon.md`. Top-10 points leaders sanity-checked: Carberry / E.Kostack / Maro spot-checks all max ≤ 6g per game. v8 clamps (Sullivan 174, Shohen 105, Thompson 19) all logged correctly. 📋 Two cheap follow-ups for Wave 2: (a) extend trailing-punct regex to strip `.` (`Finn Petrone.`); (b) consider `/api/leaders` → `/api/leaders/players` alias. 🎯 No new Sullivan-class bug visible in prod — Wave 2 should ride Han + Yoda outputs, not chase a new source. |
| 5min  | 1    | Han 😉🚀 | 🔍 Schema mapped (no `team_games` table — derived team-side via `games.home/away_team_id` + `home/away_score`). `auditCrossChecks.ts` skeleton + 5 detection branches written. |
| 10min | 1    | Han 😉🚀 | 📋 All 337 ingest tests green (327 prior + 10 new). Dry-run executed against `data/lacrosse.db`. |
| done  | 1    | Han 😉🚀 | ✅ Wave 1 Lane 1 complete. Findings: player-exceeds-team=3, sum-exceeds-team=4, suspect-name=3, goalie-as-scorer=0, season-concentration=2 (12 total). Report at `.github/docs/2026-04-22-cross-checks-report.json`. 🎯 Ready for Wave 2 remediation; orchestrator owns `--apply`. |

## Status

- **Pre-flight**: complete (probe ran, baseline counts captured, lane scopes locked)
- **Wave 1**: not yet launched — awaiting `Y` from user to switch out of plan mode
- **Wave 2**: scoped after Wave 1 results
- **Wave 3**: deploy + retrospective
