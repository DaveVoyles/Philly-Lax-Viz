# Azure Migration Plan: GitHub Pages → Azure (Full Cutover)

**Status:** proposed  
**Risk:** High  
**Created:** 2026-05-20  
**Owner:** @DaveVoyles

---

## 1. Problem Statement

The site currently deploys through a hybrid architecture:

- **GitHub Pages** hosts the static site at `phillylaxstats.com` (custom CNAME)
- **Azure Container App** runs the live API at `pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`
- **Nightly CI** (GitHub Actions) crawls data, writes to Azure Files DB, exports ~80 static JSON files, then deploys to GitHub Pages

This creates several pain points:

1. **Double deployment** — every data update requires export + Pages deploy; pushes to main don't auto-deploy
2. **Stale data** — static JSON exports are only as fresh as the last nightly run; real-time corrections and live views are inaccessible on the public site
3. **IS_STATIC complexity** — every web view must dual-path between static JSON and live API, doubling maintenance cost
4. **Limited features** — H2H compare, rivalries, coach dashboard, admin views, and interactive features are unavailable on the public static site
5. **DNS split** — the live API runs on a separate Azure subdomain with CORS allowlisting, not the primary domain

**Target outcome:** A single deployment where `phillylaxstats.com` serves the Vite SPA directly from Azure, all views hit the live API, and the static export path is eliminated.

---

## 2. Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions (ingest-nightly.yml)                            │
│  Cron: 0 6 * * * UTC                                           │
│  Runner: self-hosted "pll"                                      │
│                                                                 │
│  Steps:                                                         │
│  1. Download DB from Azure Files                                │
│  2. Crawl RSS + PIAA + LaxNumbers + Hudl                       │
│  3. Upload DB back to Azure Files                               │
│  4. Restart ACA revision                                        │
│  5. (pages.yml) Export static JSON → deploy to GitHub Pages     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐     ┌──────────────────────────────────┐
│  GitHub Pages            │     │  Azure Container App              │
│  phillylaxstats.com      │     │  pll-server.proudwave-03a07ae1... │
│                          │     │                                    │
│  • Vite SPA (static)     │     │  • Fastify API on :8080           │
│  • /data/*.json exports  │     │  • Azure Files mount at /data/    │
│  • VITE_STATIC_MODE=true │     │  • SQLite DB (user_version=16)    │
│  • CNAME → custom domain │     │  • CORS: localhost:5173 + origins │
│  • No live API calls     │     │  • /logos/* static serving        │
└──────────────────────────┘     └──────────────────────────────────┘
```

### Key infrastructure components

| Component | Location | Purpose |
|-----------|----------|---------|
| `pages.yml` | `.github/workflows/` | Exports static JSON, builds web in static mode, deploys to GH Pages |
| `ingest-nightly.yml` | `.github/workflows/` | Nightly data pipeline (crawl→parse→ingest→upload) |
| `deploy.yml` | `.github/workflows/` | Builds web + server, deploys to Azure SWA + ACA |
| `update-azure-config.yml` | `.github/workflows/` | Updates CORS, custom domain, env vars on ACA |
| `Dockerfile` | repo root | Multi-stage Node 20 Alpine for ACA (server) |
| `infra/azure-bootstrap.sh` | repo root | Provisions RG, Storage, SWA, ACA env |
| `scripts/db-upload.sh` | repo root | Uploads local DB to Azure Files, optional Pages redeploy |
| `packages/web/public/CNAME` | web package | Custom domain for GitHub Pages |
| `packages/web/src/staticLoader.ts` | web package | IS_STATIC flag, staticFetch(), URL mapping |
| `packages/web/src/apiBase.ts` | web package | VITE_API_BASE_URL → apiUrl() prefix |
| `packages/server/src/scripts/exportStatic.ts` | server package | Generates ~80 static JSON files |

### Environment variables (web)

| Variable | Purpose | Used in |
|----------|---------|---------|
| `VITE_STATIC_MODE` | Enables static JSON fetching | `staticLoader.ts` |
| `VITE_API_BASE_URL` | Absolute API origin for live mode | `apiBase.ts` |
| `VITE_BASE_PATH` | Base path for Vite (default `/`) | `vite.config.ts` |

### Views affected by IS_STATIC

| View | Static behavior | Live-only? |
|------|----------------|------------|
| Dashboard | Static JSON snapshots | No |
| Team Detail | Static snapshot + ratings fallback | No |
| Game Detail | Static snapshot | No |
| Player Detail | Static snapshot | No |
| Leaders | Static JSON leaders | No |
| Schedule | Static JSON | No |
| Rankings | Static JSON | No |
| Commitments | Static snapshot | No |
| Ratings | Static snapshot | No |
| Data Quality | Static snapshot | No |
| Sources | Static freshness | No |
| H2H Compare | `staticUnavailableNode` | **Yes — live only** |
| Rivalries | `staticUnavailableNode` | **Yes — live only** |
| Coach Dashboard | `staticUnavailableNode` | **Yes — live only** |
| Admin Corrections | Redirect/block | **Yes — live only** |
| Admin Dedup | Redirect/block | **Yes — live only** |
| Admin Hudl | Redirect/block | **Yes — live only** |

---

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions (ingest-nightly.yml) — RETAINED                 │
│  Cron: 0 6 * * * UTC                                           │
│                                                                 │
│  Steps:                                                         │
│  1. Download DB from Azure Files                                │
│  2. Crawl RSS + PIAA + LaxNumbers + Hudl                       │
│  3. Upload DB back to Azure Files                               │
│  4. Restart ACA revision (triggers fresh data)                  │
│  ❌ 5. No more static export or Pages deploy                    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Azure Static Web Apps (or: serve from ACA)                      │
│  phillylaxstats.com (DNS CNAME → Azure)                          │
│                                                                   │
│  • Vite SPA (built with VITE_API_BASE_URL pointing to API)       │
│  • All views hit live API — no IS_STATIC branching               │
│  • CDN edge caching (SWA) or reverse proxy (ACA)                 │
│  • Custom domain + managed TLS                                    │
│  • Auto-deploy on push to main                                    │
└──────────────────────────────────────────────────────────────────┘
          │
          │  API calls (same domain or nearby subdomain)
          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Azure Container App (RETAINED)                                   │
│  api.phillylaxstats.com (or /api/* proxy)                         │
│                                                                   │
│  • Fastify API on :8080                                           │
│  • Azure Files mount at /data/ (SQLite DB)                        │
│  • /logos/* static serving                                        │
│  • CORS: phillylaxstats.com                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Hosting Option Analysis

### Option A: Azure Static Web Apps (Recommended)

| Aspect | Detail |
|--------|--------|
| **What** | SWA hosts the Vite SPA; API stays on existing ACA |
| **Pros** | Free tier available, built-in CDN, auto-deploy from GitHub, custom domain + TLS, `/api/*` proxy rules to backend |
| **Cons** | SWA proxy has cold-start latency; API routes still cross-origin unless proxied |
| **Cost** | Free tier: 100GB bandwidth/mo, 2 custom domains. Standard: $9/mo |
| **Deploy** | `deploy.yml` already deploys to SWA (lines 91-97) — this path exists |
| **DNS** | CNAME `phillylaxstats.com` → SWA endpoint; SWA manages TLS |

**Proxy configuration** (`staticwebapp.config.json`):
```json
{
  "routes": [
    { "route": "/api/*", "rewrite": "https://pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io/api/*" }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/logos/*", "/data/*"]
  }
}
```

### Option B: Serve SPA from the existing Container App

| Aspect | Detail |
|--------|--------|
| **What** | ACA serves both the API and the built SPA from a single container |
| **Pros** | Simplest topology — one container, one domain, no CORS, no proxy |
| **Cons** | No CDN, container restart = brief downtime, larger image, mixing concerns |
| **Cost** | Already running — no new cost |
| **Deploy** | Modify Dockerfile to copy `packages/web/dist/` into the image |
| **DNS** | CNAME `phillylaxstats.com` → ACA ingress |

### Option C: Azure CDN + Blob Storage

| Aspect | Detail |
|--------|--------|
| **What** | Upload SPA to Azure Blob `$web` container; Azure CDN fronts it |
| **Pros** | Proven pattern, full CDN control, cheap storage |
| **Cons** | More moving parts than SWA, manual cert management, no built-in GitHub integration |
| **Cost** | ~$1/mo storage + CDN pay-per-GB |
| **Deploy** | `az storage blob upload-batch` in CI |

### Recommendation: **Option A (Azure Static Web Apps)**

Reasoning:
- `deploy.yml` already deploys to SWA — the path exists and has been tested
- Built-in GitHub integration means auto-deploy on push (no manual trigger needed)
- `/api/*` proxy eliminates CORS entirely — cleaner than cross-origin
- Free tier covers current traffic volume easily
- Custom domain + managed TLS out of the box
- Fastest path to production with lowest operational overhead

---

## 5. Migration Phases

### Phase 1: Validate SWA + Live API (1-2 hours)

**Goal:** Confirm the existing `deploy.yml` SWA deployment works with `VITE_API_BASE_URL` pointing to ACA.

| Step | Action | Validation |
|------|--------|------------|
| 1.1 | Verify `deploy.yml` SWA deployment is active and accessible | Visit SWA URL, confirm SPA loads |
| 1.2 | Confirm web build uses `VITE_API_BASE_URL` correctly | All API calls resolve, no CORS errors |
| 1.3 | Verify all views work (including H2H, rivalries, coach) | Manual smoke test each route |
| 1.4 | Add `staticwebapp.config.json` with `/api/*` proxy rule | API calls work without cross-origin headers |
| 1.5 | Test custom domain binding on SWA | `update-azure-config.yml` or Azure Portal |

**Deliverable:** SWA serves the full SPA with all views functional via live API.

### Phase 2: Remove IS_STATIC (2-3 hours)

**Goal:** Eliminate all static-mode code paths from the web client.

| Step | Action | Files affected |
|------|--------|----------------|
| 2.1 | Remove `IS_STATIC` checks from all views | 14 view files (see §2 table) |
| 2.2 | Remove `staticLoader.ts` | `packages/web/src/staticLoader.ts` |
| 2.3 | Remove `VITE_STATIC_MODE` references | `vite.config.ts`, build scripts |
| 2.4 | Remove static JSON URL mapping logic from `api.ts` | `packages/web/src/api.ts` |
| 2.5 | Simplify `apiBase.ts` — always use `VITE_API_BASE_URL` or proxy | `packages/web/src/apiBase.ts` |
| 2.6 | Delete `exportStatic.ts` | `packages/server/src/scripts/exportStatic.ts` |
| 2.7 | Remove `export:static` and `validate:export` scripts | `package.json` files |
| 2.8 | Remove `/data/` gitignore exception for `upload-template.xlsx` | Move template to `packages/web/public/` root or `/assets/` |
| 2.9 | Update AGENTS.md §10 (IS_STATIC section) | Mark as removed, update conventions |
| 2.10 | Run full typecheck + test suite | `pnpm typecheck && pnpm test` |

**Deliverable:** Clean codebase with no static/live branching. All views use the live API unconditionally.

### Phase 3: DNS Cutover (30 min)

**Goal:** Point `phillylaxstats.com` from GitHub Pages to Azure SWA.

| Step | Action | Validation |
|------|--------|------------|
| 3.1 | Update DNS CNAME record for `phillylaxstats.com` → SWA endpoint | DNS propagation check |
| 3.2 | Verify TLS cert is provisioned by SWA | `curl -I https://phillylaxstats.com` |
| 3.3 | Remove `packages/web/public/CNAME` | No longer needed |
| 3.4 | Update CORS_ORIGINS on ACA (if not using proxy) | `update-azure-config.yml` |
| 3.5 | Verify site loads on custom domain | Full smoke test |

**Rollback:** If DNS cutover fails, revert CNAME to GitHub Pages (`<username>.github.io`). Pages deployment is still intact until Phase 4.

### Phase 4: Decommission GitHub Pages (30 min)

**Goal:** Remove all Pages-related infrastructure.

| Step | Action |
|------|--------|
| 4.1 | Disable GitHub Pages in repo Settings → Pages |
| 4.2 | Delete or archive `pages.yml` workflow |
| 4.3 | Remove Pages-related steps from `ingest-nightly.yml` (the `workflow_dispatch` trigger to `pages.yml`) |
| 4.4 | Remove `scripts/db-upload.sh --deploy` (the Pages dispatch flag) |
| 4.5 | Update `db:deploy` script to just upload DB + restart ACA |
| 4.6 | Clean up `deploy.yml` if it still references Pages |
| 4.7 | Update `README.md`, `AGENTS.md` — remove all Pages references |
| 4.8 | Remove common mistake entry about "Push to main and assume site updates" |

**Deliverable:** Single deployment path. Push to main → SWA auto-deploys. Nightly ingest → ACA restart → fresh data immediately.

### Phase 5 (Future): Move Ingest to Azure (optional, lower priority)

**Goal:** Eliminate dependency on self-hosted GitHub Actions runner.

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| Azure Container App Job | Timer-triggered job in same ACA env | Same infra, Azure Files native, no runner needed | Requires containerizing ingest scripts |
| Azure Functions (Timer) | Durable function on schedule | Serverless, auto-scale, built-in retry | Cold start, may need longer timeout for full pipeline |
| Keep GitHub Actions | Status quo with self-hosted runner | Already works, familiar | Depends on runner machine availability |

**Recommendation:** Keep GitHub Actions for now. The self-hosted runner works reliably and the ingest pipeline is complex (Playwright for Hudl, multiple data sources, conditional logic). Containerizing it adds complexity without immediate value. Revisit when the runner becomes a reliability bottleneck.

---

## 6. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| DNS propagation delay (1-48h) | Users see old Pages site | Medium | Use short TTL before cutover; keep Pages alive until verified |
| API unavailability = site down | All views broken | Low (ACA has auto-restart) | Add client-side error states + "API unavailable" messaging |
| Cold start on SWA proxy | Slow first API call | Low | SWA proxy is warm after first hit; ACA min replicas = 1 |
| Traffic spike overwhelms SQLite | API timeouts | Low (current traffic is small) | WAL mode + read replicas if needed later |
| Lost static fallback for offline/cache | No offline access | Low priority | PWA service worker is a future enhancement, not a blocker |

---

## 7. Rollback Plan

| Phase | Rollback action | Time to restore |
|-------|-----------------|-----------------|
| Phase 1 (SWA validation) | No rollback needed — Pages still active | N/A |
| Phase 2 (IS_STATIC removal) | `git revert` the cleanup commit | 5 min |
| Phase 3 (DNS cutover) | Revert CNAME to GitHub Pages endpoint | 5-60 min (DNS TTL) |
| Phase 4 (Pages decommission) | Re-enable Pages in Settings, re-run `pages.yml` | 10 min |

**Safe state:** Keep GitHub Pages deployment working through Phases 1-2. Only decommission (Phase 4) after Phase 3 is confirmed stable for 48+ hours.

---

## 8. Effort Estimate

| Phase | Effort | Prerequisites |
|-------|--------|---------------|
| Phase 1: Validate SWA | 1-2 hours | Azure access, SWA already provisioned |
| Phase 2: Remove IS_STATIC | 2-3 hours | Phase 1 confirmed working |
| Phase 3: DNS Cutover | 30 min | DNS registrar access, Phase 2 merged |
| Phase 4: Decommission Pages | 30 min | Phase 3 stable for 48h |
| Phase 5: Move ingest (future) | 4-8 hours | Only if runner becomes unreliable |

**Total (Phases 1-4):** ~4-6 hours of implementation + 48h soak period before Phase 4.

---

## 9. Success Criteria

- [ ] `phillylaxstats.com` serves the Vite SPA from Azure (not GitHub Pages)
- [ ] All views work with live API — no static fallbacks, no "unavailable" messages
- [ ] Push to `main` triggers auto-deploy (no manual `gh workflow run` needed)
- [ ] Nightly ingest updates data immediately (ACA restart = fresh data served)
- [ ] No CORS errors (proxy handles `/api/*` routing)
- [ ] TLS cert is managed and auto-renewing
- [ ] `IS_STATIC`, `staticLoader.ts`, `exportStatic.ts` are deleted from codebase
- [ ] GitHub Pages is disabled in repo settings
- [ ] `pages.yml` workflow is archived or deleted
- [ ] Documentation (AGENTS.md, README) reflects new architecture

---

## 10. Decisions (Confirmed)

| Question | Answer | Source |
|----------|--------|--------|
| Hosting choice | Azure Static Web Apps | User confirmed |
| Timeline | Start when plan is well documented | User confirmed |
| DNS access | Agent updates via Namecheap API (used successfully in prior sessions) | User confirmed |
| Soak period | 48h parallel run (both Pages + SWA live before decommissioning Pages) | Assumed — standard safety practice |
| Phase 5 (ingest) | Keep on GitHub Actions for now; revisit if runner becomes unreliable | Default — lowest risk path |

### DNS Access Details (from prior sessions)

- **Registrar:** Namecheap
- **API endpoint:** `https://api.namecheap.com/xml.response`
- **API method:** `namecheap.domains.dns.setHosts` (REPLACES all records — must include ALL existing in every call)
- **Domain:** `phillylaxstats.com` (SLD=phillylaxstats, TLD=com)
- **Credentials:** Stored in user's environment (API user, key, whitelisted IP) — NOT committed to repo
- **Current DNS records:**
  - `@` → 4x GitHub Pages A records (185.199.108-111.153)
  - `www` → CNAME → `davevoyles.github.io`
  - `api` → CNAME → `pll-server.proudwave-03a07ae1.eastus.azurecontainerapps.io`
  - `asuid` / `asuid.api` → TXT (Azure domain validation tokens)

### Phase 3 DNS Changes Required

After SWA is validated and IS_STATIC is removed:

| Type | Host | Old Value | New Value |
|------|------|-----------|-----------|
| A | `@` | 185.199.108-111.153 (GitHub Pages) | Azure SWA IP (discover at cutover) |
| CNAME | `www` | `davevoyles.github.io` | Azure SWA endpoint (discover at cutover) |
| CNAME | `api` | (keep as-is) | (keep as-is) |
| TXT | `asuid` | (update if SWA needs different token) | Azure SWA validation token |

The `api` subdomain stays pointed at ACA. The SWA `/api/*` proxy rule means the SPA doesn't need cross-origin calls — all API traffic routes through the same origin via proxy.

### Phase 5 Alternatives (for future reference)

| Option | How it works | When to consider |
|--------|-------------|-----------------|
| **Keep GitHub Actions** (current) | Self-hosted runner `pll` runs nightly cron. Downloads DB, crawls, uploads. Already works. | Default — no change needed |
| **Azure Container App Job** | Timer-triggered container in same ACA env. Same Docker image + Azure Files mount. No external runner dependency. | If self-hosted runner becomes unreliable or machine is decommissioned |
| **Azure Functions (Timer)** | Serverless function on schedule. Auto-scale, built-in retry, consumption pricing. | If ingest pipeline is simplified (currently too complex for cold-start constraints) |

**Recommendation:** Stay with GitHub Actions. The pipeline uses Playwright (Hudl), multiple conditional branches, and heavy I/O — all easier on a persistent runner than in serverless/container-job constraints.

---

## 11. Next Steps

This plan is complete and documented. Implementation requires:

1. User review and approval of this plan
2. Namecheap API credentials available at execution time (via env vars, not committed)
3. Agent executes Phases 1-4 sequentially with 48h soak between Phase 3 and Phase 4

**Ready for implementation when user approves.** Reply "approved" or "go" to begin Phase 1.

---

*Plan written by fleet research (Wave 0, 2 explore agents). User decisions recorded 2026-05-20.*
