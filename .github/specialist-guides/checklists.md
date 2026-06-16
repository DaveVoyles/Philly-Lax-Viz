---
title: "Domain-Specific Checklists"
description: "Comprehensive checklists for all specialist domains"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## UI & Accessibility Checklist

**Keyboard Navigation**
- ✅ All interactive elements reachable via Tab key
- ✅ Focus order is logical (left-to-right, top-to-bottom)
- ✅ No focus traps (ability to tab out of all elements)
- ✅ Focus indicators visible (outline, background change, etc.)

**Labels & Screen Readers**
- ✅ Form inputs have associated labels
- ✅ Buttons have descriptive text (not just icons)
- ✅ Images have alt text
- ✅ Landmarks used correctly (nav, main, aside, footer)
- ✅ Semantic HTML used (buttons, not divs as buttons)

---

## Security & Auth Checklist

**Secrets & Credentials**
- ✅ No hardcoded passwords, API keys, tokens
- ✅ Credentials never logged or printed
- ✅ Secrets use environment variables or secrets manager
- ✅ Least-privilege: API tokens scoped to minimum needed

**Input & Data**
- ✅ User input validated before use
- ✅ No SQL injection vulnerabilities
- ✅ No XSS vulnerabilities (output escaped)
- ✅ No CSRF vulnerabilities (state-changing requests validated)

**Auth & Authorization**
- ✅ Authentication correct (is user who they claim?)
- ✅ Authorization correct (user has permission for action?)
- ✅ Session/token handling secure
- ✅ Password storage uses strong hashing (bcrypt, argon2)

---

## Migration & Database Safety Checklist

**Backup & Recovery**
- ✅ Recoverable database backup exists before migration
- ✅ Backup tested (can actually restore from it?)
- ✅ Rollback procedure documented and tested

**Destructive Operations**
- ✅ Scan migration for destructive SQL (DROP, TRUNCATE, ALTER TABLE DROP)
- ✅ Dry-run preview shown before execution
- ✅ Explicit user confirmation required
- ✅ Backward compatibility preserved if possible

**Data Integrity**
- ✅ Data types preserved or safely converted
- ✅ Constraints enforced (not-null, unique, foreign key)
- ✅ Indexes created for common queries
- ✅ Test migration on copy of production data first

---

## API Design & Versioning Checklist

**Endpoint Design**
- ✅ RESTful URL structure (resource-oriented, not action-oriented)
- ✅ Consistent naming conventions (plural nouns, kebab-case)
- ✅ Proper HTTP methods (GET, POST, PUT, DELETE, PATCH)
- ✅ Correct status codes (200, 201, 204, 400, 401, 404, 500)

**Versioning Strategy**
- ✅ Versioning approach chosen (URL v1/, header, query param)
- ✅ Strategy documented in README or docs
- ✅ Old versions maintained for backward compatibility period
- ✅ Deprecation timeline clear to users

**Deprecation**
- ✅ Old endpoints marked as deprecated
- ✅ Deprecation timeline given (e.g., "deprecated Jan 2026, remove Jun 2026")
- ✅ Migration guide provided for clients
- ✅ Deprecation communicated to all users

**Documentation**
- ✅ Endpoints documented (request/response examples)
- ✅ Error responses documented (what can go wrong?)
- ✅ Rate limits documented
- ✅ Authentication requirements documented

---

## Logging & Observability Checklist

**Structured Logging**
- ✅ Logs are key=value format (not prose)
- ✅ Log levels used correctly (INFO, WARN, ERROR, DEBUG)
- ✅ Timestamps included (ISO 8601)
- ✅ Request/response correlation IDs included

**What's Logged**
- ✅ API requests (method, path, status, latency)
- ✅ Database queries (query, parameters masked, latency)
- ✅ Errors (error message, stack trace, context)
- ✅ Important decisions (configuration, choice made, why)
- ✅ Performance milestones (batch completed, processing time)

**What's NOT Logged**
- ✅ No secrets (passwords, tokens, API keys, credentials)
- ✅ No sensitive personal data (SSN, email in logs)
- ✅ No implementation details (internal variable dumps)
- ✅ No overly verbose trivia (every function entry/exit)

**Metrics & Monitoring**
- ✅ Error rates tracked (transient vs. permanent)
- ✅ Latencies tracked (API response time, DB query time)
- ✅ Resource usage tracked (memory, CPU, connections)
- ✅ Alerts configured for critical thresholds
- ✅ Dashboards created for visibility

---

## Performance Optimization Checklist

**Profiling & Measurement**
- ✅ Baseline performance measured (before optimization)
- ✅ Hotspots identified (profiler used, not guessing)
- ✅ Target set (2x faster? reduce allocations? etc.)
- ✅ After changes: performance measured again

**Performance Guards**
- ✅ Latency checks in place (flag >10s, investigate >30s)
- ✅ Memory usage monitored (flag >500MB, justify >1GB)
- ✅ Database queries analyzed (N+1 problem? missing index?)
- ✅ Network calls batched where possible

**Optimization Patterns**
- ✅ Caching used where appropriate (with invalidation strategy)
- ✅ Lazy loading implemented for large data
- ✅ Batch operations used instead of loops
- ✅ Indexes added for common queries

**Regression Prevention**
- ✅ Performance benchmarks automated (CI checks)
- ✅ Production monitoring in place
- ✅ Alerts for performance regressions

---

## Error Handling & Resilience Checklist

**Error Recovery**
- ✅ Transient errors retried (exponential backoff)
- ✅ Permanent errors fail fast with context
- ✅ Ambiguous errors escalate to user
- ✅ Timeouts set for all external calls

**Resilience Patterns**
- ✅ Circuit breakers used for external services
- ✅ Graceful degradation when dependencies fail
- ✅ Fallbacks implemented where possible
- ✅ Error messages user-friendly, not technical

**Observability**
- ✅ Error rates tracked by type
- ✅ Error stack traces logged with context
- ✅ User-facing errors communicated clearly
- ✅ Recovery actions attempted are logged

---

## Documentation & Code Comments Checklist

**README & Getting Started**
- ✅ README describes what the project does
- ✅ Installation instructions are clear
- ✅ Quick start example provided
- ✅ Dependencies listed
- ✅ Configuration options documented

**Architecture Documentation**
- ✅ High-level architecture described (diagrams, text)
- ✅ Key design decisions documented in ADRs
- ✅ Data models explained (schema, relationships)
- ✅ API documentation current and complete

**Code Comments**
- ✅ Why (rationale) documented, not what (code is self-explanatory)
- ✅ Complex algorithms explained
- ✅ Non-obvious edge cases documented
- ✅ Performance trade-offs documented
- ✅ `TODO` comments have context (what, why, revisit info)

**Changelog & Versions**
- ✅ CHANGELOG.md updated with each release
- ✅ Version numbers follow semantic versioning
- ✅ Breaking changes documented
- ✅ Migration guides provided for major versions

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** Primary instructions section 6
