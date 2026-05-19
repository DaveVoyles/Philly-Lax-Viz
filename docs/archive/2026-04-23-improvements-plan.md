# Site improvements plan — 2026-04-23

## User questions
1. What other improvements do you recommend?
2. What makes this easier for users to look at?
3. Which additional data do you need? Can you access MaxPreps with my creds?

---

## Question 3 first (decisions needed)

### Should I log in to MaxPreps with your credentials?
**Recommendation: no, do not store or use your MaxPreps password.**

Reasons:
- ToS — MaxPreps prohibits automated access; your account could be banned
- Security — passwords stored in agent context = exfil risk; you already exposed it once in chat
- Brittle — login flow is JS-rendered, captcha-protected, and changes frequently
- Legal — ingesting their data wholesale ≠ fair-use even with login

**Better alternatives** (ranked by signal-per-effort):
1. **PIAA official** — already integrated for *team records*; we should expand to *box scores* for the 29 reconcile-queue games. PIAA publishes per-game results during postseason, free, no login.
2. **LaxNumbers.com** — already partially scraped; expand to per-game box scores (they have them, we only pull team scores today).
3. **Manual paste workflow** — for the 29 suspect games, you (or I) open MaxPreps in a browser, paste the corrected score into a CSV column, and an ingest script applies it. Audit trail stays clean.
4. **Public Inquirer / DelcoTimes RSS** — covers ~30% of suspect games with named recap content.

### Additional data you could connect (no scraping required)
- **Player rosters from team websites** — most coaches publish PDFs; manual upload is fine for 207 teams
- **Schedule from MaxPreps** — already in DB via `schedule_games`; could enrich with venue + start time
- **Photos** — `post_images` table exists; not surfaced in UI yet
- **Class/division** — partially in `piaa_official_teams`; could drive a "compare within Class 3A" view

---

## Question 2: site UX gaps (what makes it easier to read)

Today the site is data-dense but cold. Surveyed routes: Dashboard, Leaders, Compare, Network, Schedule, Constellation, Data quality, Anomalies, Sources. **9 navigation items is a lot.** Recommend reorganizing into 3 buckets: **Discover** (Dashboard, Leaders, Schedule), **Analyze** (Compare, Network, Constellation), **Trust** (Data quality, Anomalies, Sources).

### High-impact UX wins
1. **Anomaly callouts** — flag games where `player_goals_sum > team_score` with a yellow banner ("⚠️ This box score is being reconciled — see PIAA"). User specifically asked for this for player 48816 (already fixed, but the *concept* is reusable).
2. **Confidence badges on stats** — `player_stats.confidence` is in the schema and we never show it. Show a 🟢/🟡/🔴 dot per stat row.
3. **"Last updated" everywhere** — RSS ingest is nightly; users currently have no idea how stale a page is. Add to header + every game card.
4. **Empty-state copy** — when a player has 0 games yet, today the player page just shows nothing. Should say "No games tracked yet for {name} this season."
5. **Mobile layout** — dashboard tiles are likely 4-col grid; needs a stacked layout below 768px.
6. **Game date sorting** — schedule defaults to oldest first; should be most recent first by default with a toggle.
7. **Search-as-you-type** — there's no search. Adding `/api/search?q=` with a header bar would be the single biggest discoverability win.
8. **Team page win/loss visualization** — the season record chart is good; pair it with a sparkline of margin-of-victory by game.
9. **Link the players inside game pages** — when looking at a game box, names should link to player detail.
10. **Color blindness check** — verify the win/loss/team color palette passes WCAG AA contrast and works in deuteranopia.

### Lower-impact polish
- Loading states (spinners > "Loading…" text)
- 404 view (currently silent)
- Print-friendly schedule
- OpenGraph cards so a shared link previews like a stat card
- Favicon (currently the Vite default)

---

## Question 1: other improvements (engineering hygiene + data depth)

### A. Data quality (continues from H3 review queues)
- **Process the LN aliases CSV** once you mark `accept`/`reject` (already queued as H4-L4)
- **Process the team-score reconcile queue** once you fill in PIAA scores (H4-L5)
- **Real parser bugs Yoda found**: g446 double-attribution, g541 em-dash team leak (H4-L1, L2)
- **Goalie stats / FO stats** — `saves` and `fo_won/taken` columns exist but no leaderboard surfaces them
- **Ground balls leaderboard** — same: data is in DB, no UI for it
- **Per-quarter scoring trends** — `game_periods` table has data; chart not used on game detail page

### B. Operational hygiene
- **Secrets** — still blocking nightly ingest CI (your task; runbook ready)
- **Snapshot the DB to Azure Blob nightly** — only backup we have now is the in-image seed; if you delete the local DB you lose the rescued prod data
- **Health endpoint** — `routes/health.ts` exists; surface a `/status` page so you can see "ingest ran X hours ago, Y games added"
- **Dead route check** — `seasons.ts` and `rivalries.ts` exist; verify they're wired up or delete

### C. Content surfaces (new things)
- **Coach view** — pivot stats by team-level coaching tendencies (avg margin, FO win rate, save %). Useful narrative.
- **Rivalry pages** — `rivalries.ts` route exists; not in nav. Surface it.
- **PIAA bracket viewer** — postseason starts soon; could pull bracket from PIAA and overlay our team data
- **Embeddable widgets** — `<iframe>` of one team's record badge that local club sites could embed

---

## Proposed wave plan

If you want to act on this, three natural waves:

**Wave I (Visibility) — 4-lane fleet**
- Lane 1 (M): Header search bar + `/api/search?q=`
- Lane 2 (M): Anomaly banner on game/player pages when score < player goals sum
- Lane 3 (S): "Last updated" timestamps everywhere + status page
- Lane 4 (S): Mobile responsive grid for dashboard

**Wave J (Stat depth) — 3-lane fleet**
- Lane 1 (M): Goalie + FO + GB leaderboards
- Lane 2 (M): Per-quarter scoring chart on game detail
- Lane 3 (S): Confidence badges + click-through on game box

**Wave K (Trust + ops) — 3-lane fleet**
- Lane 1 (S): Nightly DB snapshot to Azure Blob
- Lane 2 (S): Audit dead routes; remove or surface
- Lane 3 (M): Process LN alias + score-reconcile review queues (depends on user input)

### Sizing notes
- "S" = single view/route change with tests
- "M" = full vertical slice (api + view + chart + tests)

### Dependencies
- Waves I and J are independent — could run together
- Wave K-Lane 3 blocks on you completing the CSV reviews
