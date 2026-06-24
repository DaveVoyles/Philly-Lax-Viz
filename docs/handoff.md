# Handoff — 2026-06-24

Session summary. Open a fresh session to continue.

---

## What Was Done

### Mobile layout fixes round 2 + runner setup (2026-06-24, session 4)

**Changes shipped (deployed via local `docker buildx build --push`):**

| Change | Details |
|---|---|
| Canvas overlay fix | `teamScoreTrend.ts`: `canvas.style.width` changed from `${displayWidth}px` → `'100%'`; buildkit was using the pixel value (640px) overriding CSS `max-width:100%`, causing the chart to overflow and overlay the games table on mobile |
| Callout height collapse fix | `styles.css`: added `flex: 0 0 auto` to `.record-callout` on ≤768px; `flex-basis:0` + `overflow:hidden` was collapsing card height so text was clipped |
| CI docker login fix | `.github/workflows/deploy.yml`: replaced `docker/login-action@v3` (sets keychain) with a shell step that writes credentials directly as base64 into Docker config `auths` (readable by buildkit without a credential helper) |

**Mac Mini self-hosted runner (`pll` label) set up at:**
`~/github-runners/Philly-Lax-Viz/` with:
- File-based Python credential helper at `bin/docker-credential-osxkeychain`
- Runner `.env` with homebrew + local bin in PATH, `DOCKER_CONFIG` pointing to runner's docker dir
- OrbStack `currentContext` set in runner Docker config
- **Known issue:** runner stops listening after a failed job — needs manual restart (`nohup ./run.sh > runner.log 2>&1 &`)
- `write:packages` scope needed on the GitHub token for GHCR pushes (authorize via `gh auth refresh -s write:packages`)

---

### Mobile layout fixes round 1 (2026-06-24, session 3)

**Changes shipped in commit `52c453b` (pushed to main, deployed to Azure):**

| Change | Details |
|---|---|
| Hero section mobile stacking | Replaced inline `style.cssText` with `.team-detail-hero` / `.team-detail-hero__pie` CSS classes; on ≤768px hero stacks vertically (title above pie chart) |
| Season Momentum arc | Replaced inline `style.cssText` with `.team-detail-arc-host`; arc goes full-width on mobile |
| Chart-slot mobile overflow | Added `@media(max-width:768px) { .chart-slot { max-width:100% } }` — per-chart caps (720px etc.) no longer cause horizontal overflow |
| PIAA validation panel text | Added `word-break:break-word; overflow-wrap:anywhere` so long description strings wrap inside narrow cards |
| Top Scorers chart label margin | Responsive `margin.left`: 140px default → 130px ≤768px → 100px ≤480px; player labels stay readable at phone widths |
| `horizontalLeaderboard` default | Reduced default `margin.left` from 180 → 140 px |

**Root cause:** Several sections used `element.style.cssText = '...'` (inline styles), which have higher CSS specificity than stylesheet rules and cannot be overridden by `@media` queries. Replaced with class names.

---

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
