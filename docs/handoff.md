# Handoff — 2026-06-24

Session summary. Open a fresh session to continue.

---

## What Was Done

### Data fixes + UI improvements (2026-06-24, session 2)

**Changes shipped in commit `c4c532d` (pushed to main, deployed to Azure):**

| Change | Details |
|---|---|
| Removed duplicate player 81591 | "Pierce Merill" deleted from `players` + `player_stats`; was a duplicate of player 50907 (Peirce Merrill / Harriton) |
| Corrected Peirce Merrill stats | Upper Merion game stat updated 7G → 9G; player 50907 now shows **54G / 4A / 58 pts** |
| Fixed callout box overflow | `.record-callout` gets `overflow:hidden; position:relative`; children get `min-width:0`; `.callout-label` gets `flex-wrap:wrap`; provenance badge gets `max-width:100%; overflow:hidden; text-overflow:ellipsis` |
| PIAA badge layering fixed | Contained by the same overflow fix above — badge no longer appears behind adjacent callout cards |
| LaxNumbers label clarified | Label changed to `LaxNumbers Rating (PA East) ↗` with link to laxnumbers.com; sub-label "PA East regional ranking" added; scope maps: `3454 → PA East`, `3468 → IAC/Private` |

**DB upload:** `lacrosse.db` re-uploaded to Azure File Share (`pllstorage3426/pll-data`) after stat correction.

---

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
