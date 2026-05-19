# Level Up — Long-Term Product Roadmap

> **Purpose:** Agent-readable roadmap for turning this site into a production-ready, multi-league lacrosse stats hub.  
> **Audience:** Fleet agents executing waves. Each wave should be completable in a single session.  
> **Principles:** Small t-shirt sizes (XS–S preferred). Independent lanes per wave. Ship incrementally.  
> **Related docs:** `docs/improvements/00-INDEX.md` (technical RFCs), `docs/architecture.md` (system design), `AGENTS.md` (commands/conventions).

---

## Constraints & Assumptions

| Constraint | Detail |
|---|---|
| **Scale** | Dozens of daily users (coaches + players). No need for CDN, caching layers, or horizontal scaling yet. |
| **Hosting** | GitHub Pages = fast iteration & current production. Azure Container App = API + nightly ingest. Long-term: Azure becomes primary production behind custom domain. |
| **Domain** | `PhillyLaxStats.com` (NameCheap, owner-acquired). Will point to Azure once stable. |
| **Data authority** | Coach-submitted data > Hudl > LaxNumbers > RSS. Manual entries take precedence but are auditable. |
| **T-shirt sizing** | XS = <1hr, S = 1-3hr, M = 3-8hr. Avoid M+ items; split them. |
| **Automation bias** | If a task can be scripted or handled by an agent end-to-end, prefer that over manual steps. Document any step that still requires human action. |

---

## Automation Capabilities & Limitations

Agents should understand what they can do autonomously and what requires human action.

### What agents CAN automate

| Capability | How | Notes |
|---|---|---|
| **NameCheap DNS** | NameCheap API (`namecheap.domains.dns.*`) | Requires `NAMECHEAP_API_KEY`, `NAMECHEAP_API_USER`, and IP whitelisting. Agent can set A/CNAME/TXT records programmatically. |
| **Hudl login + scrape** | Playwright via `syncHudl.ts` | Already built. Agent runs `--headed` for first-time selector discovery, then `--dry-run` to validate before writing. |
| **Azure Container App config** | `update-azure-config.yml` GitHub Actions workflow | Agent dispatches workflow via `gh workflow run`. No direct `az` CLI write access from local machine. |
| **GitHub Pages deploy** | `gh workflow run pages.yml --ref main` | Standard post-push step. |
| **DB upload to Azure** | `pnpm db:deploy` (wraps `scripts/db-upload.sh`) | Requires `AZURE_STORAGE_CONNECTION_STRING` in env. |
| **Spreadsheet parsing** | `applyHarritonWorkbook.ts` patterns | Agent can read `.xlsx` files, parse sheets, map columns, write to DB. |
| **YouTube API polling** | YouTube Data API v3 (`search.list` with `eventType=live`) | Requires `YOUTUBE_API_KEY`. Can check if a channel is live. |
| **CI workflow dispatch** | `gh workflow run <workflow>.yml` | Any workflow with `workflow_dispatch` trigger. |

### What requires HUMAN action

| Action | Why | Agent should... |
|---|---|---|
| Acquire domain on NameCheap | Payment + account ownership | Ask user to confirm purchase, then automate DNS after |
| NameCheap API IP whitelist | Security setting in NameCheap dashboard | Provide exact instructions for user to whitelist the runner IP |
| Hudl coach invitation for new teams | Requires coach-to-coach invite inside Hudl | Document the flow; agent cannot initiate |
| Azure AD app registration (OIDC) | Requires admin consent in Azure portal | Provide `az ad app create` commands; user runs them |
| PBLA data permission | Business relationship | Owner handles; agent documents what data format is needed |
| YouTube API key creation | Google Cloud Console | Provide step-by-step; user creates and shares key |
| Secret rotation | Credential management | Agent never reads or writes secrets; user manages via GitHub Secrets or `.env` |

### Environment variables needed (by wave)

| Wave | Env vars required | Where stored |
|---|---|---|
| 1 (Domain) | `NAMECHEAP_API_KEY`, `NAMECHEAP_API_USER`, `NAMECHEAP_CLIENT_IP` | GitHub Secrets + local `.env` |
| 2 (Upload) | None new (uses existing DB + server) | — |
| 3 (Hudl) | `HUDL_EMAIL`, `HUDL_PASSWORD` (already exist) | GitHub Secrets |
| 4 (PBLA) | `YOUTUBE_API_KEY` | GitHub Secrets |
| 5 (Pipeline) | None new | — |
| 6 (DevOps) | Azure AD OIDC credentials | GitHub Secrets |

---

## Wave 1 — Domain & Hosting Transition

**Goal:** Route `PhillyLaxStats.com` to the Azure Container App and update all references.

**Status:** Domain purchased from NameCheap (2026-05-19). Ready for DNS configuration.

**Automation level:** ~80% automatable. DNS records can be set via NameCheap API once credentials are provided.

| Lane | Task | Size | Automatable? | Notes |
|------|------|------|---|-------|
| 1 | Create `scripts/dns-setup.sh` using NameCheap API | S | Yes | Sets A record to Azure Container App IP, TXT for domain verification |
| 2 | Enable managed TLS certificate on Azure Container App | XS | Yes (workflow) | Dispatch `update-azure-config.yml` with custom domain binding |
| 3 | Update `CORS_ORIGINS` env var to include new domain | XS | Yes (workflow) | Add `https://phillylaxstats.com` to allowed origins |
| 4 | Update `VITE_API_URL` in web build config for production | XS | Yes | Change env in GitHub Actions for Pages build |
| 5 | Update all docs to reflect new domain | S | Yes | `grep -r 'proudwave' . \| grep -v node_modules` then search-and-replace |
| 6 | Add GitHub Pages as staging subdomain (`preview.phillylaxstats.com`) | XS | Yes | CNAME record via NameCheap API |
| 7 | Keep GitHub Pages as preview/staging (no removal) | — | Decision | Pages = `preview.phillylaxstats.com`; Azure = `phillylaxstats.com` |

**Done-when:** `https://phillylaxstats.com` serves the site with valid TLS. `preview.phillylaxstats.com` still works via Pages. Docs reference new domain.

**Human actions required before launch:**
1. User confirms domain purchase is complete
2. User whitelists runner IP in NameCheap API settings (agent provides IP)
3. User adds `NAMECHEAP_API_KEY` and `NAMECHEAP_API_USER` to GitHub Secrets

---

## Wave 2 — Coach Spreadsheet Upload

**Goal:** Coaches upload an Excel/CSV file via the web UI; the system ingests it into `player_stats` with full audit trail.

**Automation level:** 100% automatable. No external credentials needed.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Design upload API endpoint (`POST /api/upload/stats`) | S | Accept multipart form, validate structure, return preview |
| 2 | Build parser for coach spreadsheet format | S | Reuse `applyHarritonWorkbook.ts` patterns; support `.xlsx` + `.csv` |
| 3 | Add `manual_uploads` table (who, when, file hash, row count, status) | XS | Migration 017 |
| 4 | Add `stat_overrides` table or flag on `player_stats` | XS | Tracks which rows are coach-submitted vs scraped |
| 5 | Build web UI: upload form + preview diff + confirm button | S | New view: `#/coach/upload` |
| 6 | Add revert capability (rollback a specific upload by ID) | S | Soft-delete: mark overridden rows inactive |

**Done-when:** A coach can upload a spreadsheet, preview changes, confirm, and see updated stats on player pages. Admin can revert any upload.

**Data precedence rule:** Coach-submitted stats override scraped data for the same game+player. The original scraped value is preserved in `stat_overrides` for audit/revert.

**Spreadsheet format spec (for coaches):**

```
Required columns: Player Name, Game Date, Opponent
Optional columns: Goals, Assists, Ground Balls, Caused Turnovers, Saves, FO Won, FO Taken
```

Agent should generate a downloadable template `.xlsx` that coaches can fill out. Host at `/data/upload-template.xlsx`.

---

## Wave 3 — Hudl Expansion

**Goal:** Extend the Hudl scraper beyond Harriton to pull stats for any team with a known Hudl team ID.

**Automation level:** 90% automatable. Agent can log in, scrape, and write DB. Only coach invitation is manual.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Add `hudl_teams` table (team_id FK, hudl_team_id, hudl_team_url, last_synced, status) | XS | Migration 018 |
| 2 | Parameterize `syncHudl.ts` to accept any `hudl_team_id` | S | Currently hardcoded to Harriton. Refactor to loop `hudl_teams` table |
| 3 | Add CLI flags: `--team-id=X` (single) and `--all` (loop all registered) | XS | |
| 4 | Add nightly loop to `ingest-nightly.yml`: iterate `hudl_teams`, sync each | S | Rate-limit: 1 team per 30s to avoid blocks |
| 5 | Build admin UI to register new Hudl teams (`#/admin/hudl`) | S | Form: team dropdown + Hudl URL. Writes to `hudl_teams`. |
| 6 | Document Hudl invitation flow for coaches | XS | How a coach grants our account access to their team |

**Done-when:** Running `pnpm --filter @pll/ingest exec tsx src/scripts/syncHudl.ts --all` syncs all registered teams. Nightly CI does this automatically.

**Hudl access model:**
- Our account (env: `HUDL_EMAIL`) must be invited as a coach/assistant on each team
- Once invited, `syncHudl.ts` can see that team's full stats
- Agent can automate everything EXCEPT the initial coach invitation (that's human-to-human inside Hudl)

**Prerequisite:** Hudl auth credentials (`HUDL_EMAIL`/`HUDL_PASSWORD`) must have visibility into target teams. Coach invitation flow documented in `#/admin/hudl` view.

---

## Wave 4 — PBLA (Box Lacrosse) Integration

**Goal:** Add Philadelphia Box Lacrosse Association data as a separate league within the same site.

**Automation level:** ~70%. Scraper buildable once site structure is known. YouTube live check automatable. Data permission is manual.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Add `leagues` table (id, name, slug, source_url, logo_url) | XS | Migration 019. Seeds: `hs-boys`, `pbla` |
| 2 | Add `league_id` FK to `teams`, `games`, `players` tables | S | Migration 020. Default existing rows to `hs-boys` |
| 3 | Recon: scrape `phillyboxlacrosse.org` structure (Wave 0 research) | S | Identify schedule page, team list, stats format |
| 4 | Build PBLA scraper/parser (source: `phillyboxlacrosse.org`) | S | Based on recon findings |
| 5 | Add league switcher to nav (dropdown or tab bar) | S | Web UI: filter all views by active league. Persist selection in localStorage. |
| 6 | Add YouTube live indicator for PBLA streams | S | Polling: YouTube Data API v3 every 5min via server cron or client-side check |
| 7 | Update `export:static` to emit per-league JSON snapshots | S | `public/data/pbla/` alongside `public/data/` |

**Done-when:** Users can switch to "PBLA" in the nav and see teams/players/games for box lacrosse. A red "LIVE" badge appears on the dashboard when PBLA is streaming live on YouTube.

**External dependencies (human action required):**
1. Owner conversation re: data access/permission from PBLA — Lane 3-4 blocked until confirmed
2. User creates YouTube Data API key in Google Cloud Console — Lane 6 blocked until key provided

**YouTube live check implementation:**

```typescript
// Server endpoint: GET /api/pbla/live
// Polls YouTube Data API v3:
// GET https://www.googleapis.com/youtube/v3/search?part=snippet&channelId={CHANNEL_ID}&eventType=live&type=video&key={API_KEY}
// Returns { isLive: boolean, videoUrl?: string, title?: string }
// Cache result for 5 minutes to stay within API quota (10,000 units/day)
```

**YouTube channel:** <https://www.youtube.com/@pbla_official>  
**PBLA website:** <https://phillyboxlacrosse.org>

---

## Wave 5 — Data Pipeline Hardening ✅ COMPLETE (2026-05-19)

**Goal:** Improve data accuracy, observability, and robustness for production use.

**Automation level:** 100% automatable. All changes are code-only.

These items come from `docs/improvements/00-INDEX.md` (existing RFCs). Each is already spec'd — agents should read the RFC before implementing.

| Lane | Task | Size | RFC | Status |
|------|------|------|-----|--------|
| 1 | Anomaly-driven team alias auto-seeder | S | [#01](./improvements/01-anomaly-driven-alias-seeder.md) | ✅ Done — 11 aliases, ~71 anomalies covered |
| 2 | API response cache + ETag headers | S | [#03](./improvements/03-api-response-cache-and-http-caching.md) | ✅ Done — LRU + SHA-256 ETag + 304 |
| 3 | Game flow chart (period scoring visualization) | S | [#06](./improvements/06-game-flow-chart.md) | ✅ Done — D3 curveStepAfter in gameDetail |
| 4 | Centralized Pino logger (replace scattered console.log) | S | [#07](./improvements/07-centralized-logger-rollout.md) | ✅ Done — all non-test ingest sources converted |

**Done-when:** ~~Anomaly count reduced by >=30%. API responds with cache headers. Game detail shows period-by-period flow chart. All packages use Pino logger.~~ All met.

---

## Wave 6 — Deploy & DevOps Reliability

**Goal:** Eliminate manual deploy friction and add safety gates.

**Automation level:** ~60%. Workflow code is automatable; Azure AD setup requires human.

| Lane | Task | Size | RFC |
|------|------|------|-----|
| 1 | GitHub-hosted runner + OIDC | S | [#09](./improvements/09-github-hosted-runner-oidc-deploy.md) |
| 2 | Pre-deploy validation + rollback | S | [#10](./improvements/10-pre-deploy-validation-and-rollback.md) |

**Done-when:** CI runs on GitHub-hosted runners. Failed deploys auto-rollback. No manual Azure CLI needed.

**Human actions required:**
1. User creates Azure AD app registration for OIDC (agent provides `az` commands)
2. User adds federated credential to GitHub Secrets

---

## Wave 7 — Player & Coach Experience

**Goal:** Quality-of-life features that make the site sticky for its core audience.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Player profile sharing (OG meta tags for social previews) | S | Dynamic `<meta og:image>` with player name + stats card image |
| 2 | Season selector (view stats by year) | S | Dropdown: "2025-26", "2024-25", etc. Filter all views. |
| 3 | Personal bests / milestones callout on player page | XS | "Career high: 7 goals vs Lower Merion (4/12)" banner |
| 4 | Coach dashboard: team overview with missing-data alerts | S | Shows which games have incomplete stats, prompts upload |
| 5 | Email/push notification: weekly stat digest for subscribed coaches | S | Optional: use SendGrid or similar. Low priority. |

**Done-when:** Player pages have shareable social cards. Season filter works across all views. Coaches see data gaps highlighted.

---

## Wave 8 — SEO & Discoverability

**Goal:** Make the site findable via Google when someone searches "Harriton lacrosse stats 2026".

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Add `sitemap.xml` generation (auto-built from team/player/game routes) | S | Run at deploy time; emit to `public/sitemap.xml` |
| 2 | Add structured data (JSON-LD) for team and player pages | S | Schema.org `SportsTeam` + `Person` types |
| 3 | Add canonical URLs and proper `<title>` per route | XS | Currently all pages show same title |
| 4 | Add `robots.txt` | XS | Allow all; point to sitemap |
| 5 | Social preview images (OG cards) for team/player pages | S | Server-side rendered PNG or static template |

**Done-when:** Google indexes team and player pages within 2 weeks of deploy. Social sharing shows rich preview cards.

---

## Wave 9 — Mobile & Performance

**Goal:** Site works well on phones (coaches check stats from the sideline).

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Responsive audit: fix any tables/charts that overflow on mobile | S | Focus on dashboard, game detail, leaders |
| 2 | Add PWA manifest + service worker for offline access | S | Cache static assets; show "offline" for API views |
| 3 | Lazy-load images (team logos) with IntersectionObserver | XS | Already using .gif; just add lazy attribute |
| 4 | Reduce initial JS payload (defer non-critical charts) | S | See RFC [#04](./improvements/04-web-bundle-code-splitting.md) |

**Done-when:** Lighthouse mobile score >= 80. Tables scroll horizontally on small screens. Logos lazy-load.

---

## Wave 10 — Recruiting & College Commitment Tracking

**Goal:** Help players showcase their stats to college recruiters and track where league players commit.

**Automation level:** ~80%. Agent builds UI and DB. Player/coach submits commitment info via form.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Add `commitments` table (player_id, college, division, commit_date, status, source) | XS | Migration 021. Status: `committed`, `verbal`, `signed` |
| 2 | Add "College Commitments" section to player detail page | S | Show college name, logo (if available), division, date |
| 3 | Build commitments feed view (`#/commitments`) | S | Chronological list of all commitments; filterable by team/division |
| 4 | Build "Recruit Me" shareable profile page | S | Public URL with player stats summary, highlights link, contact info. OG-card friendly. |
| 5 | Add commitment submission form (player or coach can submit) | S | POST to `/api/commitments`. Moderated (admin approves). |
| 6 | Integrate with NCSA or equivalent recruiting DB (stretch) | M | API research needed. May just link out. |

**Done-when:** Players can mark their commitment; a feed shows all league commitments. Shareable recruit profile exists with stats card.

**Data model:**
```sql
CREATE TABLE commitments (
  id INTEGER PRIMARY KEY,
  player_id INTEGER REFERENCES players(id),
  college TEXT NOT NULL,
  division TEXT, -- 'D1', 'D2', 'D3', 'NAIA', 'MCLA'
  commit_date TEXT,
  status TEXT DEFAULT 'verbal', -- 'verbal', 'committed', 'signed', 'decommitted'
  source TEXT, -- 'player', 'coach', 'admin'
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Wave 11 — Social Media Auto-Posting

**Goal:** Automatically post stat leaders, game results, and milestones to Twitter/X and Instagram to drive traffic back to the site.

**Automation level:** 90%. Agent builds the posting pipeline. User provides API credentials.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Create `scripts/socialPost.ts` — generates post content from DB queries | S | Templates: "Player of the Week", "Game Recap", "Milestone Alert" |
| 2 | Add Twitter/X API integration (OAuth 2.0, `POST /2/tweets`) | S | Requires `TWITTER_BEARER_TOKEN`, `TWITTER_API_KEY`, `TWITTER_API_SECRET` |
| 3 | Add Instagram Graph API integration (image posts) | S | Requires Facebook Business account + `INSTAGRAM_ACCESS_TOKEN` |
| 4 | Generate stat card images (server-side PNG via `@napi-rs/canvas` or `sharp`) | S | Branded template: player photo/silhouette + stats + team logo |
| 5 | Add nightly cron job to post top performers after ingest completes | XS | New step in `ingest-nightly.yml`: runs after applyCorrections |
| 6 | Add admin toggle: enable/disable auto-posting per content type | XS | Config in DB or env var |

**Done-when:** After nightly ingest, the system auto-posts a "Player of the Day" stat card to Twitter/X. Instagram posts weekly roundup.

**Post templates:**

| Template | Trigger | Content |
|----------|---------|---------|
| Player of the Day | Nightly, after ingest | Top scorer's name, goals, team, matchup |
| Game Recap | Nightly, per game | Score, top performers from each team |
| Milestone Alert | On detection | "X just hit 50 career goals!" |
| Weekly Leaders | Sunday | Top 5 in goals, assists, saves |
| Commitment Announce | On approval | "Congrats to X, committed to Y University!" |

**Human actions required:**
1. Create Twitter Developer App, provide API keys
2. Create Facebook Business account + Instagram connection for Graph API
3. Design brand template (or approve agent-generated one)

**Env vars:** `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_BEARER_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ID`

---

## Wave 12 — Coach Analytics Dashboard

**Goal:** Give coaches data-driven insights for practice planning, scouting, and game prep.

**Automation level:** 100%. Pure code — all data already exists in DB.

| Lane | Task | Size | Notes |
|------|------|------|-------|
| 1 | Build coach analytics view (`#/coach/analytics`) | S | Protected by coach auth (from Wave 2 patterns) |
| 2 | Add "Trends" panel: team stat trends over last 5/10 games | S | Line charts: goals/game, assists/game, save %. D3 reuse. |
| 3 | Add "Scouting Report" for upcoming opponents | S | Auto-generated: opponent's recent results, top players, tendencies |
| 4 | Add "Practice Focus" suggestions based on stat gaps | S | E.g., "Ground balls trending down — focus drills on GBs" |
| 5 | Add "Player Development" tracker: per-player trend sparklines | S | Reuse leaders sparkline component |
| 6 | Add exportable PDF scouting report (stretch) | S | Use `jsPDF` or server-side generation |

**Done-when:** Coaches see their team's trends, upcoming opponent scouting reports, and practice recommendations. All derived from existing DB data.

**Scouting report auto-generation logic:**
```
1. Find next scheduled game for coach's team
2. Pull opponent's last 5 games from DB
3. Calculate: avg goals scored, avg goals allowed, top 3 scorers, win/loss record
4. Format as structured card with key matchup insights
5. Flag any head-to-head history
```

---

## Backlog (Unscheduled)

Items that are valuable but not yet prioritized into a wave. Pull into a future wave when capacity allows.

| Item | Size | RFC/Notes |
|------|------|-----------|
| Losing-side stats backfill from MaxPreps | M | [#02](./improvements/02-losing-side-stats-backfill.md) — new external scraper, higher risk |
| Team strength radar chart | S-M | [#05](./improvements/05-team-strength-radar-chart.md) |
| Domain type consolidation in `@pll/shared` | M | [#08](./improvements/08-domain-type-consolidation.md) — will surface drift |
| Dashboard extraction (split 1074-line file) | S | TODO already in `dashboard.ts` |
| Girls lacrosse league expansion | M | Requires new data source identification |
| Alumni tracking (college commitments) | S | DB table exists but UI is missing |
| Head-to-head history page improvements | S | Show multi-year series record |
| API rate limiting | XS | Add `fastify-rate-limit` to prevent abuse |
| Admin authentication (protect upload/admin routes) | S | Simple token or GitHub OAuth for coach accounts |
| Data export (CSV download for coaches) | S | Already have `/api/export` — add per-team CSV |
| Scheduled game predictions (based on record + strength of schedule) | M | Fun feature; low priority |
| Dark mode toggle | XS | CSS variables already in place; add toggle |

---

## Fleet Execution Notes

**For agents picking up a wave:**

1. Read this doc + the relevant RFC (if linked) before starting.
2. Each wave is designed for 2-4 parallel lanes. Use fleet mode.
3. Lanes within a wave are independent unless noted otherwise.
4. Keep individual PRs to S or smaller. Split M items into 2 PRs.
5. Update this doc's wave status when complete (add checkmark to the wave heading).
6. After completing a wave, run `pnpm db:deploy` if any DB changes were made locally.
7. Run `pnpm typecheck && pnpm test` before committing. Fix any failures you introduced.
8. Update `AGENTS.md` if you add new scripts, routes, views, tables, or workflows.

**Wave dependencies:**
```
Wave 1 (domain)      -> independent, start anytime (needs user secrets first)
Wave 2 (upload)      -> independent, start anytime
Wave 3 (Hudl)        -> independent, start anytime
Wave 4 (PBLA)        -> blocked on owner conversation + YouTube API key
Wave 5 (pipeline)    -> independent, start anytime
Wave 6 (devops)      -> independent, start anytime (needs Azure AD setup)
Wave 7 (experience)  -> after Wave 2 (upload UI depends on coach auth patterns)
Wave 8 (SEO)         -> after Wave 1 (needs final domain before generating sitemaps)
Wave 9 (mobile)      -> independent, start anytime
Wave 10 (recruiting) -> after Wave 7 (builds on player profile patterns)
Wave 11 (social)     -> after Wave 5 (needs reliable nightly pipeline for triggers)
Wave 12 (coach analytics) -> after Wave 2 + Wave 5 (needs upload + clean data)
```

Waves 1-3 and 5-6 can run in parallel if capacity allows. Wave 4 requires external input first.

**Recommended execution order (if doing sequentially):**
1. Wave 5 (pipeline) — pure code, no deps, immediate quality improvement
2. Wave 2 (upload) — highest user value for coaches
3. Wave 1 (domain) — once secrets are ready
4. Wave 9 (mobile) — polish before going public
5. Wave 7 (experience) — sticky features
6. Wave 8 (SEO) — after domain is live
7. Wave 12 (coach analytics) — coach retention
8. Wave 10 (recruiting) — player engagement
9. Wave 11 (social) — growth engine
10. Wave 3 (Hudl) — expands data coverage
11. Wave 6 (devops) — infrastructure reliability
12. Wave 4 (PBLA) — when owner confirms data access

---

## Decision Log

Track architectural decisions made during execution. Add entries here as waves complete.

| Date | Decision | Rationale | Wave |
|------|----------|-----------|------|
| 2026-05-19 | GitHub Pages = staging, Azure = production | Pages is fast for iteration; Azure has API + custom domain + TLS | 1 |
| 2026-05-19 | Coach data overrides scraper data | Coaches are authoritative for their own team's stats | 2 |
| 2026-05-19 | Multi-league via `league_id` FK (not separate DB) | One DB keeps queries simple; just add a WHERE clause | 4 |

---

## Success Metrics

How we know the roadmap is working:

| Metric | Current | Target | Measured by |
|--------|---------|--------|-------------|
| Daily active users | ~5 | 30+ | Server access logs / analytics |
| Data accuracy (anomaly rate) | ~33% unresolved | <10% | `SELECT COUNT(*) FROM ingest_anomalies WHERE resolved_at IS NULL` |
| Coach adoption (uploads/week) | 0 | 3+ | `manual_uploads` table |
| Google indexed pages | 0 | 100+ | Google Search Console |
| Mobile Lighthouse score | Unknown | 80+ | Lighthouse CI |
| Deploy reliability | Manual | Automated + auto-rollback | CI logs |
| Social media followers | 0 | 200+ | Twitter/Instagram analytics |
| College commitments tracked | 0 | 10+ per year | `commitments` table |
| Coach analytics views/week | 0 | 20+ | Server logs for `/coach/analytics` |
| Recruiting profile shares | 0 | 5+ per week | OG card render count or link clicks |

---

**Last Updated:** 2026-05-19
