# Team dedup + PIAA cross-check — plan

## Request

> "Why do some teams appear twice (e.g., `Bishop Shanahan` and `Bishop Shanahan (1)`)?
> Also: piaad1.org has 100% accurate team names, W/L, and rankings. Use that."

## Root cause (already investigated)

40 teams in `teams` have parenthetical suffixes that the rankings + scoreboard parsers
greedily included in the team name. Patterns observed:

- `(N)` numeric — district number / seed (`Bishop Shanahan (1)`, `Easton (11)`)
- `(Inter-Ac)`, `(MAPL)`, `(Friends)`, `(IND)` — conference / league
- `(NJ)`, `(NY)` — out-of-state markers (legitimate distinguishers)
- `(District 12)` — district label

Most suffix-teams have **0 games** (created from rankings rows only); the canonical team
with the same base name has the actual games attached.

## Wave 2 lanes

| Lane | Fleet | Effort | Scope | Owns | Blocked by |
| --- | --- | --- | --- | --- | --- |
| 1 | Han 😉🚀 | M | DB dedup migration | new script in `packages/ingest/src/scripts/`, mutates `data/lacrosse.db` (backup taken) | — |
| 2 | Yoda 👽✨ | S | Parser hardening | `packages/ingest/src/parsers/rankingList.ts`, `scoreboardPost.ts`, new `normalize/teamName.ts`, tests | — |
| 3 | Leia 👑💁‍♀️ | M | PIAA ground-truth | new `packages/ingest/src/sources/piaa.ts`, new schema table `piaa_official_teams`, new server route `/api/data-quality/piaa-mismatches`, Data Quality view tile | — |

All 3 lanes parallel — no file overlap.

## Defaults locked at pre-flight

- **Strip all parentheticals EXCEPT `(NJ)`/`(NY)`** (those stay as state markers).
- **For intra-state duplicates within `(NY)`/`(NJ)`** (e.g. `St. Anthony's HS (NY)` vs `St. Anthony's (NY)`): prefer the team with games; merge the other into it.
- **DB backup** taken before Lane 1 runs: `data/lacrosse.db.bak.20260422-131544`.
- **Risk**: Medium (DB mutation in Lane 1). Lane 1 must verify zero orphan refs after merge.

## Validation gates

- Lane 1: `SELECT count(*) FROM teams WHERE name LIKE '% (%)';` → only `(NJ)`/`(NY)` remain. No orphan `home_team_id`/`away_team_id`/`players.team_id`/`rankings.team_id`.
- Lane 2: `pnpm --filter @pll/ingest test` green; new tests cover each suffix pattern.
- Lane 3: `curl /api/data-quality/piaa-mismatches` returns categorized JSON; Data Quality view shows the tile.
- Synthesis: `pnpm -r typecheck && pnpm -r test`; `/api/leaders/teams?metric=wins` returns clean names; site reloads.

## Hard stops

- Lane 1 (M): 30m
- Lane 2 (S): 15m
- Lane 3 (M): 30m

## Communication log

| Time | Lane | Fleet | Update |
| --- | --- | --- | --- |
| 13:16 | all | — | 🚀 Wave 2 launched, DB backed up, defaults locked |
| 13:25 | 3 | Leia 👑💁‍♀️ | ✅ PIAA cross-check live: 59 PIAA teams (42 in 3A, 17 in 2A) loaded; 52 matched, 7 missing in DB, 99 extra, 52 record mismatches. Endpoint `/api/data-quality/piaa-mismatches` and Data Quality tile shipped. |
