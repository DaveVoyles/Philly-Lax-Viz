# Handoff — 2026-06-24 (Session 2)

Session summary. Open a fresh session to continue.

---

## What Was Done

### Architecture consolidation: SWA + ACA → single container (Wave 1 complete)

**Problem:** Cold-start timeouts on `https://api.phillylaxstats.com/api/dashboard/bundle` persisted despite 5-minute health-check pings. Root cause: GitHub Actions scheduler jitter causes actual ping gaps of 8-10 minutes at peak load, not the intended 5 minutes. ACA Consumption with `min-replicas=0` cold-starts in 15-20 seconds, exceeding the default browser request timeout.

**Decision:** Consolidate to a single container with `--min-replicas 1`.
- Same cost as keeping split + min-replicas=1 (~$5-8/mo)
- Simpler: one deploy job, no SWA, no cross-origin proxy

**Code changes completed (Wave 1):**
- `Dockerfile` — builder stage now builds `packages/web/dist`; runtime stage includes web dist
- `packages/server/src/app.ts` — serves SPA static files from `/`, SPA fallback in `setNotFoundHandler`
- `.github/workflows/deploy.yml` — removed `deploy-web` SWA job; removed web bundle build step from CI
- `docs/azure-deployment.md` — updated architecture, cost table, added migration runbook

---

## Current State

| Item | Status |
|---|---|
| Code changes | ✅ Wave 1 complete — Dockerfile + server + CI updated |
| Azure min-replicas=1 | ⬜ NOT YET — Wave 2 manual step required |
| SWA deletion | ⬜ NOT YET — Wave 2 manual step required |
| DNS migration | ⬜ NOT YET — Wave 2 manual step required |
| Cold-start timeouts | ⚠️ Will persist until Wave 2 (min-replicas=1) is applied |

---

## Next Steps (Wave 2 — manual Azure steps)

See `docs/azure-deployment.md` Section 4b for exact commands.

1. Deploy the updated code to main (trigger deploy.yml)
2. Verify the container serves both API and SPA correctly
3. `az containerapp update --min-replicas 1` (THE fix for timeouts)
4. Add custom domain `phillylaxstats.com` to ACA
5. Update DNS CNAME → ACA FQDN
6. Delete SWA after DNS propagates
7. Remove `AZURE_STATIC_WEB_APPS_API_TOKEN` GitHub secret
