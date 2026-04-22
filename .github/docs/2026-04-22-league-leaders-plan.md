# League Leaders page — plan

## Request

> "Page with charts for the league leaders. Aggregate goals, assists or points (G+A)
> per player AND per team. The more data we collect/analyze, the better."

Build a `#/leaders` page that surfaces season-aggregate leaderboards for both
**players** and **teams**, with charts + sortable tables, driven by the existing
`player_stats` and `games` tables.

## Target outcome

- New route `#/leaders` with two tabbed sections (Players · Teams).
- For each section: metric selector → horizontal bar chart (top N) + full sortable table below.
- New API endpoints powering the page; reusable so other views can call them later.
- Nav link from the dashboard.
- Tests + typecheck stay green; site auto-reloads via existing dev server.

## Available data (verified against live DB)

| Per-player per-game | Per-team per-game |
| --- | --- |
| `goals`, `assists`, `ground_balls`, `caused_turnovers`, `saves`, `fo_won`, `fo_taken` | `home_score`/`away_score`, `ot_periods`, `postponed` |

Rows: 1324 player_stats · 127 games · 1044 players · 180 teams.

## Metrics to expose

### Player leaders (`/api/leaders/players`)

| metric | formula | tiebreak |
| --- | --- | --- |
| `points` (default) | `SUM(goals + assists)` | goals desc, games asc |
| `goals` | `SUM(goals)` | assists desc |
| `assists` | `SUM(assists)` | goals desc |
| `ground_balls` | `SUM(ground_balls)` | games asc |
| `caused_turnovers` | `SUM(caused_turnovers)` | games asc |
| `saves` | `SUM(saves)` | games asc |
| `fo_pct` | `SUM(fo_won) * 1.0 / NULLIF(SUM(fo_taken),0)` | requires `fo_taken >= minAttempts` (default 10) |
| `points_per_game` | `SUM(g+a) * 1.0 / COUNT(*)` | requires `minGames` (default 2) |

Filters: `metric`, `limit` (default 25, max 100), `minGames` (default 1), `teamId` (optional).

### Team leaders (`/api/leaders/teams`)

| metric | formula |
| --- | --- |
| `wins` (default) | count games where team's score > opponent's score |
| `losses` | mirror of wins |
| `win_pct` | wins / (wins+losses), excludes ties; min 1 game |
| `goals_for` | sum of team's score across all games |
| `goals_against` | sum of opponent score |
| `goal_diff` | `goals_for − goals_against` |
| `gpg` | `goals_for / games_played` |
| `gapg` | `goals_against / games_played` |

Filters: `metric`, `limit` (default 25, max 100).

## API response contract (FROZEN — unblocks frontend)

```jsonc
// GET /api/leaders/players?metric=points&limit=25&minGames=1
{
  "metric": "points",
  "minGames": 1,
  "rows": [
    {
      "rank": 1,
      "playerId": 17,
      "playerName": "Conor Morsell",
      "teamId": 96,
      "teamName": "Haverford School",
      "gamesPlayed": 3,
      "goals": 11, "assists": 9, "points": 20,
      "groundBalls": 0, "causedTurnovers": 0, "saves": 0,
      "foWon": 0, "foTaken": 0, "foPct": null,
      "value": 20            // primary metric value, for chart
    }
  ]
}
```

```jsonc
// GET /api/leaders/teams?metric=wins&limit=25
{
  "metric": "wins",
  "rows": [
    {
      "rank": 1,
      "teamId": 142,
      "teamName": "Ridley",
      "gamesPlayed": 3, "wins": 3, "losses": 0,
      "winPct": 1.0,
      "goalsFor": 50, "goalsAgainst": 18,
      "goalDiff": 32, "gpg": 16.67, "gapg": 6.0,
      "value": 3
    }
  ]
}
```

Always include all aggregate columns (cheap), so the frontend table can show secondary stats without an extra request.

## UI design

`#/leaders` view:

- Top: tab strip — **Players** | **Teams** (default Players).
- Metric selector (chips) directly under the tab.
- Horizontal bar chart of top N (default 15) — reuses generalized `topScorers.ts` (rename to `horizontalLeaderboard.ts`, accept `{label,value}[]`).
- Full sortable table below the chart with all columns; rows are clickable → `#/players/:id` or `#/teams/:id`.
- Footer caption: total players/teams considered + filters applied.

Add nav link on dashboard header: "League Leaders →".

## Wave plan

| Wave | Goal |
| --- | --- |
| Wave 1 (this) | Ship endpoint + UI + nav + tests |
| Wave 2 (future, if user wants) | Per-week trend, per-conference filters, goalie leaderboards split out |

### Wave 1 lanes

| Lane | Fleet | Effort | Scope | Blocked by | Status | Checkpoint |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Han 😉🚀 | M | Backend: `queries/leaderboards.ts` + routes `routes/leaders.ts` (players + teams) + register in `app.ts` + 8-10 vitest cases | — (contract frozen above) | Pending | 10m |
| 2 | Yoda 👽✨ | M | Frontend: generalize `topScorers.ts` → `horizontalLeaderboard.ts`, add view `views/leaders.ts`, wire router (`#/leaders`), add API client methods, dashboard nav link | — (mock against frozen contract; swap to real on completion) | Pending | 10m |
| 3 | Leia 👑💁‍♀️ | S | Docs: update `README.md` quickstart with new route + endpoints; verify ports doc; add a short "metrics glossary" subsection | — | Pending | 5m |

Critical path = Wave 1 itself; all 3 lanes parallel because contract is locked above.

### Synthesis

After all lanes ✅:
1. Run `pnpm -r typecheck && pnpm -r test`.
2. Confirm dev server still live at :5173 (it reloads HMR on edits).
3. Curl `/api/leaders/players?metric=points` and `/api/leaders/teams?metric=wins` → verify shape.
4. Open `http://localhost:5173/#/leaders`.

### Hard stops

| Lane | Hard stop |
| --- | --- |
| 1 (M) | 30m |
| 2 (M) | 30m |
| 3 (S) | 15m |

## Pre-flight

- ✅ Contract locked (unblocks Lane 1 ↔ Lane 2 parallelism)
- ✅ Lane boundaries non-overlapping (no file collisions)
- ✅ Dev servers running (HMR will pick up Lane 2's changes; server lane requires restart — Lane 1 owns that restart at the end)
- ✅ Risk: **Low** (additive endpoints + new view + new route; no schema changes, no auth)

## Communication log

| Time | Lane | Fleet | Update |
| --- | --- | --- | --- |
| 13:08 | all | — | 🚀 Wave 1 launched — 3 lanes in parallel against frozen contract |
| 13:09 | 3 | Leia 👑💁‍♀️ | ✅ README updated (routes, API section, metrics glossary) — 54s |
| 13:12 | 1 | Han 😉🚀 | ✅ Backend done — 33/33 tests, server restarted on :3001, contract verified — 184s |
| 13:13 | 2 | Yoda 👽✨ | ✅ UI done — typecheck+build clean, page live at #/leaders, dashboard nav added — 204s |
| 13:14 | — | Orchestrator | ✅ Synthesis: full repo `pnpm -r typecheck` clean, `pnpm -r test` 128/128, all 5 sample API curls pass shape, web :5173 200 |

## Wave 1 Retrospective

### Actual vs estimated
- Lane 1 (Han, M): 184s — well under M (30m) hard stop · ✅
- Lane 2 (Yoda, M): 204s — well under M hard stop · ✅
- Lane 3 (Leia, S): 54s — well under S (15m) hard stop · ✅

### Critical path
- Frozen contract upfront eliminated the Lane 1 → Lane 2 dependency, so all 3 ran fully parallel. Wall-clock = max(204s) ≈ 3.5m. No idle waiting; no blockers.

### What went well
- **Contract-first planning**: API shape locked in plan file; both backend and frontend coded to it independently — no rework on synthesis.
- **Clear file boundaries**: zero merge conflicts (Han = `packages/server`, Yoda = `packages/web`, Leia = `README.md`).
- **Bonus extras**: Han added `pointsPerGame` (additive); Leia updated the architecture diagram unprompted; Yoda fixed a router bug (hash query stripping) needed for bookmarkable filters.

### What to improve
- All lanes finished well below their checkpoint windows — could have sized them as S, but M was a safe call given new files + tests.
- Inline styles on leaders page (Yoda's caveat) should move to `styles.css` next time we touch it.

## Next Wave (proposed, not launched)

User-facing wins for a future Wave 2 (await user request):
1. Per-week / date-range filter on leaders.
2. Goalie-specific leaderboard (save % requires shots-faced data; would need a new ingest field).
3. Conference / classification filters.
4. Move leaders page inline styles into `styles.css`.
