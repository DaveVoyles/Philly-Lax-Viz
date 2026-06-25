# Improvements RFC Index

Ten technical improvement proposals across data quality, performance, visualizations, tech debt, and docs/devops. Each RFC follows the same structure (Motivation → Current state → Proposed design → Scope → Validation plan → Effort → Risk → Open questions).

Generated 2026-04-24 by a 5-agent design fleet.

## Catalog

| # | Title | Category | Effort | Risk |
|---|------|----------|--------|------|
| [01](./01-anomaly-driven-alias-seeder.md) | Anomaly-driven team alias auto-seeder | Data quality | M | Low–Medium |
| [02](./02-losing-side-stats-backfill.md) | Losing-side player stats backfill from MaxPreps | Data quality | L | Medium |
| [03](./03-api-response-cache-and-http-caching.md) | In-memory API response cache + ETag/Cache-Control | Performance | S (~1.5 days) | Low |
| [04](./04-web-bundle-code-splitting.md) | Web bundle code-splitting per view | Performance | S (~1.25 days) | Low |
| [05](./05-team-strength-radar-chart.md) | Team strength radar chart (5–7 normalized metrics) | Visualization | M (~3 days) | Low–Medium |
| [06](./06-game-flow-chart.md) | Game flow chart (cumulative period scoring) | Visualization | S–M (~1.5 days) | Low |
| [07](./07-centralized-logger-rollout.md) | Centralized Pino logger rollout | Tech debt | S (~1.5 days) | Low |
| [08](./08-domain-type-consolidation.md) | Domain type consolidation in `@pll/shared` | Tech debt | M (~1 day, but exposes drift) | Medium |
| [09](./09-github-hosted-runner-oidc-deploy.md) | ~~GitHub-hosted runner + OIDC + ACR managed identity~~ | DevOps | S (~2.5 hrs) | Medium | **Partially resolved 2026-06-25** — Mac Mini runner is back, Docker context bug fixed. Remaining: OIDC migration (optional hardening). |
| [10](./10-pre-deploy-validation-and-rollback.md) | Pre-deploy validation gates + revision-level rollback | DevOps | S (~3 hrs) | Medium |

## Prioritization

Scored as `Impact × Urgency − Effort − Risk` (each on 1–10):

| Rank | # | Title | I | U | E | R | Score | Notes |
|------|---|-------|---|---|---|---|-------|-------|
| 1 | 09 | ~~GitHub-hosted runner + OIDC~~ | 9 | 9 | 3 | 4 | **Resolved** | Runner back online + Docker context fix. OIDC migration optional. |
| 2 | 03 | API response cache + ETag | 7 | 7 | 2 | 2 | **10** | Big perf win, snapshot-epoch model makes it ~free |
| 2 | 01 | Anomaly-driven alias seeder | 9 | 7 | 4 | 3 | **9** | Kills ~33% of all anomalies in one pass |
| 2 | 10 | Pre-deploy validation + rollback | 8 | 8 | 4 | 3 | **9** | Pairs with #09; today's deploy lost 30 min to issues this would catch |
| 5 | 06 | Game flow chart | 5 | 4 | 2 | 1 | **7** | Cheap, ships visible value; period data already exists |
| 5 | 04 | Web bundle code-splitting | 6 | 5 | 2 | 2 | **7** | 394 KB entry → smaller; medium user-visible impact |
| 7 | 07 | Centralized logger | 5 | 5 | 4 | 2 | **4** | Hygiene; payoff is mostly future-observability |
| 8 | 05 | Team strength radar | 6 | 4 | 5 | 2 | **3** | Cool but more effort than #06 for similar viz value |
| 9 | 02 | Losing-side stats backfill | 8 | 6 | 7 | 5 | **2** | High value but L effort + new external scraper risk |
| 10 | 08 | Domain type consolidation | 6 | 5 | 5 | 4 | **1** | Will surface bugs (good!) but slow burn |

## Recommended implementation order

### Phase 1 — Quick wins (independent, S-M effort, Low risk)
- **#03** API response cache + ETag
- **#01** Alias auto-seeder
- **#06** Game flow chart

These three are independent (server-only / script+DB / web-only), all S-M effort, all Low risk. Ships measurable user-visible improvements (faster API + fewer anomalies + new chart).

### Phase 2 — Deploy reliability
- **#09** GitHub-hosted runner + OIDC
- **#10** Pre-deploy validation + rollback

These pair tightly. #10 plugs into the pipeline created by #09. Requires Azure AD app-registration step.

### Phase 3 — Backlog
#04 (bundle split), #07 (logger), #05 (radar), #02 (MaxPreps backfill), #08 (type consolidation) — sequence based on priorities.
