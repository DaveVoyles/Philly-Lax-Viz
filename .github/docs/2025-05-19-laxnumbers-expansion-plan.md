# LaxNumbers Expansion — Infrastructure Plan

**Date:** 2025-05-19
**Status:** Proposed
**Author:** Copilot (planning mode)

---

## 1. Current State

### What exists today

| Component | Location | What it does |
|-----------|----------|-------------|
| Scoreboard API client | `pipelines/laxnumbers.ts` | Fetches from `laxnumbers.com/services/scoreboard/3453` (PA Boys HS scoreboard ID) |
| Team resolver | `pipelines/teamResolver.ts` | Matches LaxNumbers team names to DB `teams` rows via `team_aliases` |
| Anomaly persistence | `pipelines/anomalies.ts` | Stores unresolved teams in `ingest_anomalies` |
| Alias CSV emitter | `scripts/emitLaxNumbersAliasCsv.ts` | Outputs a review CSV of unknown teams with fuzzy match suggestions |
| Auto-seed aliases | `scripts/seedAliasesFromAnomalies.ts` | Seeds obvious 1:1 name matches from anomalies into `team_aliases` |
| CLI integration | `cli/ingest.ts` | `pnpm ingest --source=laxnumbers --date=X [--apply]` |
| Migration 012 | `migrations/012_laxnumbers_provenance.sql` | Adds `source` column (`phillylacrosse` / `laxnumbers`) |
| Migration 018 | `migrations/018_stat_source_tracking.sql` | Stat source authority tracking |
| Seeded aliases | `scripts/seedTeamAliases.ts` | ~50 curated high-confidence + reviewed aliases from 2026-04-24 |

### Current limitations

1. **Score-only data** — LaxNumbers scoreboard API only returns team names + final scores. No player stats (goals, assists, etc.).
2. **Alias coverage gaps** — ~15-20 team names remain unresolved (stored in `ingest_anomalies`).
3. **No per-game player stats** — LaxNumbers does NOT have individual game box scores. It tracks career totals only. Per-game stats must come from Hudl or coach uploads.
4. **Single scoreboard** — Hardcoded to scoreboard 3453 (PA Boys HS). No expansion to other states/levels.

### 2026-05-19 Research findings (from live site inspection)

**URL patterns discovered:**

| Resource | URL pattern | Example |
|----------|-------------|---------|
| Team page (schedule + scores) | `/team_info.php?y={year}&t={team_id}` | `?y=2026&t=13039` (Harriton) |
| Conference ratings | `/ratings.php?y={year}&v={view_id}` | `?y=2026&v=3454` (PA East) |
| Conference scoreboard | `/scoreboard/{view_id}` | `/scoreboard/3454` |
| Career player records | `/ratings.php?y={year}&v={view_id}&mode=player-stats` | Career points leaders |
| Score correction form | `/fix_score.php?g={game_id}` | `?g=34370` (score report only, not box score) |

**Key IDs:**

| Entity | LaxNumbers ID |
|--------|--------------|
| Harriton | `t=13039` |
| PA East conference | `v=3454` |
| IAC/Private schools | `v=3468` |
| PA Boys HS scoreboard | `3453` |

**What IS available:**
- Team schedules with game scores + game IDs (from `/fix_score.php?g=` links)
- Conference/region team ratings (Rating, AGD, SCHED)
- Career player stats (aggregated: Points, Goals, Assists, FOW, Saves)
- Team metadata (mascot, head coach, record, divisions, social links)

**What is NOT available:**
- Per-game player box scores (no individual game pages exist — 404)
- Per-team seasonal player stats (mode=player-stats on team page doesn't add player data)
- Per-game breakdown of any kind beyond the final score

---

## 2. Expansion Goals

### Goal A: Automate daily score ingest (quick win)
Add LaxNumbers to the nightly CI pipeline so scores flow in automatically.

### Goal B: ~~Per-game player stats~~ → Team ratings + career stats import

**REVISED (2026-05-19):** Per-game player stats do NOT exist on LaxNumbers. The site only tracks game scores and career stat totals. Instead, Goal B pivots to:

1. **Import team ratings** — scrape conference ratings pages for team Rating, AGD, and SCHED values
2. **Import career player records** — scrape career leaders from `/ratings.php?mode=player-stats`
3. **Map LaxNumbers team IDs** — store `laxnumbers_team_id` for each team to enable deep-linking
4. **Per-game stats source** — remains Hudl + coach uploads + phillylacrosse.com RSS

### Goal C: Improve alias coverage (ongoing)
Reduce unknown-team anomalies from ~15-20 to <5 via automated fuzzy matching + admin review UI.

---

## 3. Architecture — Goal A (Nightly Automation)

**Effort:** XS (< 1 hour)

### Changes

1. **`ingest-nightly.yml`** — Add a step after RSS ingest:
   ```yaml
   - name: LaxNumbers scores
     run: pnpm ingest --source=laxnumbers --since=$(date -d '-3 days' +%Y-%m-%d) --until=$(date +%Y-%m-%d) --apply
   ```
   Rationale: 3-day lookback catches late-posted scores.

2. **No code changes required** — the pipeline already supports `--since/--until/--apply`.

### Risks
- LaxNumbers API rate limiting (unlikely at 1 req/day)
- New unknown teams each season (handled by anomaly pipeline)

---

## 4. Architecture — Goal B (Team Ratings + Career Stats)

**Effort:** S-M (1-2 waves)

### Data available from live site research

LaxNumbers does **NOT** have per-game box scores. The `/fix_score.php?g={id}` links are for score correction reporting only — hitting the game_id directly (e.g., `/game_info.php?g=34370`) returns 404.

**What we CAN scrape:**

1. **Team ratings** from `/ratings.php?y=2026&v=3454` — includes Rating, AGD, SCHED per team
2. **Career player records** from `/ratings.php?y=2026&v=3454&mode=player-stats` — Points, Goals, Assists, FOW, Saves
3. **Team metadata** from `/team_info.php?y=2026&t={id}` — mascot, coach, record, divisions

### Proposed architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                LaxNumbers Team Ratings Pipeline                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Fetch conference ratings page(s):                               │
│     GET /ratings.php?y=2026&v=3454 (PA East)                        │
│     GET /ratings.php?y=2026&v=3468 (IAC/Private)                    │
│                                                                     │
│  2. Parse HTML table → team name, rating, AGD, SCHED, record        │
│     Extract team_id from links (/team_info.php?t={id})              │
│                                                                     │
│  3. Resolve team names to our teams table                           │
│     Store laxnumbers_team_id for future deep-linking                │
│                                                                     │
│  4. Upsert team ratings into rankings or a new ratings table        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Migration needed

```sql
ALTER TABLE teams ADD COLUMN laxnumbers_team_id INTEGER;
-- Or a separate laxnumbers_ratings table for time-series tracking
```

### Per-game player stats — alternative sources

Since LaxNumbers doesn't provide per-game stats, the sources are:
- **phillylacrosse.com RSS** — game summaries with top scorers (current primary)
- **Coach uploads** — spreadsheet upload via the coach dashboard
- **Hudl** — authenticated scraper for per-game stats (requires coach invitation)

### Authority precedence for stats

```
coach_upload > phillylacrosse (summary parser) > laxnumbers > hudl
```

### Rate limiting & politeness

- 1 request per 2 seconds
- Respect `robots.txt`
- User-Agent: `PhillyLacrosseVis/1.0`
- Cache raw HTML in `raw_cache_meta` (already exists in DB schema)

---

## 5. Architecture — Goal C (Alias Coverage)

**Effort:** S (1 wave, 3 lanes)

### Current flow
```
Unknown team in LaxNumbers → ingest_anomalies → emitLaxNumbersAliasCsv.ts → human reviews CSV → seedTeamAliases.ts
```

### Proposed improvements

1. **Auto-resolve high-confidence matches** — If Levenshtein distance = 1 and only one candidate team exists, auto-insert into `team_aliases` with `confidence=0.9, source='auto-fuzzy'`.

2. **Admin review UI** — New view at `#/admin/aliases`:
   - Shows unresolved anomalies with top-3 fuzzy suggestions
   - One-click "Accept" button to create alias
   - "Reject" button to mark anomaly as reviewed (won't be suggested again)

3. **Alias refresh on new season** — Script to re-run alias seeding at start of each season when new team names appear.

### New team_aliases sources

| Source value | Meaning |
|-------------|---------|
| `manual` | Manually added by admin |
| `laxnumbers-high-conf-YYYY-MM-DD` | Batch from CSV review |
| `laxnumbers-curated-YYYY-MM-DD` | Curated after triage |
| `auto-fuzzy` | Auto-accepted Levenshtein ≤ 1 |
| `coach-submitted` | Coach verified via upload |

---

## 6. Implementation Phases

### Phase 1 — Quick Wins ✅ DONE
- [x] Add LaxNumbers to nightly CI (`ingest-nightly.yml`) — already existed
- [x] Auto-resolve Levenshtein-1 aliases (update `seedAliasesFromAnomalies.ts`)

### Phase 2 — Research ✅ DONE (2026-05-19)
- [x] Investigated LaxNumbers site structure — team pages, ratings, player records
- [x] Confirmed NO per-game box scores exist (game pages return 404)
- [x] Discovered URL patterns, team IDs, conference view IDs
- [x] Game IDs exist in `/fix_score.php?g=` links but only for score correction reporting

### Phase 3 — Team Ratings Import (next)
- [ ] Build `parsers/laxnumbersRatings.ts` — scrape conference ratings tables
- [ ] Build `pipelines/laxnumbersRatings.ts` — orchestrate fetch + parse + upsert
- [ ] Add migration for `teams.laxnumbers_team_id`
- [ ] Map our teams to LaxNumbers team IDs using name resolution
- [ ] Add to nightly CI

### Phase 4 — Career Player Records (optional)
- [ ] Parse career leaders from `/ratings.php?mode=player-stats`
- [ ] Match to our players via fuzzy name matching
- [ ] Store career totals (could enrich player profiles on the web client)
- [ ] Admin alias review UI for unresolved names

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LaxNumbers changes HTML structure | Parser breaks silently | Fixture-based tests + anomaly spike alerts |
| Player name mismatches create duplicates | Stat inflation | Conservative matching (skip if ambiguous) + dedup script |
| Rate limiting / IP ban | Ingest fails | 2s delay, cache aggressively, respect robots.txt |
| LaxNumbers removes public access | Data source lost | We only supplement existing data; phillylacrosse.com remains primary |
| Season boundary (new teams each year) | Unknown team spike | Auto-seed + admin review at season start |

---

## 8. Decision: When to Start

**Recommendation:** Phase 1 (nightly automation + auto-aliases) can ship immediately. Phase 2 requires ~30 minutes of manual research on the LaxNumbers game page structure. Phase 3-4 are a full fleet wave (4-6 hours).

**Timing consideration:** LaxNumbers data is most valuable during the active season (March-June). Outside that window, development can proceed but testing requires fixture data.

---

## 9. Open Questions

1. Does the LaxNumbers scoreboard API return a `game_id` field? (Need to inspect a real response.)
2. Is there a JSON endpoint for box scores, or only rendered HTML?
3. What is LaxNumbers' `robots.txt` policy?
4. Do we need explicit permission from LaxNumbers to scrape player stats?

---

*End of plan. Approve Phase 1 to proceed with implementation.*
