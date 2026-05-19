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
3. **No automation** — LaxNumbers ingest runs manually (`pnpm ingest --source=laxnumbers --since=X --until=Y --apply`).
4. **No per-game player stats** — LaxNumbers does have individual game pages with box scores (`phillylaxnumbers.com/games/{id}`) but we haven't built a parser for those.
5. **Single scoreboard** — Hardcoded to scoreboard 3453 (PA Boys HS). No expansion to other states/levels.

---

## 2. Expansion Goals

### Goal A: Automate daily score ingest (quick win)
Add LaxNumbers to the nightly CI pipeline so scores flow in automatically.

### Goal B: Per-game player stats (major expansion)
Scrape individual game pages for box-score data (goals, assists, ground balls, etc.) per player.

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

## 4. Architecture — Goal B (Per-Game Player Stats)

**Effort:** M (2-3 waves, ~8 lanes)

### Data source analysis

LaxNumbers game pages at `https://phillylaxnumbers.com/games/{game_id}` contain:
- Home/away team names
- Per-player: goals, assists, ground balls, caused turnovers, saves, faceoff won/taken
- This is the SAME stat set we already track in `player_stats`

**Key questions:**
1. How do we discover game IDs? → The scoreboard API likely returns them (needs investigation).
2. How do we match LaxNumbers players to our `players` table? → Fuzzy name matching + `player_aliases` table.
3. Rate limiting? → Probably need 1-2s delay between requests.

### Proposed architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LaxNumbers Player Stats Pipeline                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Scoreboard API → fetch game IDs for date range                  │
│     (extend existing LaxRawGame type to capture game_id)            │
│                                                                     │
│  2. For each game_id where both teams resolve:                      │
│     GET https://phillylaxnumbers.com/games/{id}                     │
│     → Parse HTML box score OR discover JSON API endpoint            │
│                                                                     │
│  3. Resolve players via player_aliases + fuzzy matching             │
│     → Create new players if confidence > threshold                  │
│     → Store anomalies if unresolved                                 │
│                                                                     │
│  4. Write to player_stats with source='laxnumbers'                  │
│     → Additive only: don't overwrite existing coach_upload/summary  │
│     → Migration: add laxnumbers_game_id to player_stats?            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### New components needed

| Component | Description |
|-----------|-------------|
| `parsers/laxnumbersBoxScore.ts` | HTML or JSON parser for individual game pages |
| `pipelines/laxnumbersStats.ts` | Orchestrates: fetch game IDs → fetch box scores → resolve players → write stats |
| `playerResolver.ts` (or extend teamResolver) | Fuzzy match LaxNumbers player names to `players` rows |
| Migration 022 | Add `laxnumbers_game_id TEXT` column to `games` table for dedup |
| `player_aliases` seeding | Script to seed player aliases from initial LaxNumbers scrape |

### Player resolution strategy

1. **Exact match:** Normalize both names (lowercase, strip suffixes like "Jr.", collapse whitespace) and match against `players.name_normalized` WHERE `team_id` = resolved team.
2. **Fuzzy match:** If no exact match, use Levenshtein distance (already implemented in `emitLaxNumbersAliasCsv.ts`). Accept if distance <= 2 AND only one candidate.
3. **Create new:** If team is resolved but player is unknown AND we have high confidence (e.g., name appears in multiple games), create the player.
4. **Skip + anomaly:** If ambiguous, store in `ingest_anomalies` for manual review.

### Authority precedence for stats

```
coach_upload > phillylacrosse (summary parser) > laxnumbers > hudl
```

If a `player_stats` row already exists for (game_id, player_id) with source != 'laxnumbers', do NOT overwrite.

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

### Phase 1 — Quick Wins (do now)
- [ ] Add LaxNumbers to nightly CI (`ingest-nightly.yml`)
- [ ] Auto-resolve Levenshtein-1 aliases (update `seedAliasesFromAnomalies.ts`)

### Phase 2 — Game ID Discovery (research)
- [ ] Investigate LaxNumbers scoreboard API for game ID fields
- [ ] Test `phillylaxnumbers.com/games/{id}` page structure
- [ ] Determine if there's a JSON API endpoint for box scores

### Phase 3 — Box Score Parser (implementation)
- [ ] Build `parsers/laxnumbersBoxScore.ts` + tests with HTML fixtures
- [ ] Build `pipelines/laxnumbersStats.ts`
- [ ] Add migration for `games.laxnumbers_game_id`
- [ ] Player resolution logic

### Phase 4 — Integration & Nightly
- [ ] Add to nightly CI with rate limiting
- [ ] Admin alias review UI
- [ ] Monitoring: anomaly count dashboard widget

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
