---
title: "Workflow Guides: Common Task Combinations"
description: "Multi-specialist workflows for complex engineering tasks"
version: "1.0"
lastUpdated: "2026-06-16"
---

## Overview

These workflows combine 2-3 specialist guides for complex, multi-domain tasks. Use these to quickly assemble the right specialist guidance for your task.

---

## Workflow 1: Implementing OAuth / Authentication Flow

**Task:** Add OAuth 2.0 login to an application (includes security, testing, error handling)

**Load:** Primary + `security-hardening.md` + `testing-strategy.md` + `error-handling.md`  
**Estimated Tokens:** 5.5K + 3.5K + 3.3K + 2.8K = **15.1K**

**Sequence:**
1. **Start:** Read `security-hardening.md` → Authentication section
   - OAuth 2.0 flow, JWT tokens, RBAC patterns
   - Secrets management for client credentials
   
2. **Design Tests:** Read `testing-strategy.md` → Integration Testing section
   - Mock auth provider responses
   - Test token refresh, expired tokens, failed auth
   - Integration test with database (user creation)
   
3. **Error Handling:** Read `error-handling.md` → Domain-Specific Examples section
   - Network errors when calling auth provider
   - Token validation failures
   - Rate limiting from auth service
   
4. **Domain Check:** Read `checklists.md` → Security & Auth section
   - Verify SSL/TLS for auth endpoints
   - Check for secrets in logs
   - Validate CSRF protection (if browser-based)

**Key Questions to Ask (if needed):**
- Should tokens be stored in cookies (httpOnly) or localStorage?
- How long should tokens be valid? (trade-off: security vs. UX)
- What should happen when OAuth provider is down? (graceful degradation)

---

## Workflow 2: Optimizing Slow API Endpoints

**Task:** Profile and optimize a slow API endpoint (performance + code quality)

**Load:** Primary + `code-quality.md` + `checklists.md` + `deployment-infrastructure.md`  
**Estimated Tokens:** 5.5K + 3.1K + 3K + 3.4K = **15K**

**Sequence:**
1. **Baseline:** Read `code-quality.md` → Performance Guards section
   - Establish baseline: current latency, targets
   - Memory profiling, query analysis
   - Identify bottlenecks (N+1 queries, slow algorithms, etc.)
   
2. **Code Review:** Read `code-quality.md` → Code Review Checklist section
   - Check for unnecessary loops, nested complexity
   - Look for refactoring opportunities
   - Consider caching, batching, or async patterns
   
3. **Infrastructure:** Read `deployment-infrastructure.md` → CI/CD Pipeline section
   - Add performance regression tests to CI
   - Set latency thresholds
   - Monitor in production with metrics
   
4. **Monitoring:** Read `checklists.md` → Logging & Observability section
   - Add structured logs for timing data
   - Set up alerts for latency threshold breaches
   - Track percentiles (p50, p95, p99)

**Key Questions:**
- Is this CPU-bound, I/O-bound, or memory-bound? (determines optimization strategy)
- What latency target? (50ms? 200ms? impacts architecture)
- Should we cache? (trade-off: complexity vs. consistency)

---

## Workflow 3: Security Audit & Hardening

**Task:** Conduct comprehensive security audit and implement hardening

**Load:** Primary + `security-hardening.md` + `checklists.md` + `code-quality.md`  
**Estimated Tokens:** 5.5K + 3.5K + 3K + 3.1K = **15.1K**

**Sequence:**
1. **Quick Scan:** Read `checklists.md` → Security & Auth section
   - Go through all items: secrets, input validation, auth, CSRF, etc.
   - Mark items as ✅ pass, ⚠️ review, or ❌ fail
   
2. **Deep Dive:** Read `security-hardening.md` by section
   - Secrets Management → Review all credentials
   - Authentication → Check auth patterns
   - Input Validation → Review all user inputs
   - OWASP Top 10 → Check each vulnerability class
   
3. **Code Review:** Read `code-quality.md` → Code Review Checklist (security items)
   - Look for injection vulnerabilities
   - Check error messages (don't leak sensitive info)
   - Verify no credentials in code/logs
   
4. **Remediation Planning:**
   - Prioritize findings (critical → high → medium → low)
   - Plan rollout (some can wait, some need immediate fix)
   - Add tests for each fix (prevent regression)

**Deliverable:** Security audit report with findings, severity, remediation plan, and owner assignments

---

## Workflow 4: Deploying to Production (New Service)

**Task:** Set up CI/CD and deploy a new service to production

**Load:** Primary + `deployment-infrastructure.md` + `testing-strategy.md` + `error-handling.md`  
**Estimated Tokens:** 5.5K + 3.4K + 3.3K + 2.8K = **15K**

**Sequence:**
1. **CI/CD Setup:** Read `deployment-infrastructure.md` → CI/CD Pipeline section
   - Design pipeline stages (build, test, deploy)
   - Define approval gates
   - Plan rollback strategy
   
2. **Testing Gates:** Read `testing-strategy.md` → Test Pyramid section
   - Define unit test coverage threshold (target: >80%)
   - Add integration tests (database, external services)
   - Add smoke tests for production (verify deployment)
   
3. **Deployment Strategy:** Read `deployment-infrastructure.md` → Deployment Strategies section
   - Start with blue-green or canary (safer than rolling for new service)
   - Plan rollback: database migrations, secrets, config changes
   
4. **Error Handling:** Read `error-handling.md` → Observability section
   - Set up structured logging
   - Define alerts for critical errors
   - Set up dashboards for monitoring
   
5. **Environment Check:** Read `checklists.md` → API Design (if applicable) + Logging & Observability
   - Verify all secrets in vault, not in code
   - Check monitoring is in place
   - Test health checks / readiness probes

**Pre-Flight Checklist:**
- ✅ All tests pass locally and in CI
- ✅ Code reviewed and approved
- ✅ Database migrations tested
- ✅ Secrets stored in vault
- ✅ Monitoring and alerts configured
- ✅ Runbook written (how to respond if things break)
- ✅ Team on standby for first 30 minutes post-deployment

---

## Workflow 5: Architectural Decision Making (Database Choice)

**Task:** Evaluate and choose between PostgreSQL, MongoDB, and Redis for a new component

**Load:** Primary + `architecture-decisions.md` + `checklists.md`  
**Estimated Tokens:** 5.5K + 3.2K + 3K = **11.7K**

**Sequence:**
1. **Framework:** Read `architecture-decisions.md` → Trade-off Analysis section
   - Set up decision criteria scorecard
   - Define weights: performance (30%), consistency (25%), cost (20%), team skill (15%), etc.
   
2. **Options Analysis:** For each option, evaluate:
   - **PostgreSQL:** ACID transactions, complex queries, mature ecosystem
   - **MongoDB:** Flexible schema, horizontal scaling, eventual consistency
   - **Redis:** In-memory, fast, good for caching/sessions
   - Score each against criteria
   
3. **Domain Check:** Read `checklists.md` → Migration & Database section
   - Data consistency requirements
   - Query complexity
   - Scale expectations
   - Backup/recovery strategy
   
4. **Document Decision:** Create ADR (`docs/decisions/NNNN-database-choice.md`)
   - Problem statement
   - Decision (with scoring rationale)
   - Consequences (migration effort, cost, performance)
   - Alternative approaches considered

**Example Scoring:**
```
Criteria          | Weight | PostgreSQL | MongoDB | Redis
Performance       | 30%    | 8/10       | 7/10    | 10/10
Consistency       | 25%    | 10/10      | 5/10    | 6/10
Query Flexibility | 20%    | 9/10       | 10/10   | 3/10
Team Skill        | 15%    | 8/10       | 5/10    | 8/10
Cost              | 10%    | 7/10       | 6/10    | 9/10
--------
TOTAL Score       |        | 8.4/10     | 6.8/10  | 7.3/10
--------
Decision: PostgreSQL (best overall for primary data store)
```

---

## Workflow 6: Refactoring Large Class to Composition

**Task:** Refactor a large, complex class into smaller, composed services

**Load:** Primary + `code-quality.md` + `architecture-decisions.md` + `testing-strategy.md`  
**Estimated Tokens:** 5.5K + 3.1K + 3.2K + 3.3K = **15.1K**

**Sequence:**
1. **Identify Refactoring Target:** Read `code-quality.md` → Code Quality Metrics section
   - Measure cyclomatic complexity (target: <10 per function)
   - Measure cognitive complexity
   - Check test coverage (must have >80% before refactoring)
   
2. **Plan Refactoring:** Read `code-quality.md` → Refactoring Examples section
   - Identify "god object" patterns
   - Plan extraction: which responsibilities → which new classes?
   - Consider composition over inheritance
   
3. **Design New Architecture:** Read `architecture-decisions.md` → Design Patterns section
   - Consider Strategy pattern (swap algorithms)
   - Consider Facade pattern (simplify interface)
   - Consider Composition pattern (many small objects)
   
4. **Test Safely:** Read `testing-strategy.md` → Unit Testing section
   - Keep all tests passing during refactoring (green bar always)
   - Add tests for new extracted classes
   - Use "golden master" or approval testing if complex behavior
   
5. **Commit Incrementally:**
   - Extract one concern at a time
   - Each commit should be small and testable
   - Use descriptive messages for refactoring commits

**Safety Checklist:**
- ✅ Baseline test coverage >80%
- ✅ All tests pass before starting
- ✅ Refactoring in small steps (1-2 extractions per commit)
- ✅ All tests pass after each step
- ✅ Complexity metrics improve
- ✅ Code review (another person checks design)
- ✅ Performance not degraded (profile before/after)

---

## Workflow 7: Adding Integration Tests for External API

**Task:** Write integration tests for code that calls an external API (GitHub, Stripe, etc.)

**Load:** Primary + `testing-strategy.md` + `error-handling.md` + `checklists.md`  
**Estimated Tokens:** 5.5K + 3.3K + 2.8K + 3K = **14.6K**

**Sequence:**
1. **Test Strategy:** Read `testing-strategy.md` → Integration Testing section
   - Decide: mock vs. test double vs. real API?
   - Use VCR/Cassette for recording real responses
   - Or use API test doubles (Nock, etc.)
   
2. **Mock Setup:** Read `testing-strategy.md` → Mocking section
   - Mock success responses
   - Mock failure cases (timeouts, 5xx, rate limits)
   - Test retry logic
   
3. **Error Scenarios:** Read `error-handling.md` → Domain-Specific Examples → API section
   - Network timeout (how long to wait? retry?)
   - Invalid response (malformed JSON, unexpected fields)
   - Rate limiting (429 response)
   - Authentication failures (401, 403)
   
4. **Test Data:** Read `testing-strategy.md` → Test Data Management section
   - Create fixtures for common API responses
   - Use factory for test data
   - Clean up test data between test runs
   
5. **CI Integration:** Read `checklists.md` → Logging & Observability section
   - Add test to CI pipeline
   - Set test timeout (don't hang forever waiting for API)
   - Mock external APIs in CI (don't call real API from CI)

**Test Example:**
```javascript
describe('GitHub API Integration', () => {
  it('should handle rate limit response', async () => {
    // Mock rate limit response
    nock('https://api.github.com')
      .get('/repos/owner/repo')
      .reply(429, {}, { 'x-ratelimit-reset': Date.now() / 1000 + 60 })
    
    // Should retry after delay
    const result = await githubClient.getRepo('owner/repo')
    expect(result).toEqual(mockRepoData)
  })
})
```

---

## Workflow 8: Writing Developer Documentation

**Task:** Document a complex system for new team members (README, architecture, runbooks)

**Load:** Primary + `checklists.md` + `architecture-decisions.md`  
**Estimated Tokens:** 5.5K + 3K + 3.2K = **11.7K**

**Sequence:**
1. **README Structure:** Read `checklists.md` → Documentation & Code Comments section
   - Purpose and quick-start
   - Installation and setup
   - Architecture overview
   - Contributing guidelines
   - Troubleshooting section
   
2. **Architecture Documentation:** Read `architecture-decisions.md` → ADR Framework section
   - Write ADRs for major decisions (database, API style, deployment)
   - Explain context, consequences, alternatives
   - Link to related ADRs
   
3. **Runbooks:** Create runbooks for common operational tasks
   - How to deploy
   - How to monitor and alert
   - How to roll back
   - How to debug production issues
   
4. **Code Comments:** Read `checklists.md` → Documentation section
   - Focus on "why", not "what" (code shows what)
   - Comment on complex algorithms, non-obvious trade-offs
   - Link to related documentation
   
5. **Validation:**
   - Have new team member read docs and follow them
   - Collect feedback
   - Update documentation based on confusion points

---

## Quick Load Reference

| Workflow | Load | Tokens |
|----------|------|--------|
| OAuth Implementation | Primary + security + testing + error-handling | 15.1K |
| API Optimization | Primary + code-quality + checklists + deployment | 15K |
| Security Audit | Primary + security + checklists + code-quality | 15.1K |
| Production Deploy | Primary + deployment + testing + error-handling | 15K |
| Architecture Decision | Primary + architecture + checklists | 11.7K |
| Large Refactor | Primary + code-quality + architecture + testing | 15.1K |
| Integration Tests | Primary + testing + error-handling + checklists | 14.6K |
| Documentation | Primary + checklists + architecture | 11.7K |

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related Guides:**
- `.github/specialist-guides/error-handling.md`
- `.github/specialist-guides/code-quality.md`
- `.github/specialist-guides/architecture-decisions.md`
- `.github/specialist-guides/testing-strategy.md`
- `.github/specialist-guides/deployment-infrastructure.md`
- `.github/specialist-guides/security-hardening.md`
- `.github/specialist-guides/checklists.md`
- `.github/specialist-guides/user-engagement-model.md`
