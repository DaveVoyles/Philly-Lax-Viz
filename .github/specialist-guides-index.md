---
title: "Specialist Guides Index"
description: "Quick reference for navigating specialist guides and deciding which to load"
version: "1.0"
lastUpdated: "2026-06-16"
---

## Quick Decision Tree

**Q: Working on error handling or debugging?**  
→ Load `.github/specialist-guides/error-handling.md`

**Q: Doing code review or refactoring?**  
→ Load `.github/specialist-guides/code-quality.md`

**Q: Making architectural decisions?**  
→ Load `.github/specialist-guides/architecture-decisions.md`

**Q: Working in a specific domain (API, security, database)?**  
→ Load `.github/specialist-guides/checklists.md`

**Q: Need to ask the user a question?**  
→ Load `.github/specialist-guides/user-engagement-model.md`

---

## Full Guide List & Token Costs

| Guide | Lines | Tokens | Use Case |
|-------|-------|--------|----------|
| **Primary Instructions** | ~200 | 5.5K | All sessions (always load) |
| error-handling.md | ~160 | 2.5K | Bug fixes, error recovery, observability |
| code-quality.md | ~150 | 3K | Code review, performance, refactoring |
| architecture-decisions.md | ~180 | 2.5K | Design decisions, ADRs, patterns |
| checklists.md | ~220 | 3K | Domain-specific work (API, security, etc.) |
| user-engagement-model.md | ~180 | 2K | User interaction, consultation decisions |

---

## Load Directives by Task Type

### Writing Code (New Features, Bug Fixes)
**Load:** Primary + `error-handling.md`
- Error classification and recovery
- Logging and observability
- Failure reporting format
- Estimated tokens: 5.5K + 2.5K = 8K

### Code Review & Refactoring
**Load:** Primary + `code-quality.md`
- Code quality metrics and review checklist
- Performance guards and optimization
- Refactoring discipline and safety
- Tech debt tracking
- Estimated tokens: 5.5K + 3K = 8.5K

### Design & Architecture Work
**Load:** Primary + `architecture-decisions.md`
- ADR framework and decision criteria
- SOLID principles application
- Design pattern guidelines
- Trade-off analysis
- Estimated tokens: 5.5K + 2.5K = 8K

### Domain-Specific Work (API, Security, Database, etc.)
**Load:** Primary + `checklists.md`
- UI & Accessibility checklist
- Security & Auth checklist
- Migration & Database safety
- API Design & Versioning
- Logging & Observability
- Performance Optimization
- Error Handling & Resilience
- Documentation & Code Comments
- Estimated tokens: 5.5K + 3K = 8.5K

### User Interaction & Questions
**Load:** Primary + `user-engagement-model.md`
- Decision tree: when to consult vs. proceed
- Question framework (multiple choice preferred)
- Consultation trigger examples
- User preference discovery
- Error communication severity levels
- Estimated tokens: 5.5K + 2K = 7.5K

### Multiple Task Types
**Load:** Primary + specialists as needed
- Example: Code review + API design = Primary + code-quality.md + checklists.md
- Example: Bug fix + architecture change = Primary + error-handling.md + architecture-decisions.md
- Estimated tokens: 5.5K + 2.5K + 3K = 11K (example)

---

## Load Strategy to Keep Costs Down

**Default (Always Load):**
- Primary instructions: 5.5K tokens

**Add Specialist Guides As Needed:**
- Load one specialist guide for focused work (adds 2-3K tokens)
- Load two specialists for cross-functional work (adds 4-6K tokens)
- Load all specialists only for comprehensive review (adds 12.5K tokens, ~18K total)

**Example Session Costs:**
```
Session 1 (writing code with error handling):
  Primary (5.5K) + error-handling.md (2.5K) = 8K tokens ✅ Efficient

Session 2 (code review with refactoring):
  Primary (5.5K) + code-quality.md (3K) = 8.5K tokens ✅ Efficient

Session 3 (architecture decision):
  Primary (5.5K) + architecture-decisions.md (2.5K) = 8K tokens ✅ Efficient

Session 4 (comprehensive work on new API):
  Primary (5.5K) + error-handling.md (2.5K) + code-quality.md (3K) 
  + architecture-decisions.md (2.5K) + checklists.md (3K) = 16.5K tokens
  (Still possible, but only when needed)
```

---

## How Specialist Guides Are Organized

### error-handling.md
- Error classification (transient/permanent/ambiguous)
- Retry strategies with exponential backoff
- Structured logging patterns
- Observability instrumentation
- Failure reporting format with severity levels

### code-quality.md
- Code quality metrics (complexity, coverage, maintainability)
- Code review checklist (logic, performance, security, testability)
- Performance guards (latency, memory, complexity bounds)
- Refactoring discipline (when safe, checklist, rollback paths)
- Tech debt tracking and rotation

### architecture-decisions.md
- ADR framework with decision criteria (when to write)
- SOLID principles application
- Design pattern guidelines (strategy, factory, observer, adapter, decorator)
- Trade-off analysis framework (options, criteria, scoring, decision)
- Common decision patterns (database, API style, deployment model)

### checklists.md (8 Consolidated Checklists)
1. **UI & Accessibility** — Keyboard flow, labels, screen readers
2. **Security & Auth** — Secrets, input validation, authorization
3. **Migration & Database** — Backups, destructive queries, integrity
4. **API Design & Versioning** — Endpoints, versioning, deprecation, documentation
5. **Logging & Observability** — Structured logs, metrics, monitoring
6. **Performance Optimization** — Profiling, caching, query optimization
7. **Error Handling & Resilience** — Recovery, circuit breakers, graceful degradation
8. **Documentation & Code Comments** — README, architecture docs, code comments

### user-engagement-model.md
- Decision tree: when to consult vs. proceed autonomously
- Question framework (multiple choice preferred, one at a time)
- Consultation trigger examples (permission, ambiguity, cost, security, architecture)
- User preference discovery and caching pattern
- Error communication severity levels (INFO, WARN, ERROR, CRITICAL)

---

## When NOT to Load Specialists

**Primary Instructions Only is Enough For:**
- Reading code to understand context (no specialist needed)
- Exploring files and directories (no specialist needed)
- General planning and analysis (no specialist needed)
- Routine tasks with known tools (no specialist needed)

**Load Specialists Only When:**
- You're about to make significant code changes
- You're reviewing code or doing refactoring
- You're making architectural decisions
- You're working in a specific domain (API, security, database)
- You need to ask the user questions

---

## Token Efficiency Summary

**Default:** 5.5K tokens (primary only)  
**Typical:** 7.5-8.5K tokens (primary + 1 specialist)  
**Comprehensive:** 11-16.5K tokens (primary + 2-3 specialists)  
**Full Reference:** 18K tokens (primary + all 5 specialists)

**Cost Savings vs. Monolithic Approach:**
- Monolithic single file: 16-18K tokens always
- Modular approach: 5.5K + load specialists = 40-50% cost reduction on average

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Best For:** Quick navigation and load strategy decision-making

---

[← Back to primary instructions: `.github/copilot-instructions.md`]
