# Source recon — Wave 1 Lane 3 (Leia 👑💁‍♀️)

**Date:** 2026-04-22
**Scope:** READ-ONLY recon for the anomaly hunt fleet. Verify source-of-truth
options + sanity-check live-prod after the v8 stat-cap fix.

---

## 1. phillylacrosse.com — records / leaders pages

**Conclusion: there is no dedicated records, leaders, or all-time page worth
parsing for 2026 boys.**

What I checked:

- `https://phillylacrosse.com/` — the homepage is a chronological feed of
  daily summary posts, sponsor tiles, and college/recruiting articles. No
  "Records" / "Leaders" / "All-Time" nav link.
- `https://phillylacrosse.com/category/2026-2/` — **404**. There is no clean
  per-season archive URL.
- `https://phillylacrosse.com/?s=records+2026+boys` — search returns the
  same daily summary posts (e.g. "All-America senior game" announcement,
  Wednesday/Tuesday boys'/girls' summaries). No structured records page.

**Implication for our parser:** the only signal for milestones / records on
PhillyLacrosse remains the *prose parentheticals inside summary posts*
(e.g. `Sullivan 5g (Set School record 173 Goals)`). This is exactly what
v8 hardened against and what Wave 1 Lane 2 (Yoda) is re-scanning.

---

## 2. LaxNumbers — endpoints discovered

Base: `https://laxnumbers.com`

Scoreboard 3453 = the Pennsylvania boys' HS schedule we already pull. The
site's nav also exposes a **LaxRecords** section with rich per-stat record
endpoints. Each one is a single AngularJS page that hydrates from an XHR.

| Path                              | Description                                   |
| --------------------------------- | --------------------------------------------- |
| `/scoreboard/3453`                | PA boys HS scoreboard (already in pipeline)   |
| `/current-rankings/boys`          | Boys HS national rankings                     |
| `/player_stats.php?type=01`       | All-time records (career)                     |
| `/player_stats.php?type=11`       | Most points — single game                     |
| `/player_stats.php?type=12`       | Most goals — single game                      |
| `/player_stats.php?type=13`       | Most assists — single game                    |
| `/player_stats.php?type=14`       | Most face-off wins — single game              |
| `/player_stats.php?type=15`       | Most saves — single game                      |
| `/player_stats.php?type=21`       | Most points — season                          |
| `/player_stats.php?type=22`       | Most goals — season                           |
| `/player_stats.php?type=23`       | Most assists — season                         |
| `/player_stats.php?type=24`       | Most FO wins — season                         |
| `/player_stats.php?type=25`       | Most saves — season                           |
| `/player_stats.php?type=31..35`   | Career equivalents of the above               |
| `/team_info.php?y=<year>&t=<id>`  | Team detail (per season, per team_nbr)        |
| `/coach_stats.php?type=01..02`    | Coach career wins / championships             |

The `player_stats.php` pages render via an Angular template
(`{{stat.p_fname}} {{stat.p_lname}}`, etc.), which means values are loaded
by an XHR. A future lane could capture that XHR (e.g.
`/player_stats_data.php?type=22&state=PA&year=2026`) for a *cross-validation
oracle* against our 2026 boys totals — without ingesting any new players,
purely as an audit signal.

**Recon-only — no scraping or storage performed in this lane.**

---

## 3. Live-prod sanity check

API base: `https://pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`
(SWA `victorious-pond-...` proxies `/api/*` here.)

### `/api/health`

```
ok=true · schemaVersion=12 · seasons=[{2026, games:562}]
counts: teams=207 · games=562 · players=1929 · playerStats=6164 · anomalies=617
```

Healthy. Schema v12 (matches plan baseline). 617 anomalies logged.

### `/api/players/48816` — Declan Sullivan (Devon Prep)

✅**Sullivan totals are correct after v8.**

- Season: **28g / 5a / 33pts** in 7 games (matches expected post-v8).
- Max single-game goals: **6** (game 231, 2026-04-10). Well under the
  15-goal hard cap.
- Per-game distribution (top): 6, 5, 4, 1 — all plausible.
- Team derived record: 6-4-1 (Devon Prep).

The 174-goal parenthetical bleed is gone.

### `/api/anomalies/summary`

Total = 617. Top-3 reasons (parser-quality issues, not data corruption):

1. `sub-header did not match either game team` — 168
2. `period sum does not equal total — periods stored anyway` — 67
3. `team hint did not resolve to either side of the score line` — 61

The three v8 stat-cap clamps are present and correctly logged:

- `clamped to 0: goals=174>15` × 1  (Sullivan)
- `clamped to 0: goals=105>15` × 1  (Shohen)
- `clamped to 0: goals=19>15`  × 1  (Thompson)

### `/api/leaders` — endpoint shape

Note: the route is `GET /api/leaders/players` (and `/api/leaders/teams`),
not `/api/leaders`. `/api/leaders` returns 404. Worth fixing in docs / web
client if anyone is constructing the URL by hand.

### Top-10 points leaders, season 2026

Ranked by `/api/leaders/players?stat=points&season=2026&limit=10`:

| # | Player          | Team                     | G   | A   | Pts | GP | Max single-game G |
| - | --------------- | ------------------------ | --- | --- | --- | -- | ----------------- |
| 1 | Cole Carberry   | Springside Chestnut Hill | 40  | 29  | 69  | 12 | **6** ✅          |
| 2 | Jackson Lamb    | WC Rustin                | 33  | 36  | 69  | 12 | (not pulled)      |
| 3 | Finn Petrone.   | Radnor                   | 37  | 28  | 65  | 12 | (not pulled)      |
| 4 | Brody Bair      | Ridley                   | 30  | 35  | 65  | 12 | (not pulled)      |
| 5 | Conor Morsell   | Haverford School         | 33  | 26  | 59  | 11 | (not pulled)      |
| 6 | Evan Kostack    | Marple Newtown           | 44  | 14  | 58  | 13 | **6** ✅          |
| 7 | Mike Maro       | Methacton                | 35  | 20  | 55  | 12 | **5** ✅          |
| 8 | Dylan Miller    | Cardinal O'Hara          | 34  | 18  | 52  | 10 | (not pulled)      |
| 9 | Mikey Banks     | Penn Charter             | 31  | 21  | 52  | 12 | (not pulled)      |
| 10| Jace Kostack    | Marple Newtown           | 26  | 26  | 52  | 13 | (not pulled)      |

**No single-game total exceeds 6 goals across the spot-checks (3 random
leaders pulled). All within plausible HS lacrosse range.** Per-game
averages range 2.2 → 5.75 — consistent with elite HS scorers.

Two minor data-hygiene notes (not anomalies, just suggestions):

- `Finn Petrone.` has a **trailing period** in the player name. Looks like
  the same trailing-punct class v8's backfill cleaned (`:` `;` `,`) — `.`
  may have slipped through. Worth a one-line regex extension in a future
  cleanup wave.
- `Cole Carberry` is correctly marked `Springside Chestnut Hill` (team 161),
  which is good — earlier waves had a Springside-vs-SCH alias issue.

### Spot-checked games (recap URLs verified)

All 3 of the high-goal games have valid recap URLs that resolve to real
PhillyLacrosse summary posts:

- Game 92 (Marple Newtown 15–5, 2026-04-18) → `/2026/saturday-boys-sponsored-by-fusion-lacrosse/`
- Game 546 (Springside 11–10, 2026-03-07) → `/2026/fusion-lacrosse-friday-boys-summaries/`
- Game 178 (Methacton 8–7, 2026-04-14) → `/2026/tuesday-boys-summaries-sponsored-by-fusion-lacrosse-5/`

Player-goal totals are consistent with the team scores in each game (no
single player exceeded the team total, and no Σ player goals > team_score
for the spot-checked games).

---

## 4. Recommendations for Wave 2

**Primary recommendation:** Wave 1 + v8 caps appear to have neutralized the
catastrophic class of bug. Live-prod top-10 looks clean. Wave 2 should
**focus on Lane 1 (Han)'s cross-check audit output and Lane 2 (Yoda)'s
prose re-scan**, rather than expanding scope to a new source.

Secondary opportunities (defer unless cheap):

1. **Trailing-period name cleanup** — extend the v8 punctuation regex to
   strip trailing `.` (`Finn Petrone.` → `Finn Petrone`). 1-line fix.
2. **`/api/leaders` alias** — add a thin redirect / 301 from `/api/leaders`
   → `/api/leaders/players?stat=points` so both shapes work. Doc nit only.
3. **LaxNumbers cross-validation oracle** — *future* lane: capture the XHR
   feeding `/player_stats.php?type=22` for PA 2026, intersect by
   normalized name + team, and emit `cross-source-mismatch` anomalies for
   any of our season totals that diverge by > N%. **Do not import** any
   missing players (per fleet guardrail). This is a Wave 3+ idea, not Wave
   2 critical path.

**Nothing in this recon suggests a hidden Sullivan-class bug remains.**
The 617-anomaly count is dominated by parser-quality misses (sub-header
match failures, period sum mismatches), which are noise, not corruption.
