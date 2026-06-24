# Handoff — 2026-06-24

Session summary for Philly Lacrosse Vis work. Open a fresh session to continue.

---

## What Was Done

### 1. Fixed nightly ingest DB never uploading to Azure (root cause)

**Problem:** The nightly `ingest-nightly.yml` workflow was running successfully but the DB was never uploaded to Azure Files, so the production site was stuck at May 16 data despite daily runs.

**Root cause:** `checkDataQuality.ts` exits with code 1 whenever it finds *any* advisory issue (stale season warning, duplicate alias, etc.). The upload `if:` condition used `steps.data_quality.outcome` — which reflects the raw exit code — instead of `steps.data_quality.conclusion` — which respects `continue-on-error: true`. So `outcome` was always `'failure'`, the upload condition always evaluated false.

**Fix:** `.github/workflows/ingest-nightly.yml` — changed `steps.data_quality.outcome` and `steps.apply_corrections.outcome` to `.conclusion` (1-line change).

**Verified:** Triggered a manual `workflow_dispatch` run; DB uploaded, container restarted, production data updated to 2026-06-13 (latest available from phillylacrosse.com).

---

### 2. Dashboard API batching

**Problem:** Dashboard initial load made 4–5 sequential/parallel API calls: `getTeams()` → `getGames(recent)` + `getGames(all)` + `loadHypeCard()` + `loadTeamHypeCard()`.

**Fix:** New `GET /api/dashboard/bundle?season=2026` endpoint returns `{ teams, recentGames, topScorer }` in one request.

- `packages/server/src/routes/dashboardBundle.ts` — new route
- `packages/web/src/api.ts` — `DashboardBundle` type + `getDashboardBundle()` fn
- `packages/web/src/views/dashboard.ts` — uses bundle; hype cards rendered inline from bundle data
- `packages/web/src/views/dashboard/dashboardHype.ts` — `renderPlayerHypeCard()` / `renderTeamHypeCard()` accept pre-fetched data; old `loadHypeCard`/`loadTeamHypeCard` kept as `@deprecated` fallbacks

**Result:** Critical path is now 2 concurrent requests instead of 5+.

---

### 3. Container cold-start UX fix

**Problem:** Azure Container Apps (Consumption, scale-to-zero) cold-starts take **15–20 seconds**, causing dashboard timeout errors. The health-check was only pinging every 30 minutes, leaving large cold windows.

**Fix:** `.github/workflows/health-check.yml` — changed cron from `*/30 * * * *` to `*/5 * * * *`.

**Measured cold start:** 19,282ms (confirmed from run 28085459629 log).

---

### 4. Architecture decision: keep two services

**Question asked:** Is it cheaper to consolidate SWA + ACA into one container?

**Decision: No — keep the split.**

| Setup | Cost |
|---|---|
| SWA (static, Free) + ACA (API, Consumption) | ~$1–4/mo |
| Single container (static + API) | ~$2–8/mo |

The SWA is free and CDN-backed. Moving static file serving into the container increases billable CPU time and eliminates the free CDN layer. The only savings would be ~$0.16/mo from dropping Azure Files — not worth it.

**Revisit if:** The 5-minute keep-warm pings don't eliminate cold-start complaints, and `--min-replicas 1` (~$5–8/mo) is still too expensive. In that case, consolidation into a single Express-style container (like Harriton Lax does) becomes a viable option worth costing out.

---

## Current State

| Item | Status |
|---|---|
| Production DB freshness | 2026-06-13 (last game in phillylacrosse.com data) |
| Nightly ingest | ✅ Fixed — now uploads to Azure after every run |
| Dashboard bundle | ✅ Live at `/api/dashboard/bundle` |
| Health-check cadence | ✅ Every 5 minutes (was 30) |
| Architecture split | ✅ Intentionally kept — documented in `docs/azure-deployment.md` |

## Next Steps (if needed)

- Monitor whether 5-min pings eliminate cold-start complaints; if not, evaluate `--min-replicas 1`
- Season ends — consider whether a 2027 season data pipeline change is needed
- `checkDataQuality.ts` always exits 1 for advisory issues — consider separating warnings (exit 0) from errors (exit 1) so the upload gate can be tightened without `continue-on-error`
