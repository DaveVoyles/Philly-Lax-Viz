# 2026-04-22 — Cleanup + LaxNumbers backfill plan

## User request

1. **Remove the College Commits feature entirely** (code + DB + UI + ingest).
2. **Lock the app to the current season (2026)** — hide the season picker; ingest only 2026.
3. **Add LaxNumbers as a supplemental data source** (PA-only Boys HS scoreboard, only for teams already in our DB; never expand the team set; additive only — don't overwrite Philly Lacrosse data).
4. **Fix the duplicate "Pierce Merrill"** on `/teams/80` — two player rows: `50907 Peirce Merrill` (canonical) and `51229 Pierce Merill` (transposed letters in both first AND last name; dedup pass missed it).

## Confirmed decisions

- Commits: **delete entirely** (code, migration table, ingest pipeline, UI nav, tests).
- Season: **hide the picker** — single-season UI; everything reads 2026.
- LaxNumbers: **additive only** (fill gaps; never overwrite Philly Lacrosse).
- Existing live deploy: SWA `victorious-pond-...` + ACA `pll-server` already wired and serving traffic; we redeploy after each wave lands.

## Reconnaissance summary

- Commits surface area (delete targets):
  - `packages/ingest/src/migrations/007_commits.sql` (drop in new migration)
  - `packages/ingest/src/parsers/commitsPost.ts` (+ test)
  - `packages/ingest/src/pipelines/commits.ts`
  - `packages/server/src/queries/commits.ts` (+ test)
  - `packages/server/src/routes/commits.ts` + `app.ts` registration
  - `packages/web/src/views/commits.ts`, `components/commitBadge*.ts`
  - References in `playerDetail.ts`, `sources.ts`, `freshness.ts`, `crawler.ts`, `main.ts`, `router.ts`
  - Health/freshness `commitsLast` field
- Season machinery already exists:
  - `crawler.ts` — `DEFAULT_SEASON = 2026`, `--season=` CLI flag
  - `migrations/006_seasons.sql` — `season` column on games / player_stats / ingest_post_log defaults to 2026
  - Server routes (`seasons.ts`, `leaders.ts`, `commits.ts`, `constellation.ts`) call `resolveSeason`
  - Web `components/seasonPicker.ts` is the dropdown to hide; `api.ts` uses `attachSeason` to add `?season=` to every request
- Pierce Merrill duplicate: `dedupPlayers.ts` uses `normalizePlayerName` and a Pattern 7 fuzzy-name pass with Levenshtein. Two-letter transposition in both first AND last name (`Peirce → Pierce`, `Merrill → Merill`) likely exceeds the per-name distance threshold, so the pair was skipped. Need either:
  - a manual alias seed (`51229 → 50907`) in a new migration / one-shot script, **or**
  - a normalizer rule that canonicalises adjacent-letter transpositions, **or**
  - relax the Pattern 7 threshold (risk: false-positive merges).
- LaxNumbers JSON endpoint **discovered** via `js/scoreboard.min.js`:
  - `GET https://laxnumbers.com/services/scoreboard/3453?date=YYYY-MM-DD`
  - Returns `[]` of games with `home_team_name`, `visitor_team_name`, `home_state`, `visitor_state`, `game_home_score`, `game_visitor_score`, `game_date` (YYYYMMDD), `game_postponed`, `level_desc` ("Boys HS"). 3453 = "Pennsylvania Boys HS" page.
  - **No auth, no JS rendering** — clean to consume from server.
- Live deploy stack: bake-DB-into-image, push ACR `pllacr3087`, `az containerapp update --revision-suffix vN --set-env-vars …`. Web build with `VITE_API_BASE_URL=…` then `swa deploy`.

## Wave 1 — Cleanup + season lock + Merrill fix (parallel)

| Lane | Fleet name | Effort | Scope                                                                 | Blocked by | Status  |
| ---- | ---------- | ------ | --------------------------------------------------------------------- | ---------- | ------- |
| 1    | Han 😉🚀   | L      | Delete College Commits feature end-to-end (code + tests + migration)  | —          | Pending |
| 2    | Yoda 👽✨  | M      | Lock app to season 2026 (hide picker, drop `?season=` plumbing)       | —          | Pending |
| 3    | Leia 👑💁‍♀️ | M      | Fix Pierce Merrill dedupe + add transposition tolerance to dedup pass | —          | Pending |

**Lane 1 (Han) — Delete commits**
- Files to delete: `pipelines/commits.ts`, `parsers/commitsPost.ts` (+ test), `queries/commits.ts` (+ test), `routes/commits.ts`, `views/commits.ts`, `components/commitBadge.ts` (+ smoke test).
- Files to edit (remove references): `crawler.ts`, `app.ts`, `playerDetail.ts`, `sources.ts`, `routes/freshness.ts` + freshness test, `main.ts`, `router.ts`.
- New migration `011_drop_commits.sql`: `DROP TABLE IF EXISTS commits; DROP TABLE IF EXISTS commits_unmatched;` (any commit-only tables — verify in `007_commits.sql`).
- Validate: `pnpm --filter @pll/server test`, `pnpm --filter @pll/ingest test`, `pnpm --filter @pll/web build`.
- **Done when**: no `grep -ri "commit"` matches outside generic git/code-comments; tests + build all green.

**Lane 2 (Yoda) — Single-season UI**
- Hide `seasonPicker` mount point in `main.ts`; remove its DOM injection in the header.
- Pin `currentSeason()` to a hardcoded `CURRENT_SEASON = 2026` constant; bypass localStorage and URL hash logic.
- In `api.ts attachSeason`, short-circuit to no-op (or always append `?season=2026`) — pick whichever keeps the route layer's `resolveSeason` semantics intact.
- Server: keep `resolveSeason` working (no API breakage) but `/api/seasons` can return only 2026.
- Crawler ingest: confirm `--season` defaults to 2026; no other change required (already gates on URL `/2026/`).
- Tests: keep season-related server tests passing (they use 2026 by default already).
- **Done when**: SWA shows no picker; every API call uses 2026; no UI knob changes that.

**Lane 3 (Leia) — Pierce Merrill + dedup hardening**
- Investigate why `dedupPlayers.ts` Pattern 7 (and earlier passes) skipped 50907↔51229.
- Add small enhancement: include a "transposition-tolerant" pass that allows up to 2 adjacent-letter transpositions across the full normalized name when the *team_id* matches AND when no other ambiguous candidate exists.
- Cover with a unit test using exactly the Merrill case.
- One-shot: add explicit alias entry seeding `51229 → 50907` in a new script `scripts/manualAliases.ts` (or just include the merge in the dedup-script run) so we don't have to wait on the heuristic for known cases.
- Re-run `dedupPlayers --apply` against the local DB; rebuild image; verify `/api/teams/80/topScorers` returns one Merrill row.
- **Done when**: `/api/teams/80/topScorers` shows a single Merrill, deduped totals roll into 50907 (`23g/1a`).

## Wave 2 — LaxNumbers PA-only ingest (after Wave 1)

| Lane | Fleet name | Effort | Scope                                                                                          | Blocked by | Status  |
| ---- | ---------- | ------ | ---------------------------------------------------------------------------------------------- | ---------- | ------- |
| 1    | Han 😉🚀   | L      | Build LaxNumbers ingest pipeline (PA-only, additive, no team creation, dry-run + apply modes) | Wave 1     | Pending |
| 2    | Yoda 👽✨  | M      | Wire pipeline into nightly ingest cron + observability (anomaly logging, freshness)            | Wave 2 L1  | Pending |

**Lane 1 (Han) — LaxNumbers ingest**
- New file `packages/ingest/src/pipelines/laxnumbers.ts`:
  - `fetchScoreboard(date: string): Promise<LaxNumbersGame[]>` → `GET https://laxnumbers.com/services/scoreboard/3453?date=YYYY-MM-DD`
  - `ingestLaxNumbersDate(db, date, opts)`: filter `home_state == 'PA' && visitor_state == 'PA' && level_desc === 'Boys HS' && game_postponed === 0`.
  - Resolve both team names via existing `teamResolver`; **skip the row if either side fails to resolve** (no insert of new teams).
  - For each surviving game, look up an existing `games` row by `(season=2026, date, home_team_id, away_team_id)` (and the swapped pair). Match policy:
    - If a row exists and our scores are present → no-op.
    - If a row exists and our scores are NULL → fill with LaxNumbers scores; mark `source_provenance='laxnumbers'`.
    - If no row exists → insert a new game with `source_provenance='laxnumbers'`, **but only if both teams resolved**.
  - Never touch player_stats from LaxNumbers (page returns no stats; respects "additive only" rule).
- New CLI flag in `cli/ingest.ts`: `--source=laxnumbers --date=YYYY-MM-DD` and a date-range mode `--since=… --until=…`.
- Migration `012_laxnumbers_provenance.sql`: add `source` column to `games` if not already present (default `'phillylacrosse'`); index it.
- Unit test with a fixture from a known PA date.
- **Done when**: dry run on the current week's data prints a sane diff; apply mode adds only the gap-filling rows.

**Lane 2 (Yoda) — Cron + observability**
- Add LaxNumbers fetch to the nightly ingest entrypoint (whatever cron currently triggers Philly Lacrosse) — runs *after* Philly Lacrosse so additive policy works.
- Record `laxnumbersLast` in `freshness` route + UI sources page.
- Log "team-not-in-db" cases as ingest anomalies (so we can audit, never auto-create).
- **Done when**: `/api/freshness` exposes `laxnumbersLast`; sources page lists LaxNumbers with last-fetched timestamp; anomalies page surfaces unresolved teams.

## Validation strategy (each wave)

- `pnpm --filter @pll/server test`
- `pnpm --filter @pll/ingest test`
- `pnpm --filter @pll/web build` (also typechecks)
- For Lane 1 Wave 1: full grep sweep `rg -i "commit" packages/{server,ingest,web,shared}/src` should return nothing meaningful.
- For Lane 3 Wave 1: live curl of `/api/teams/80/topScorers` post-deploy.
- For Wave 2: dry-run output diff inspected before `--apply`.

## Deployment loop (per wave)

1. `docker buildx build --platform linux/amd64 -t pllacr3087.azurecr.io/pll-server:vN --load .`
2. `docker push pllacr3087.azurecr.io/pll-server:vN`
3. `az containerapp update -n pll-server -g pll-rg --image …vN --revision-suffix vN --set-env-vars DB_PATH=/tmp/lacrosse.db PORT=8080 NODE_ENV=production CORS_ORIGINS="https://victorious-pond-0c5ff000f.7.azurestaticapps.net,http://localhost:5173"`
4. `VITE_API_BASE_URL=https://pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io pnpm --filter @pll/web build`
5. `swa deploy packages/web/dist --deployment-token "$SWA_TOKEN" --env production`
6. `curl …/api/health` → expect 200.

## Out of scope

- Any Girls HS or college data.
- Bringing back commits (deferred until/if a different surface is wanted).
- Multi-season dashboards (deferred until 2027 season nears).
- Authentication or write API.

## Communication log

| Time | Lane | Fleet name | Update                          |
| ---- | ---- | ---------- | ------------------------------- |
| —    | —    | —          | (populated when Wave 1 launches) |
