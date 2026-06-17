# Guide Pairings & Workflows

When multiple specialist guides combine, use this map. Each workflow shows which guides to load and typical token cost.

## OAuth / OpenID Implementation

**Scenario:** Implementing OAuth 2.0 or OpenID Connect for user authentication.

**Load These Guides:**
1. `security-hardening.md` (3K) — OAuth flows, token management, PKCE, JWT, refresh tokens
2. `testing-strategy.md` (2.8K) — Mocking auth providers, testing login flows, E2E auth tests
3. `error-handling.md` (2.3K) — Handling auth timeouts, token expiration, provider failures

**Total Cost:** 8.1K tokens (primary 5.5K + guides)

**Workflow:**
- [ ] Read OAuth flows section in security-hardening.md
- [ ] Design token refresh strategy + error handling
- [ ] Write unit tests for token logic
- [ ] Write integration tests for auth flow
- [ ] Set up E2E test for full login → logout cycle
- [ ] Error handling: timeouts, provider downtime, token expiration

**Key Anti-Patterns:**
- Storing refresh tokens in localStorage (use secure cookies)
- Not validating JWT signature
- Missing PKCE in public clients
- Not testing token expiration
- Synchronous auth calls

---

## API Design & Versioning

**Scenario:** Designing new API endpoints or versioning an existing API.

**Load These Guides:**
1. `architecture-decisions.md` (3.1K) — API style (REST vs GraphQL), versioning strategy, breaking changes
2. `code-quality.md` (3.1K) — Request/response naming, error responses, consistency
3. `testing-strategy.md` (2.8K) — API contract tests, integration tests, backwards compatibility

**Total Cost:** 9K tokens

**Workflow:**
- [ ] Decide API style (REST vs GraphQL, v1 vs header versioning)
- [ ] Design request/response models
- [ ] Create OpenAPI/GraphQL schema
- [ ] Write contract tests (ensure backward compatibility)
- [ ] Test error responses (validation, 4xx, 5xx)
- [ ] Integration tests: typical happy paths + edge cases

**Key Anti-Patterns:**
- Versioning everything (only major breaking changes)
- Inconsistent error response format
- No deprecation period before removing endpoints
- Testing only happy path
- Returning wrapped responses ({"data": {...}} noise)

---

## Security Audit

**Scenario:** Auditing existing codebase for security vulnerabilities.

**Load These Guides:**
1. `security-hardening.md` (3.5K) — OWASP Top 10, secrets management, input validation, API security
2. `code-quality.md` (3.1K) — Dependency audit, code review checklist
3. `quick-refs/security-quick-scan.md` (0.5K) — Fast OWASP scan

**Total Cost:** 7.1K tokens (or 5.5K primary + 0.5K quick-ref for fast scan)

**Workflow:**
- [ ] Run `npm audit` / `pip check` for dependency vulnerabilities
- [ ] Grep for hardcoded secrets (API keys, passwords)
- [ ] Scan for SQL injection points (check ORM usage)
- [ ] Scan for XSS (check all user input rendering)
- [ ] Check broken authentication (password hashing, session management)
- [ ] Review CORS, API auth, permission checks
- [ ] File issues for all findings

**Quick Version (5.5K tokens):**
Just load `security-quick-scan.md` for fast checklist:
- Dependency audit (npm audit)
- Grep for common secrets
- OWASP Top 3 quick check

---

## Production Deployment

**Scenario:** Deploying application to production (first time or major release).

**Load These Guides:**
1. `deployment-infrastructure.md` (2.4K) — CI/CD, rollback strategy, blue-green, canary
2. `testing-strategy.md` (2.8K) — Pre-deployment testing, smoke tests, E2E
3. `error-handling.md` (2.3K) — Production observability, monitoring, alerting
4. `quick-refs/pre-flight-deployment.md` (0.5K) — Go/No-Go checklist

**Total Cost:** 8K tokens (or 5.5K primary + 0.5K quick-ref for checklist)

**Workflow:**
- [ ] Run pre-flight checklist (security scan, tests, migration)
- [ ] Prepare rollback plan (DB migrations, feature flags)
- [ ] Set up monitoring (logs, errors, performance)
- [ ] Choose deployment strategy (blue-green recommended)
- [ ] Run smoke tests in staging
- [ ] Deploy to canary (5-10% traffic)
- [ ] Monitor metrics (errors, latency, business metrics)
- [ ] Gradually increase traffic to 100%

**Quick Version (5.5K tokens):**
Just load `quick-refs/pre-flight-deployment.md`:
- 24-item checklist
- Go/No-Go decision
- Rollback procedures

---

## Architecture & System Design

**Scenario:** Major architectural decision (database choice, microservices, caching strategy).

**Load These Guides:**
1. `architecture-decisions.md` (3.1K) — ADR template, design patterns, trade-off analysis
2. `code-quality.md` (3.1K) — Code organization, SOLID principles
3. `checklists.md` (3K) — Database, scaling, performance considerations

**Total Cost:** 9.2K tokens

**Workflow:**
- [ ] Document decision in ADR format
- [ ] List options (Option A, B, C)
- [ ] Define evaluation criteria
- [ ] Score each option against criteria
- [ ] Document trade-offs (cost, complexity, performance)
- [ ] Record assumptions
- [ ] Set review date (revisit if assumptions change)

**Example:** Choosing between Postgres, MongoDB, Redis for new feature
- Options: PostgreSQL (structured), MongoDB (flexible), Redis (cache)
- Criteria: Performance, scaling, query complexity, operational burden
- Score: Postgres wins on query power, Redis on speed, MongoDB on flexibility
- Trade-off: Postgres more operational overhead but better ACID guarantees
- Decision: PostgreSQL for primary store, Redis for cache

---

## Large Refactoring

**Scenario:** Refactoring large module (>500 lines, >10 files, >3 weeks estimate).

**Load These Guides:**
1. `code-quality.md` (3.1K) — Refactoring checklist, incremental approach
2. `testing-strategy.md` (2.8K) — Test-driven refactoring (write tests first)
3. `architecture-decisions.md` (3.1K) — Design decisions before refactoring
4. `quick-refs/refactor-decision-tree.md` (0.4K) — Should I refactor this?

**Total Cost:** 9.4K tokens

**Workflow:**
- [ ] Decide: Is this refactor worth the risk?
- [ ] Write tests for existing behavior (before changing anything)
- [ ] Refactor incrementally (1 function/module at a time)
- [ ] Run tests after each change (verify nothing broke)
- [ ] Code review after each increment (catch mistakes early)
- [ ] Document design decisions (why did I restructure this?)
- [ ] Estimate: >3 weeks = break into phases with intermediate PRs

**Key Rules:**
- Never refactor + add features at same time
- Always write tests before refactoring
- Commit frequently (every function, not the whole module)
- Get code review between increments
- If blocked: revert, rethink approach

---

## Integration Testing

**Scenario:** Testing complex integration (API + database + auth + external service).

**Load These Guides:**
1. `testing-strategy.md` (2.8K) — Integration test patterns, test containers, mocking strategy
2. `error-handling.md` (2.3K) — Testing error scenarios, timeouts, retries
3. `code-quality.md` (3.1K) — Test maintainability, avoiding brittle tests

**Total Cost:** 8.2K tokens

**Workflow:**
- [ ] Decide: Unit vs integration vs E2E (which layers?)
- [ ] Set up test database (use containers for isolation)
- [ ] Mock external services (not real APIs in tests)
- [ ] Write happy path test (typical user flow)
- [ ] Write error scenario tests (API down, DB timeout, network failure)
- [ ] Write concurrent access tests (race conditions)
- [ ] Clean up test data (before/after hooks)

**Anti-Patterns:**
- Testing real external APIs (use mocks)
- Shared test database (use containers)
- Tests that depend on test order
- Mocking internal code (test behavior, not implementation)
- Flaky tests (introduce delays, use polling)

---

## Documentation & Knowledge Transfer

**Scenario:** Documenting architecture, APIs, or processes for new team members.

**Load These Guides:**
1. `checklists.md` (3K) — Documentation checklist (README, API docs, architecture diagram)
2. `user-engagement-model.md` (2.4K) — How to explain decisions to stakeholders
3. `code-quality.md` (3.1K) — Code comments, inline docs, maintainability

**Total Cost:** 8.5K tokens

**Workflow:**
- [ ] Update main README (project overview, quick start)
- [ ] Document API (OpenAPI spec or README)
- [ ] Create architecture diagram (ASCII, Excalidraw, or similar)
- [ ] Write ADRs for major decisions (why this way vs. that way)
- [ ] Create runbook for common tasks (deployment, debugging, adding features)
- [ ] Add code comments (why, not what)
- [ ] Record decision history (why we chose this tech stack)

---

## Quick Workflow Lookup

| Task | Load These | Cost | Time |
|------|-----------|------|------|
| **OAuth** | security + testing + errors | 8.1K | 3-4 hours |
| **API Design** | architecture + quality + testing | 9K | 4-6 hours |
| **Security Audit** | security + quality + quick-ref | 7.1K | 2-3 hours |
| **Production Deploy** | deployment + testing + errors + quick-ref | 8K | 2-4 hours |
| **Architecture Decision** | architecture + quality + checklists | 9.2K | 2-3 days |
| **Large Refactor** | quality + testing + architecture + quick-ref | 9.4K | 2-3 weeks |
| **Integration Testing** | testing + errors + quality | 8.2K | 2-3 hours |
| **Documentation** | checklists + engagement + quality | 8.5K | 2-3 days |

---

## Stack-Specific Workflows

### Node.js + TypeScript

**If also using:** Express, Jest, PostgreSQL

**Add:** `ecosystem-guides/node-typescript.md` (2.5K)

**Example Workflow: Build a REST API**
1. Load ecosystem guide (Node patterns)
2. Load architecture guide (API design)
3. Load testing guide (Jest patterns)
4. Follow Express patterns + RTL testing

---

### React Web App

**If also using:** React Router, TypeScript, testing

**Add:** `ecosystem-guides/react-webapp.md` (2.8K)

**Example Workflow: Complex component with state**
1. Load ecosystem guide (React patterns)
2. Load testing guide (RTL patterns)
3. Load architecture guide (state management decision)
4. Follow component structure + testing patterns

---

**Last Updated:** June 16, 2026  
**Next Update:** September 2026 (after Q3 usage metrics)
