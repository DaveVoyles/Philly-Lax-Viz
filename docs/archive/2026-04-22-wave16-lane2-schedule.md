# Wave 16 Lane 2 — Schedule scrape (upcoming games)

**Agent:** Leia 👑💁‍♀️
**Date:** 2026-04-22

## What shipped

Upcoming-games visibility end-to-end: scrape -> DB -> API -> web view + per-team widget.

## Source decision

Three candidates investigated:

| Source | Status | Notes |
| --- | --- | --- |
| **PIAA D1 CSV export** | ✅ chosen | `/sports/spring-sports/lacrosse-b/scores-and-rankings/export?type=games&year=2026&sport=BoysLacrosse` returns a clean 8-column CSV (`Date, Sport, Game Completed, Exclude From Ranking, Home Team, Home Score, Visitor Team, Visitor Score`). 565 rows for 2026 season as of 2026-04-22 (385 played, 180 upcoming). Single request, no auth, no JS. |
| LaxNumbers | ❌ skipped | Page renders behind a CMP / GDPR consent wall and uses client-side JS to populate game lists. No JSON endpoint discovered in the static HTML. Not feasible without a headless browser. |
| PhillyLacrosse calendar | ❌ skipped | No structured calendar — they only post recap/scoreboard articles after games. |
| `/sports/spring-sports/lacrosse-b/schedule/` | ❌ 301 -> root | The legacy schedule URL redirects, but the per-team game pages (`/scores-and-rankings/games/2026-{slug}-boys-lacrosse`) and the CSV export are live. CSV is strictly better than scraping 80 per-team pages. |

## Live scrape results

```
[ingest:schedule] csv source=network bytes=45912
[ingest:schedule] parsed_rows=565 malformed=0
[ingest:schedule] upserted=180 skipped_completed=385 home_unresolved=17 away_unresolved=10 anomalies_added=15
```

`schedule_games` now has **180 upcoming rows** spanning 2026-04-22 through 2026-05-11.
**153 of 180 (85%)** have both teams resolved to existing `teams` rows. **15 unique teams** could not be resolved and were emitted as `schedule-team-resolve` anomalies for triage.

## Files touched

**Schema**
- `packages/ingest/src/migrations/008_schedule.sql` (new)
- `packages/ingest/src/db.test.ts` (bumped user_version 7 -> 8, added `schedule_games` to expected tables)

**Ingest**
- `packages/ingest/src/parsers/scheduleCsv.ts` (new — CSV splitter + parser, BOM/CRLF tolerant)
- `packages/ingest/src/sources/piaaSchedule.ts` (new — fetch + on-disk cache, 1s rate-limit between live fetches)
- `packages/ingest/src/pipelines/schedule.ts` (new — `findTeamByName` lookup-only resolution; emits anomaly per unique unresolved team; idempotent via per-source/season delete + upsert)
- `packages/ingest/src/cli/ingest.ts` (added `--schedule`, `--season=YYYY`, `--force-fetch` flags + standalone code path)

**Shared**
- `packages/shared/src/index.ts` (added `'schedule-team-resolve'` to `ParserStrategy` union)

**Server**
- `packages/server/src/queries/schedule.ts` (new — `listScheduleGames`, `groupByDate`, `listUpcomingForTeam`)
- `packages/server/src/routes/schedule.ts` (new — `GET /api/schedule` and `GET /api/schedule/team/:id/upcoming`)
- `packages/server/src/app.ts` (registered `scheduleRoutes`)

**Web**
- `packages/web/src/api.ts` (added `getSchedule`, `getTeamUpcoming` + `ScheduleGame`/`ScheduleResponse` types)
- `packages/web/src/views/schedule.ts` (new — grouped-by-date list, 14/30/all window selector, lazy-loaded)
- `packages/web/src/router.ts` (added `'schedule'` route name + pattern)
- `packages/web/src/main.ts` (one nav entry, one teardown line, one dispatch case — lazy import per R2 caveat)
- `packages/web/src/views/teamDetail.ts` (added "Upcoming Games" widget showing next 3 games for the team)

## Tests added (4)

| File | Cases |
| --- | --- |
| `packages/ingest/src/parsers/__tests__/scheduleCsv.test.ts` | 7 — CSV splitter edge cases, malformed rows, BOM/CRLF, empty input |
| `packages/ingest/src/pipelines/__tests__/schedule.test.ts` | 3 — happy path, unresolved-team anomaly emission, idempotency |
| `packages/server/src/__tests__/schedule.test.ts` | 6 — date filter, to-bound, validation, joined names/slugs, per-team upcoming, limit validation |
| `packages/web/src/views/schedule.test.ts` | 1 — module loads + render/destroy contract |

`pnpm typecheck` ✅, `pnpm test` ✅ (407 passing across all packages), `pnpm --filter @pll/web build` ✅ (new `schedule-*.js` chunk).

## Caches & backups

- Cache: `data/schedule-cache/piaa-d1-2026.csv` (45 KB). Re-runs without `--force-fetch` reuse the cached CSV.
- DB backup: `data/lacrosse.db.bak-w16-l2-leia` taken before the live scrape.

## Known gaps / W17 follow-up

1. **Alias seeding for unresolved schedule teams.** 15 unique team names from the PIAA CSV don't match any of our 241 teams. Roughly half are out-of-state opponents (NJ/DE/D3 prep schools we don't track) — fine to leave unresolved. The Philly-area ones that need aliases:
   - `Msgr Bonner & Abp Prendergast HS` → existing `Msgr. Bonner` row
   - `Conwell-Egan Catholic HS` → existing `Conwell-Egan` row
   - `Saint Joseph's Preparatory School` → existing `St. Joseph's Prep` row
   - `Julia R. Masterman High School` (currently no row)
   - `SPRINGFIELD (DELCO)` vs `SPRINGFIELD TWP.(M)` → disambiguate against existing Springfield rows
   This is `seedTeamAliases.ts` work — Yoda's lane per the caveats, so I left it alone.

2. **No game time / location.** The PIAA CSV doesn't include either column. The schema has the columns ready (`game_time`, `location`); a future per-team-page scrape could populate them, but the cost is 80+ HTTP requests per refresh. Defer until users ask.

3. **`recap_url` linkage.** Once a scheduled game is played and a PhillyLacrosse recap lands, both tables will hold a row for the same matchup on the same date. A future query could join `schedule_games` with `games` on `(home_team_id, away_team_id, game_date)` to surface "we have a recap for this" badges. Not urgent.

4. **Cron / refresh cadence.** Right now `--schedule` is a manual CLI command. A daily cron (or running it as part of `pnpm crawl`) would keep upcoming games fresh as the season progresses. The pipeline is fully idempotent so frequent runs are safe.

5. **Other seasons.** CLI accepts `--season=2025` etc.; PIAA's CSV export is year-parameterised so historical schedules are reachable. Not pulled this wave.
