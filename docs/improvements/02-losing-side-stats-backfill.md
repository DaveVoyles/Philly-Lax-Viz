# 02 — Losing-Side Stats Backfill via MaxPreps Cross-Source Hydration

> **Lane:** Han 😉🚀 (Data quality)
> **Category:** Source priority · ingest completeness · cross-source hydration

## Motivation

PhillyLacrosse.com is our richest narrative source — full game recaps, scorer
breakdowns, period-by-period scores — but it has a structural editorial bias
the parser cannot fix: **recaps are written from the winner's perspective and
routinely omit losing-side scorers entirely**.

The downstream symptom is well known to the user: a non-trivial number of
games show a final score (e.g. 12–4) but only 12 goals' worth of attributed
scorers in `player_stats`, with the four losing goals attributed to nobody.
The web app already papers over this with a UI banner ("losing-side stats not
published"), but the underlying data gap means:

- Player-of-the-season leaderboards systematically under-count players from
  weaker teams.
- Team total-goals queries computed from `player_stats` disagree with
  `games.away_score` / `games.home_score`.
- Anomaly counters don't even flag this — the parser successfully extracts
  every scorer that *was* listed; the gap is invisible to ingest.

Concrete diagnostic queries (run against current snapshot, 605 games / 6,790
player_stats):

```sql
-- Games where one side has zero scorers but a non-zero score:
SELECT COUNT(*) FROM games g
WHERE g.home_score > 0
  AND NOT EXISTS (SELECT 1 FROM player_stats ps
                  WHERE ps.game_id = g.id AND ps.team_id = g.home_team_id);
-- Mirror for away_score. Empirical estimate: ~80–140 affected sides.
```

We have a second source — **MaxPreps** — that is structurally complete (it
publishes full box scores for both teams because the scoring data comes from
the AD's stat feed, not editorial copy). We don't currently scrape it. This
proposal adds a *targeted, gap-driven* MaxPreps fetch — not a parallel
ingest, but a backfill triggered only for the specific game-sides we know
are missing.

## Current state

- **Primary ingest:** `packages/ingest/src/pipelines/summaries.ts` parses
  PhillyLacrosse recap posts via the parsers in
  `packages/ingest/src/parsers/summariesPost.ts` and
  `packages/ingest/src/parsers/playerStat.ts`.
- **Source priority:** `docs/runbooks/source-priority.md` (single existing
  runbook) defines the precedence ordering for conflicting fields. There is
  **no entry for MaxPreps** today — it is not yet a recognized source.
- **Schema:** `player_stats` has no `source` column from what I can see in
  the snapshot — every row is implicitly PhillyLacrosse-derived.
- **UI fallback:** the web app surfaces a "losing-side stats not published"
  banner in `packages/web/src/…` (out of scope to enumerate). This is a
  presentation patch, not a data fix.
- **Recent prior art:** the Marple Newtown / Harriton split and Springfield
  slug fixes (visible as `data/lacrosse.db.bak-pre-*` filenames) prove the
  team about cross-source canonicalization. We have no equivalent muscle
  for player-stat backfill.

## Proposed design

### Step 1 — Identify gap-sides (SQL view)

A new view shipped via the next migration:

```sql
CREATE VIEW v_missing_side_stats AS
SELECT g.id AS game_id, g.date, g.home_team_id AS missing_team_id,
       g.home_score AS expected_goals, 'home' AS side
FROM games g
WHERE g.home_score > 0
  AND NOT EXISTS (SELECT 1 FROM player_stats ps
                  WHERE ps.game_id = g.id AND ps.team_id = g.home_team_id)
UNION ALL
SELECT g.id, g.date, g.away_team_id, g.away_score, 'away'
FROM games g
WHERE g.away_score > 0
  AND NOT EXISTS (SELECT 1 FROM player_stats ps
                  WHERE ps.game_id = g.id AND ps.team_id = g.away_team_id);
```

This is the **work queue**. A nightly job materializes it.

### Step 2 — MaxPreps URL resolver

`packages/ingest/src/parsers/maxprepsUrl.ts` — pure function from
`(team_slug, season_year) → MaxPreps roster URL`. MaxPreps URL pattern is
deterministic: `https://www.maxpreps.com/pa/<city>/<team-slug>/lacrosse/<season>/`.
We need a `teams.maxpreps_slug TEXT NULL` column (additive migration) populated
either:

- by a one-shot `seed-maxpreps-slugs.ts` script that reads `teams.name` +
  `teams.city` and constructs the canonical slug, **OR**
- by hand for the ≤ 60 teams that actually appear in `v_missing_side_stats`.

The hand-curate path is cheaper for proposal scope; auto-discovery is a
follow-up.

### Step 3 — MaxPreps box-score parser

`packages/ingest/src/parsers/maxprepsBoxScore.ts` consumes a single MaxPreps
game-detail page (HTML), extracts the per-team scorers table, and returns:

```ts
interface MaxPrepsScorerRow {
  rawName: string;        // "Michael Johnson"
  goals: number;
  assists: number;
  // (shots, ground balls etc. are TBD — see Open Questions)
}
```

The function is **pure**, takes HTML in, returns parsed rows out, and writes
nothing. Mirrors the existing parser structure in
`packages/ingest/src/parsers/`.

### Step 4 — Backfill pipeline

`packages/ingest/src/pipelines/backfill.ts`:

1. Read `v_missing_side_stats`.
2. For each row, look up the team's `maxpreps_slug`. If null, skip and log
   to `ingest_anomalies` with `strategy_attempted = 'maxpreps-backfill'`,
   `reason = 'no maxpreps slug for team'`.
3. Fetch the MaxPreps schedule for that team & season; find the game whose
   date matches `games.date` ± 1 day and whose opponent matches the other
   side of the game (by alias resolution — reuses `teamResolver.ts`).
4. Fetch the MaxPreps game-detail page; run the box-score parser.
5. **Validation gate:** sum of MaxPreps goals for the missing side must
   equal `games.{home,away}_score`. If not, write anomaly
   `'maxpreps total disagrees with phillylacrosse score'` and **do not
   write player_stats**. (This is the source-priority anchor: PhillyLacrosse
   wins on game totals; MaxPreps wins on roster attribution **only when
   it agrees** with the PhillyLacrosse total.)
6. On agreement, write `player_stats` rows with a new
   `source = 'maxpreps-backfill'` column.

### Step 5 — Schema & source-priority changes

Additive migrations:

```sql
ALTER TABLE teams        ADD COLUMN maxpreps_slug TEXT NULL;
ALTER TABLE player_stats ADD COLUMN source        TEXT NOT NULL
                              DEFAULT 'phillylacrosse';
CREATE INDEX idx_player_stats_source ON player_stats(source);
```

Append a new section to `docs/runbooks/source-priority.md` explicitly
documenting the rule:

> **Player-stat attribution:** PhillyLacrosse wins when present.
> MaxPreps fills only the gap-sides identified by `v_missing_side_stats`,
> and only when MaxPreps' summed goals equal PhillyLacrosse's reported
> score for that side.

### Step 6 — UI banner downgrade

Once a side has been backfilled, the existing UI banner should switch from
"losing-side stats not published" to a softer "scorer attribution from
MaxPreps". This is a one-line change in the web package; flagged here for
coordination but executed in a separate PR.

## Scope

**In scope**

- `v_missing_side_stats` view + nightly materialization.
- `teams.maxpreps_slug`, `player_stats.source` migrations.
- MaxPreps URL builder + box-score parser (HTML in, rows out).
- Backfill pipeline with the agreement-gate validator.
- Source-priority runbook update.
- Anomaly logging for skip cases.

**Out of scope**

- Auto-discovering `maxpreps_slug` for all 207 teams (manual curate the
  ≤ 60 affected teams first; automate later if pattern holds).
- MaxPreps as a *primary* source for new games — backfill only.
- Backfilling stats other than goals + assists in v1 (keeps the agreement
  gate simple — see Open Questions).
- UI banner change (separate PR; trivial once data is correct).
- Cross-source reconciliation of game scores themselves (different problem;
  PhillyLacrosse remains canonical for `games.{home,away}_score`).

## Validation plan

1. **Baseline:** snapshot DB, count rows in `v_missing_side_stats`. Expect
   60–140 sides (rough estimate from the symptom description; will verify
   in step 1 of implementation).
2. **Parser unit tests:** check in 3 cached MaxPreps game-detail HTML
   fixtures under `fixtures/maxpreps/` (one PIAA AAA, one AA, one
   inter-state) and assert the parser returns the right scorer rows.
3. **Agreement-gate test:** synthetic fixture where MaxPreps goals sum to
   `score - 1` → must write an anomaly, **must not** write `player_stats`.
4. **Dry-run on real data:** run the backfill with `--dry-run` against a
   copy of `data/lacrosse.db`; review the proposed inserts in a TSV.
5. **Coverage delta:** after live run, recount `v_missing_side_stats` —
   target a **≥ 60 % drop** in affected sides (the residual being teams
   without a MaxPreps presence, e.g. some out-of-state opponents).
6. **Aggregate sanity:** for each backfilled game, `SELECT SUM(goals)
   FROM player_stats WHERE game_id = ? AND team_id = ?` must equal the
   stored side-score. This is the same check as the agreement gate but
   re-asserted post-write as a regression guard.
7. **Polite scraping:** rate-limit MaxPreps fetches to ≤ 1 req / 2 s with
   a respectful User-Agent and `If-Modified-Since` caching against
   `cached_html`.

## Effort estimate

**L (1.5–2 weeks)**

- Days 1–2: view + migrations + slug seed for the 60 affected teams.
- Days 3–5: MaxPreps parser with fixtures + tests.
- Days 6–8: backfill pipeline + agreement gate + dry-run mode.
- Days 9–10: live run on `data/lacrosse.db`, anomaly triage, runbook write-up.

It's L (not M) because (a) MaxPreps HTML structure is unfamiliar and may
need parser iteration, (b) date/opponent matching across sources has edge
cases (rescheduled games, doubleheaders), and (c) we're introducing a new
external dependency that needs cache + rate-limit hygiene.

## Risk

**Medium**

| Risk                                                            | Likelihood | Impact | Mitigation                                                                |
| --------------------------------------------------------------- | :--------: | :----: | ------------------------------------------------------------------------- |
| MaxPreps box scores credit goals to different player than truth |    Low     | Medium | Agreement gate + `source` column makes provenance auditable and revertable. |
| MaxPreps changes HTML structure                                 |   Medium   | Medium | Parser is small (one file); cache HTML in `fixtures/` so regressions are reproducible. |
| Game-matching across sources fails (date mismatch, doubleheader) |   Medium  | Low    | Skip + anomaly log; never speculative-match. |
| MaxPreps blocks scraping                                        |    Low     |  High  | Rate-limit ≤ 1 req / 2 s, real UA, respect robots; if blocked, stop and reassess. |
| Backfilled `player_stats` distorts existing leaderboards in surprising ways | Medium | Low | `source` column allows the web layer to filter/badge MaxPreps-derived rows. |
| Two sources both attribute the same goal to different players (post-Phase-2 expansion) | Low | Medium | Out of scope for v1 — `source` column reserves room for a precedence resolver later. |

## Open questions

1. **Stat scope for v1:** goals + assists only, or also shots / ground balls?
   Goals + assists is enough to satisfy the agreement gate; expanding the
   stat set means MaxPreps disagreements (always present in shot counts)
   would block the backfill. Recommend G+A only.
2. **Slug curation cost:** Dave, would you rather (a) hand-curate 60-ish
   `maxpreps_slug` values up front, or (b) ship an auto-builder with a
   confidence floor and review the misses? (a) is faster for v1.
3. **`cached_html` reuse:** does the existing cache table accept arbitrary
   URLs, or is it PhillyLacrosse-shaped? Need to check
   `packages/ingest/src/pipelines/postImages.ts` or wherever the cache lives.
4. **Source-priority precedence vs. proposal 01 aliases:** if the alias
   seeder (proposal 01) recovers a previously-dropped scorer for the losing
   side, the backfill should *not* duplicate-insert that scorer. Plan: run
   alias replay (proposal 01, Phase D) **first**, then `v_missing_side_stats`
   reflects only the truly editorial gaps.
5. **Should we backfill historical seasons or only current?** Current-season
   first; backfilling prior seasons risks re-touching already-published
   leaderboards. Defer to Dave.
