# 05 — Team strength radar chart

## Motivation

The site currently lets a fan answer *"how good is Team X?"* only by reading
flat tables — leaders board, season record, schedule. There is no single
visual that captures a team's **profile** (high-scoring vs. defensive,
faceoff-driven vs. transition-driven, etc.) or that makes two teams easy to
**compare side-by-side**.

A radar (spider) chart is the canonical way to show 5–8 normalized metrics on
one shape. For a 207-team boys lacrosse landscape with a live in-progress
season, a radar gives:

- **Scouting at a glance** — coaches and parents see the team's strengths and
  weaknesses without scrolling.
- **H2H context** — overlaying two radars on `views/h2h.ts` immediately shows
  *why* a matchup might go a certain way (e.g. "Team A wins faceoffs but
  bleeds saves").
- **Conversation fodder** — the kind of share-able artifact that travels well
  on social media (Han already builds OG images in `components/postImage.ts`,
  so a radar PNG fits the pipeline).

This is the highest-leverage *new* visualization we can add: it turns data we
already aggregate into a story about every team in the database.

## Current state

- `packages/web/src/views/teamDetail.ts` (466 lines) shows season record,
  schedule, top scorers — all text/lists. No multi-metric visual.
- `packages/web/src/views/h2h.ts` compares two teams' historical head-to-head
  results but has no per-team profile overlay.
- `packages/web/src/views/dashboard.ts` (687 lines) shows team-name boxes,
  recent results, and leaders — again all tabular.
- The chart toolkit in `packages/web/src/charts/` already has SVG primitives
  (`internal/svg.ts`, `createResponsiveSvg`, `readTheme`) plus d3-scale,
  d3-axis, d3-shape, d3-array — everything needed for a radar with **zero new
  dependencies**.
- Per-game stats in `PlayerStat` (`packages/shared/src/index.ts:119`) include
  `goals, assists, groundBalls, causedTurnovers, saves, foWon, foTaken` —
  all the inputs a radar needs, just not aggregated to team-season level yet.

So: the data exists, the chart kit exists, and there is a natural home for the
visual on `teamDetail` and `h2h`. Nothing in the repo blocks this; it is
purely additive.

## Proposed design

### The metrics (7 axes)

Pick metrics that are **independent** (no axis is a linear combo of another)
and **directionally consistent** (higher = better, so the polygon area
correlates with team quality):

| Axis              | Formula                                  | Notes                              |
| ----------------- | ---------------------------------------- | ---------------------------------- |
| Goals / game      | sum(team goals) / games played           | Offense volume                     |
| Assists / game    | sum(assists) / games played              | Ball movement (vs. iso scoring)    |
| Faceoff %         | sum(foWon) / sum(foTaken)                | Possession driver                  |
| Ground balls / g  | sum(GB) / games played                   | Hustle / 50-50 wins                |
| Saves / game      | sum(saves) / games played                | Goalie + defensive pressure        |
| Scoring margin    | (goals_for − goals_against) / games      | Net efficiency                     |
| Strength of sched | mean opponent win% (excl. self)          | Context — penalizes empty stats    |

### Normalization

Each axis is rescaled to **0..1 across the league population** so the polygon
shape is comparable team-to-team. Two normalization choices, both cheap:

1. **Min/max** — fast, intuitive, but distorted by outliers (one 25-goal blowout
   stretches the goals axis for everyone).
2. **Percentile rank** — robust, stays interpretable ("80th percentile faceoff
   team"). Recommend this; quantile from `d3-array`.

Out-of-area teams with `<3 games` are excluded from the population (consistent
with the dashboard filter the user already added) but can still be *plotted*
with a dashed outline indicating "low sample size".

### ASCII sketch

```
               Goals/g
                  │
                  ●───── 1.0 (league max)
                 /│\
                / │ \
   Assists/g  ●  │  ●  Saves/g
              /\ │ /\
             /  \│/  \
   FO%     ●────●────●  GB/g
             \  /│\  /
              \/ │ \/
   SoS     ●  │  ●  Scoring margin
                 \│/
                  ●
                  │
              (origin = 0, league min)

Filled translucent polygon = this team
Dashed grey ring at 0.5 = league median
```

For H2H comparison, render two overlaid polygons with team primary colors,
each at 35% fill alpha so the overlap region reads clearly:

```
   Team A (blue)        Team B (orange)         Overlay
   ┌─────────┐          ┌─────────┐         ┌─────────┐
   │   ◆     │          │  ◆      │         │  ◆◆     │
   │  ◆ ◆    │    +     │ ◆◆ ◆    │   =     │ ◆█◆◆    │  ← purple = both strong
   │ ◆   ◆   │          │◆   ◆◆   │         │◆█  ◆◆   │
   │  ◆◆     │          │ ◆◆◆     │         │ ◆█◆◆    │
   └─────────┘          └─────────┘         └─────────┘
```

### File layout

Follow the existing chart-module pattern:

- `packages/web/src/charts/teamRadar.ts` — `renderTeamRadar(el, data, opts)`
  returning a `ChartHandle` (matches the contract in `charts/types.ts`).
- `packages/web/src/charts/types.ts` — add `TeamRadarDatum`,
  `TeamRadarOptions`, `RadarAxis` types.
- `packages/web/src/charts/index.ts` — export the new render fn.
- `packages/web/src/charts/__tests__/teamRadar.test.ts` — vitest, parallel to
  the existing test files in that directory.
- `packages/web/src/charts/__demo__.html` and `__demo__.ts` — add a demo cell
  with two static teams so designers can iterate without the API.

### Server side

A new endpoint avoids dragging the entire 1929-player table into the browser
just to compute league percentiles:

- `GET /api/teams/:id/profile` → `{ axes: { goalsPerGame: { value, percentile }, ... }, gamesPlayed, leagueSize }`
- `GET /api/teams/profile-population` (cached, 5-min TTL) → `{ axisName: number[] }` so the client can compute percentiles for *any* radar without refetching.

Implement in `packages/server/src/routes/teams.ts` (or wherever team routes
live — to confirm during build). Aggregation lives in `packages/ingest` SQL
helpers if performance matters; for 207 teams a single grouped query against
`player_stats JOIN games` runs in <50ms with the existing better-sqlite3
indexes.

### Integration points

1. **`teamDetail.ts`** — render solo radar above the schedule list.
2. **`h2h.ts`** — render overlay radar above the historical results.
3. **`comparePlayers.ts`** — out of scope (player-level radar is a follow-up).
4. **OG image** — `components/postImage.ts` can render a static PNG snapshot
   for sharing; the SVG → canvas conversion is straightforward since we are
   not using any d3 transitions.

### Accessibility

- Add `<title>` and `<desc>` inside the SVG describing the team and its
  strongest/weakest axis ("Strongest: faceoff %, 91st percentile. Weakest:
  saves per game, 22nd percentile.").
- Mirror the radar with a `<table>` of the underlying numbers below the chart
  (visually hidden by default; revealed via "Show data" toggle). Screen
  readers get the table; sighted users get the polygon.
- Honor `prefers-reduced-motion` — no entry animation when set.
- Honor `prefers-color-scheme: dark` (already used in `styles.css`) via
  `readTheme()` from `charts/internal/svg.ts`.

## Scope

### In

- `teamRadar.ts` chart module + types + tests + demo cell.
- Server endpoint for per-team axes and league population.
- Integration on `teamDetail.ts` and `h2h.ts`.
- A11y table fallback and theme support.

### Out

- Player-level radar (follow-up; needs different metrics and per-position
  normalization).
- Time-series of how a team's radar changes week to week (RFC 06's territory
  if extended).
- Cross-season historical comparison (2025 vs. 2024) — needs season selector
  plumbing that does not exist yet.
- Fancy radar variants (filled glow, animated draw-on) — defer until v2.

## Validation plan

- **Unit tests** — `teamRadar.test.ts`: axis ordering deterministic, polygon
  closes correctly, percentile of `0` and `1` map to center and edge, dark
  theme swaps stroke colors.
- **Visual smoke test** — demo page renders three known teams (top-ranked,
  median, bottom-ranked) and screenshots them; commit baselines to
  `__tests__/__snapshots__/` (Vitest + jsdom is enough — no Playwright
  needed).
- **Data sanity** — script in `packages/ingest` that computes percentiles for
  all 207 teams and asserts no axis has >10 teams pinned at exactly 1.0
  (would mean we picked a bad metric).
- **Manual check** — open `teamDetail` for the #1 PIAA team and the #1
  out-of-area team; the polygons should look clearly different *and* a coach
  should be able to point at the obvious shape difference.
- **Mobile** — verify the radar stays readable at 360 px viewport (axis
  labels may need to truncate to 3 letters on narrow screens).

## Effort estimate

**M (medium)** — ~3 focused days:

- Day 1: server endpoint + aggregation SQL + cache.
- Day 2: chart module + types + tests + demo.
- Day 3: integration on `teamDetail` + `h2h`, a11y table, dark theme,
  responsive tuning.

The math is well-trodden, no new deps, and the chart-kit pattern is already
established. The only soft area is picking the *right* 7 metrics — that may
take a round of feedback before the axes are locked.

## Risk

- **Metric choice is opinionated.** If users disagree with the axes the chart
  reads as "wrong" even though the data is correct. Mitigation: ship with
  documented formulas and let the axis labels link to a definitions page.
- **Sparse-data teams look bad.** A team with 2 games will have wild
  percentiles. Mitigation: dashed outline + "low sample" badge for `<5
  games`; matches existing out-of-area filter philosophy.
- **Radar charts have known perceptual issues** — area is not a fair quality
  proxy because axis order changes the polygon shape. Mitigation: keep axis
  order **fixed** site-wide so cross-team comparisons are valid; never let
  users reorder axes.
- **Percentile recompute on every request** would be slow. Mitigation: cache
  the population payload for 5 min; invalidate on new game ingest.

## Open questions

1. **Axis count: 6 vs. 7 vs. 8?** Six is cleaner visually; seven includes SoS
   which is the most-requested context metric. Recommend 7.
2. **Should "scoring margin" cap at ±20 per game?** Otherwise one 25-0 win
   blows out the axis. Percentile normalization already handles this — but
   confirm with a real run.
3. **Color encoding for H2H overlay** — use team primary colors (need to
   resolve those for un-PIAA-tracked teams) or fixed blue/orange (matches
   `quarterByQuarter.ts`)? Lean fixed for consistency.
4. **Where does the league-population cache live?** In-memory on the Fastify
   instance is simplest; if we ever go multi-process it needs to move to
   sqlite or a cache header.
5. **Do we expose the radar JSON via the API for external consumers** (e.g. a
   future Twitter bot)? Cheap to add now, cheap to add later — defer until
   asked.
