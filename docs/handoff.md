# Handoff — 2026-06-24

Session summary. Open a fresh session to continue.

---

## What Was Done

### Architecture consolidation: SWA + ACA → single container (complete)

**Problem:** Cold-start timeouts on `https://phillylaxstats.com/api/dashboard/bundle` persisted despite 5-minute health-check pings. Root cause: GitHub Actions scheduler jitter creates actual ping gaps of 8-10 minutes at peak load. ACA Consumption `min-replicas=0` cold-starts in 15-20 seconds, exceeding the default browser request timeout.

**Decision:** Consolidate to a single always-on container.
- Same cost as keeping split + min-replicas=1 (~$5-8/mo)
- Simpler: one deploy job, no SWA, no cross-origin proxy, no keep-warm cron hacks

**All changes completed and verified:**

| Change | File(s) |
|---|---|
| Web bundle built inside Docker | `Dockerfile` |
| Fastify serves SPA from `/` + `index.html` fallback | `packages/server/src/app.ts` |
| SWA deploy job removed | `.github/workflows/deploy.yml` |
| `min-replicas=1` set on ACA | Azure (via `az containerapp update`) |
| DNS `phillylaxstats.com` → ACA (`4.156.244.210`) | Namecheap API |
| DNS `www.phillylaxstats.com` → ACA FQDN | Namecheap API |
| SWA `pll-web` deleted | Azure |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` secret deleted | GitHub |
| All docs updated | `docs/` |

---

## Current State

| Item | Status |
|---|---|
| Production URL | `https://phillylaxstats.com` (single ACA container) |
| `dashboard/bundle` response time | ~70-440ms (was timing out) |
| Cold-start timeouts | ✅ Eliminated — `min-replicas=1` always-on |
| SWA | ✅ Deleted |
| DNS | ✅ Propagated — both apex and www → ACA |
| Nightly ingest | ✅ Uploads DB to Azure Files after each run |
| `api.phillylaxstats.com` subdomain | Still bound on ACA (redundant but harmless) |

---

## Next Steps

- Season ends — consider whether a 2027 season pipeline change is needed
- `checkDataQuality.ts` always exits 1 for advisory issues — consider separating warnings (exit 0) from errors (exit 1)
- `api.phillylaxstats.com` subdomain can be removed from ACA custom domains if desired (it's redundant — the canonical API URL is now `https://phillylaxstats.com/api/*`)
