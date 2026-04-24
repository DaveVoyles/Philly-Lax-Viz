# 06 — Game flow chart (cumulative scoreline)

## Motivation

Every game in the database has period-by-period scoring captured (`GamePeriod`
records, joined to games via `/api/games/:id`). Today that data is shown only
as a **grouped bar chart** (`charts/quarterByQuarter.ts`) — four bars side by
side, one pair per quarter. That answers "who scored more in Q3?" but not the
question fans actually ask:

> *"When did the game get away from them?"*

A **cumulative scoreline** — a step/line chart showing each team's running
total across the 48 minutes of the game — is the single most-recognized
sports-data visual (NFL win-probability charts, NBA "score difference"
graphs, ESPN game-flow widgets). It turns a static box score into a story
arc:

- **Wire-to-wire blowouts** look like two straight diverging lines.
- **Comebacks** show a clear inflection.
- **Tight games** have lines that hug each other across all four quarters.

For an in-progress boys lacrosse season with 605 games already in the DB and
more arriving weekly, this is a high-impact, low-cost addition to
`gameDetail.ts` — the page fans land on after every recap.

## Current state

- `packages/web/src/views/gameDetail.ts` (390 lines) renders the scoreboard,
  optional hero photo, and calls `renderQuarterByQuarter(...)` from
  `packages/web/src/charts/quarterByQuarter.ts`.
- `quarterByQuarter.ts` consumes `data.periods: { teamId, periodNumber, goals }[]`
  and produces a grouped bar chart with d3-scale + d3-axis.
- The same `periods` payload contains everything we need for a cumulative
  line — no API change required.
- No line-chart primitive exists yet in `charts/` (`sparkline.ts` is close
  but is a tiny single-series glyph for trends, not a multi-series game flow
  with axes and quarter dividers).
- d3-shape is already a dependency (`packages/web/package.json`) — it
  provides `line()` and `curveStepAfter` which is exactly the right
  interpolator for a discrete-event score chart.

So this RFC is *additive* alongside the existing bar chart, not a
replacement. Fans get both: the bars answer "by quarter", the line answers
"over time".

## Proposed design

### Chart shape

```
Goals
 12 ┤                                      ┌─────  Home (final 11)
 11 ┤                                ┌─────┘
 10 ┤                          ┌─────┘
  9 ┤                    ┌─────┘─────┐
  8 ┤              ┌─────┘           └─────  Away (final 8)
  7 ┤              │
  6 ┤        ┌─────┘
  5 ┤  ┌─────┘
  4 ┤  │
  3 ┤──┘
  2 ┤
  1 ┤
  0 ┼────────────┬────────────┬────────────┬────────────
    │     Q1     │     Q2     │     Q3     │     Q4
                                ↑
                         momentum shift
                         (3-goal Q3 run)
```

**Key visual choices:**

1. **Step-after curve** (`d3.curveStepAfter`) — each goal is a discrete
   event; a smooth line would imply continuous scoring and lie about the
   data.
2. **Quarter gridlines** — vertical dashed lines at the Q1/Q2/Q3/Q4
   boundaries, with quarter labels along the x-axis (matches the existing
   `periodLabel()` helper in `charts/internal/svg.ts`).
3. **Two series, two team colors** — reuse the same `awayColor` / `homeColor`
   defaults from `quarterByQuarter.ts` so the two charts read as a matched
   pair.
4. **Final-score labels on the right** — eliminate any need for a separate
   legend; the line *is* the key.
5. **Optional momentum-run annotations** — auto-detect any quarter where one
   team scored 3+ unanswered goals and annotate it with a faint vertical
   highlight band. v1 can ship without this.

### Data shape

The endpoint already returns:

```ts
periods: Array<{
  gameId: number;
  teamId: number;
  periodNumber: number;  // 1..4 (+ 5,6 for OT)
  goals: number;         // goals in that period (not cumulative)
}>;
```

Inside the chart module we transform to per-team cumulative points:

```ts
[
  { teamId: 17, points: [
    { x: 0, goals: 0 },        // game start
    { x: 1, goals: 3 },        // end of Q1
    { x: 2, goals: 5 },        // end of Q2
    { x: 3, goals: 8 },        // end of Q3
    { x: 4, goals: 11 },       // end of Q4
  ]},
  { teamId: 23, points: [...] },
]
```

The x-axis is **periods elapsed** (0..4 for regulation, +1 per OT).
Resolution is per-quarter, not per-goal — that is what the data supports
today. If the parser ever extracts goal-level timestamps (mentioned as a
stretch goal in the roadmap), the same chart picks them up unchanged with
finer x values.

### Sub-chart: score difference

A small **secondary panel** below the main chart shows `home_goals -
away_goals` over time, filled above/below zero with each team's color. This
is the "win probability"-style strip:

```
+5 ┤      ░░░░░░ Home up 5
+3 ┤   ░░░░░░░░░░░
+1 ┤   ░░░░░░░░░░░░░
 0 ┼───────────────────────  ← tied
-1 ┤
-3 ┤▒▒▒  Away early lead
-5 ┤
   │ Q1 │ Q2 │ Q3 │ Q4
```

This is two `area()` paths from d3-shape — maybe 30 lines total. It is what
makes the visual feel like a "game flow", not just two lines.

### File layout

- `packages/web/src/charts/gameFlow.ts` — `renderGameFlow(el, data, opts)`
  returning `ChartHandle`.
- `packages/web/src/charts/types.ts` — add `GameFlowDatum`,
  `GameFlowOptions`. The datum reuses `QuarterByQuarterDatum`'s `periods`
  field (DRY), wrapping with team metadata.
- `packages/web/src/charts/index.ts` — export.
- `packages/web/src/charts/__tests__/gameFlow.test.ts` — vitest:
  cumulative math, OT handling, tied-game baseline, missing-period
  imputation.
- `packages/web/src/charts/__demo__.ts` + `__demo__.html` — three demo
  games (blowout, comeback, nail-biter).
- `packages/web/src/views/gameDetail.ts` — render `gameFlow` *above*
  `quarterByQuarter` since the line tells the story and the bars provide
  detail.

### Theme + responsive

- Use the existing `createResponsiveSvg` + `readTheme` helpers from
  `charts/internal/svg.ts`. Same dark-mode behavior as every other chart.
- On viewports `<480 px` collapse the secondary score-difference panel and
  shrink quarter labels to "Q1/Q2/Q3/Q4". The main line stays full-width.

### Accessibility

- `<title>`: `"Game flow: ${away} ${awayFinal}, ${home} ${homeFinal}"`.
- `<desc>`: auto-generated narrative, e.g. *"Home led from the second quarter
  on. The game's largest lead was 5 goals in the third quarter. Away scored
  3 unanswered in the fourth to make it interesting."*
- Visually-hidden `<table>` mirror with one row per quarter, two columns of
  cumulative scores. Same pattern as RFC 05.
- High-contrast outline on lines (1.5 px), not just color — distinguishes
  series for users with color-vision deficiencies. Optionally use a
  dash-pattern on the away series.
- Honor `prefers-reduced-motion` — no draw-on animation when set; just paint
  the final state.

## Scope

### In

- `gameFlow.ts` chart module + types + tests + demo.
- Cumulative-score line for two teams with quarter gridlines.
- Score-difference secondary panel.
- Final-score labels on the right.
- Auto-generated `<desc>` narrative.
- Integration on `gameDetail.ts` above the existing bar chart.
- OT handling (treat as additional periods on the x-axis).

### Out

- Goal-level (in-quarter) timestamps — depends on parser changes that are
  not in this RFC.
- Player-level event annotations on the line ("Smith scored at 8:42 of Q3")
  — same parser dependency.
- Win-probability model (would need historical per-quarter base rates).
- Replacing `quarterByQuarter.ts` — deliberate; both charts coexist.
- Live in-game updates (would need a websocket; current ingest is batch).

## Validation plan

- **Unit tests** — `gameFlow.test.ts`:
  - Cumulative math: `[3, 2, 3, 3]` → `[0, 3, 5, 8, 11]`.
  - Missing periods imputed as 0 (not undefined).
  - OT periods extend the x-axis correctly.
  - Tied final score draws lines that meet at the right edge.
  - Step-after curve never crosses backwards (cumulative is monotonic).
- **Visual snapshots** — three canonical games in
  `__tests__/__snapshots__/`: a known blowout, a known comeback, a known
  one-goal game. Catches regression in axis layout or color.
- **Manual QA** — open the recap of the most-viewed recent game and confirm
  the line shape matches the journalist's narrative in the recap text.
- **Mobile** — render on iPhone SE viewport (375 px) and confirm both panels
  stay legible; if the score-difference panel feels cramped, hide it under
  the breakpoint.
- **Performance** — non-issue; max ~12 points (4 quarters × 3 OTs) per
  series, two series. Renders in <5 ms.

## Effort estimate

**S–M (small–medium)** — ~1.5 days:

- Half day: chart module + cumulative math + step lines.
- Half day: secondary score-difference panel + final-score labels.
- Half day: tests, demo cell, a11y narrative, integration on
  `gameDetail.ts`, dark-theme tuning.

This is genuinely small because:

- The data is already in the page (no API changes).
- `quarterByQuarter.ts` is a perfect template — same theme helper, same
  responsive svg pattern, same dependency set.
- d3-shape's `line()` + `curveStepAfter` does the heavy lifting in one call.

## Risk

- **OT period numbering inconsistency.** Some games may have `periodNumber:
  5` for OT, others might not. Need to confirm against the ingest pipeline
  and handle gaps gracefully. Low risk — verifiable in 10 min against the
  dev DB.
- **Auto-generated narrative could read awkwardly** for unusual games (e.g.
  every quarter tied). Mitigation: keep the narrative template conservative;
  fall back to a plain "Final: away X, home Y" if no clear story emerges.
- **Visual clutter** if both this chart *and* the bar chart are stacked.
  Mitigation: the line goes first (story), bars second (detail), with a
  small heading separating them.
- **Score-difference panel doubles vertical space.** If the page feels
  bottom-heavy, make the secondary panel collapsible (closed by default on
  mobile, open by default on desktop).

## Open questions

1. **Replace or coexist with `quarterByQuarter.ts`?** RFC proposes coexist
   (line above, bars below). If we want to reduce page weight, the bar chart
   could move into a "details" disclosure.
2. **Score-difference panel: required for v1, or stretch?** It is what makes
   the chart feel like a "flow" rather than just two lines, but adds ~30%
   to the implementation. Recommend ship it together.
3. **Auto-generated `<desc>` narrative — how aggressive?** A neutral one-line
   summary is safe; a multi-sentence story carries more risk of sounding
   robotic. Lean conservative.
4. **OG image / share card** — does Han's `components/postImage.ts` pipeline
   want a flow-chart variant for sharing? Probably yes, but treat as a
   follow-up RFC.
5. **Do we surface this on `teamDetail.ts`** as a small multiples grid (one
   mini-flow per recent game)? Compelling, but wait until the single-game
   version ships and we know the rendering cost.
