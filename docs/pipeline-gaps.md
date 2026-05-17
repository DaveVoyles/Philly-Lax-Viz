# Pipeline Gaps & Improvement Backlog

> **Last updated:** 2026-05-16  
> **Source:** Wave 0 audit (agents Han 😉🚀, Yoda 👽✨, Leia 👑💁‍♀️)  
> **Purpose:** Actionable gap list for agents and contributors

See `docs/architecture.md` for the full architecture reference.

---

## 1. Nightly Pipeline — Missing Steps

These scripts and categories exist in the codebase but are **not run in `ingest-nightly.yml`**.

### 1a. `rankings` crawl + ingest not wired

**Current state:** `crawl.ts` and `ingest.ts` both support `--category=rankings`. The nightly workflow only crawls/ingests `hs-summaries` and `scoreboard`. Rankings are synced via `syncPiaa.ts` (which does run nightly), so this is a **low-priority gap** — but the `rankings` raw cache never gets refreshed independently.

**Fix:** Add `--category=rankings` to the crawl step in `ingest-nightly.yml` after the `hs-summaries` crawl:
```yaml
- name: Crawl rankings
  run: pnpm --filter @pll/ingest crawl --category=rankings
  env:
    DB_PATH: ${{ github.workspace }}/data/lacrosse.db
```

**Priority:** Low — PIAA sync already covers ranking data

---

### 1b. `syncLogos.ts` not run nightly

**Current state:** Team logos are downloaded manually via `pnpm --filter @pll/ingest sync:logos`. Logos are stable during a season but go stale when new teams are added or MaxPreps updates images.

**Fix:** Add a monthly logo sync step (not nightly — MaxPreps would rate-limit nightly requests):
```yaml
# Could be a separate workflow triggered monthly
- name: Sync logos
  if: github.event_name == 'schedule' && ...  # monthly condition
  run: pnpm --filter @pll/ingest sync:logos
  env:
    DB_PATH: ${{ github.workspace }}/data/lacrosse.db
```

**Priority:** Low — logos rarely change mid-season; do before 2027 season

---

### 1c. No anomaly growth threshold — pipeline never fails on data quality

**Current state:** The nightly workflow snapshots the anomaly count before and after ingest, and posts the delta to Discord. But it never **fails** if anomalies spike. A parser regression could silently produce hundreds of anomalies with no CI failure.

**Fix:** Add a step after ingest that fails if delta exceeds a threshold:
```yaml
- name: Check anomaly delta
  run: |
    DELTA=$(( POST_COUNT - PRE_COUNT ))
    if [ "$DELTA" -gt 50 ]; then
      echo "Anomaly spike: $DELTA new anomalies (threshold: 50)"
      exit 1
    fi
```

**Priority:** Medium — prevents silent data regressions

---

### 1d. Dedup scripts not run nightly

**Current state:** Multiple dedup/reconciliation scripts exist (`dedupTeams.ts`, `dedupPlayers.ts`, `dedupCrossTeam.ts`, `detectFuzzyDups.ts`, etc.) but none run in the nightly pipeline. Duplicate records accumulate when new summaries introduce name variants.

**Consideration:** Dedup scripts generally output candidates for human review (via `dedup_candidates` table) rather than applying merges automatically. Running them nightly would keep the review queue fresh.

**Fix:**
```yaml
- name: Detect dedup candidates
  run: pnpm --filter @pll/ingest exec tsx src/scripts/dedupTeams.ts
  env:
    DB_PATH: ${{ github.workspace }}/data/lacrosse.db
```

**Priority:** Medium — dedup queue is currently empty (0 rows); run at start of next season

---

### 1e. `piaaCheckTotals.ts` / `reconcileTeamScores.ts` not run nightly

**Current state:** These reconciliation scripts cross-check local game scores against PIAA official records. They exist but are one-off tools, not wired into CI.

**Priority:** Low — useful for end-of-season audit, not critical nightly

---

## 2. Static Export — Pages with No Static Export

These pages on GitHub Pages return `empty.json` or show degraded state because no static equivalent is generated.

### 2a. `/api/freshness` — Sources and partial Status pages

**Impact:** The `#/sources` view fetches `/api/freshness` to show when each data source was last updated. On GitHub Pages this returns nothing, so the page shows a degraded state.

**Fix:** Export `freshness.json` at the end of `exportStatic.ts`:
```typescript
// Near the end of exportStatic.ts
const freshness = computeFreshness(db);
writeJson('freshness.json', freshness);
```
Then add it to `staticLoader.ts` mapping.

**Priority:** Medium — the Sources page is user-visible and useful

---

### 2b. `/api/data-quality/piaa-mismatches` — Data Quality page

**Impact:** The `#/data-quality` view shows a mismatch table comparing local scores against PIAA records. This half of the page shows nothing on GitHub Pages.

**Fix:** Add to `exportStatic.ts`:
```typescript
const mismatches = getPiaaMismatches(db);
writeJson(`${season}/data-quality/piaa-mismatches.json`, mismatches);
```

**Priority:** Low — this is a diagnostic/admin page, not primary UX

---

### 2c. `/api/h2h/teams` and `/api/h2h/players` — H2H page

**Impact:** The `#/h2h` view is entirely non-functional on GitHub Pages because both H2H endpoints have no static export.

**Challenge:** H2H data is query-parameterized (team A vs team B, or player A vs player B). Pre-generating all combinations is combinatorially expensive (~235² team pairs = 55,225 files). More practical options:
1. Pre-generate a flat H2H matrix (single JSON, indexed by team pair key)
2. Make H2H a "live only" feature and disable it in static mode with a clear message

**Priority:** Low — H2H is not a primary view; option 2 (graceful disable) is simpler

---

### 2d. `/api/compare/players` — Compare Players page

**Impact:** The `#/compare/players` view is non-functional on GitHub Pages. It accepts arbitrary player IDs, so pre-generating all pairs is not feasible.

**Practical fix:** Since individual player detail files already exist (`players/{id}.json`), the client could be refactored to compose comparisons client-side from those files rather than hitting a comparison API endpoint.

**Priority:** Low — Compare Players is a secondary feature

---

## 3. Data Source Gaps

### 3a. PIAA game time and venue never populated

**Issue:** `schedule_games.game_time` and `schedule_games.location` columns exist in the DB but are always null. The PIAA CSV export does not include time or venue.

**Potential fix:** PIAA may have per-game detail pages with venue info. MaxPreps schedule pages include game times. Neither is currently scraped for this data.

**Priority:** Low — useful for "game tonight" notifications but not critical for current features

---

### 3b. Goalie stats and roster data not captured

**Issue:** phillylacrosse.com summary posts include goalie save lines but the `playerStat.ts` parser treats saves as a stat on the scoring team's player lines. True goalie-specific stats (save %, goals against, shots on goal) are not separately tracked.

**Priority:** Medium — would enable goalie leaderboard, currently absent

---

### 3c. PIAA playoff brackets not captured

**Issue:** PIAA publishes playoff brackets and results. These are not scraped. The site has no postseason bracket view.

**Sources to investigate:**
- `https://www.piaad1.org/` — may have bracket pages
- PIAA state site — may publish PDF brackets

**Priority:** Medium-High — playoffs are the most-watched part of the season

---

### 3d. MaxPreps game data underutilized

**Issue:** `maxprepsGame.ts` and `maxprepsSchedule.ts` source files exist and can parse final scores + game URLs, but they are not wired into any pipeline step. MaxPreps has:
- Final scores (alternative source to fill phillylacrosse.com gaps)
- Team rosters
- Historical season records
- Schedule with game times and venues

**Priority:** Medium — MaxPreps scraping is already partially built; completing the wiring could reduce data gaps

---

### 3e. LaxNumbers historical data

**Issue:** The nightly pipeline only ingests LaxNumbers data for `--since=yesterday --until=today`. Historical LaxNumbers data (earlier in the 2026 season) may contain stats not in the local DB.

**Fix:** Run a one-time backfill: `--source=laxnumbers --since=2026-01-01 --until=yesterday --apply`

**Priority:** Medium — do once at start of postseason to ensure complete regular-season stats

---

## 4. DB Data Not Surfaced in UI

These columns/tables exist in the DB but are not exposed through the API or static export:

| Table/Column | What it contains | Surfacing suggestion |
|---|---|---|
| `teams.primary_color`, `teams.secondary_color`, `teams.nickname` | Team branding data | Use colors in team cards and chart accent colors |
| `ingest_anomalies` (full detail) | Parser anomaly raw lines | Already surfaced in `#/anomalies` view ✅ |
| `score_sources` | Score reconciliation audit trail | Admin/debug use only; no user-facing value |
| `dedup_candidates` | Admin merge review queue | Already surfaced in `#/admin/dedup` ✅ |
| `player_stats.confidence` | Parser confidence score | Could use to flag low-confidence stat lines in UI |
| `player_stats.source`, `player_stats.parser_version` | Provenance metadata | Admin/debug use only |
| `schedule_games.game_time`, `.location` | Game time + venue | Not populated (see §3a above) |
| `piaa_official_teams` | PIAA's authoritative team list | Used for mismatch detection; could add "PIAA ID" badge to team pages |

---

## 5. Season Transition Checklist

When the 2027 season begins, update these hardcoded values:

- [ ] `packages/server/src/scripts/exportStatic.ts` — `DEFAULT_SEASON` constant
- [ ] `packages/server/src/routes/seasons.ts` — hardcoded `{seasons:[2026], default:2026}`
- [ ] `packages/web/src/staticLoader.ts` — default season for static path resolution
- [ ] `packages/ingest/src/scripts/syncPiaa.ts` — verify `year` param points to new season
- [ ] `docs/architecture.md` — update row counts table

---

## 6. Priority Summary

| Item | Priority | Effort | Section |
|------|----------|--------|---------|
| Anomaly growth threshold in CI | Medium | S | §1c |
| Export `freshness.json` for Sources page | Medium | S | §2a |
| Dedup scripts in nightly pipeline | Medium | S | §1d |
| MaxPreps game data wiring | Medium | M | §3d |
| LaxNumbers historical backfill (one-time) | Medium | S | §3e |
| Goalie stats parsing | Medium | M | §3b |
| PIAA playoff bracket scraping | Medium-High | L | §3c |
| Export PIAA mismatches for Data Quality page | Low | S | §2b |
| H2H graceful disable in static mode | Low | S | §2c |
| Rankings crawl step in nightly | Low | S | §1a |
| Monthly logo sync workflow | Low | S | §1b |
| Team branding colors in UI | Low | S | §4 |
| piaaCheckTotals nightly | Low | S | §1e |
