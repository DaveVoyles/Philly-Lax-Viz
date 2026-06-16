---
title: "Code Quality & Performance Guide"
description: "Quality metrics, code review, performance guards, refactoring discipline, and tech debt tracking"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## Code Quality Metrics

### Track & Monitor
- **Cyclomatic Complexity:** Functions with >10 branches need refactoring
- **Code Coverage:** Aim for 70%+ for critical paths; 100% often wasteful
- **Maintainability Index:** Tools like CodeClimate flag high-risk files
- **Duplication:** Repeated code patterns should be extracted
- **Dependencies:** Circular dependencies are red flags

---

## Code Review Checklist

**Logic & Correctness**
- ✅ Does it do what's intended?
- ✅ Edge cases handled (nulls, empty collections, large values)?
- ✅ Error handling present (failures caught/reported)?

**Performance & Resources**
- ✅ No obvious O(n²) or worse on unbounded inputs?
- ✅ Memory usage reasonable?
- ✅ External calls batched where possible?

**Testability & Maintainability**
- ✅ Logic is isolated and testable?
- ✅ Dependencies are injectable?
- ✅ Clear names, small functions, reasonable nesting?

**Security & Resilience**
- ✅ No hardcoded secrets, passwords, or sensitive data?
- ✅ Input validation present?
- ✅ No injection vulnerabilities?
- ✅ Auth/authorization correct?

**NOT Code Review Responsibility**
- ❌ Style/formatting (use linting instead)
- ❌ Redundancy (applies only if refactoring not done)

---

## Performance Guards

### Before Optimization
- ✅ Measure baseline (profile, don't guess)
- ✅ Identify hotspots (where does time/memory actually go?)
- ✅ Set target (2x faster? reduce allocations?)

### During Development
- ⏱️ **Latency Guard:** Operations >10s flag; >30s require investigation
- 💾 **Memory Guard:** Allocations >500MB reviewed; >1GB needs justification
- 📊 **Complexity Guard:** O(n²) on unbounded inputs require review

### After Changes
- ✅ Regression check: Performance same or better than before?
- ✅ Benchmarking: If performance-critical, run repeatable benchmarks
- ✅ Monitoring: Instrument for production telemetry

### Common Optimization Patterns
- **Caching:** Memoize expensive computations (with invalidation strategy)
- **Batching:** Process items in groups not individually
- **Lazy Loading:** Load data only when needed
- **Profiling:** Use profilers (not guessing) to find true bottlenecks

---

## Refactoring Discipline

### When It's Safe to Refactor
- ✅ Passing test suite exists
- ✅ Changes isolated to one component/module
- ✅ No active PRs depend on old code
- ✅ Migration path is clear (breaking changes)

### When It's NOT Safe
- ❌ No test coverage (refactoring can hide bugs)
- ❌ Active PRs depend on current code
- ❌ Breaking change without migration strategy
- ❌ Architecture choice not yet validated

### Refactoring Checklist
- 📝 Document "before" and "after" architecture
- 🧪 Ensure tests pass after each small step (incremental!)
- 👀 Self-review with `git diff --cached`
- 📊 Measure: Is goal achieved? (complexity down, performance up, etc.)
- 🔙 Have rollback path ready

---

## Tech Debt Tracking

### Marking Tech Debt
```javascript
// TODO: [what] — [why] — [revisit: condition or timeframe]
// TODO: Optimize user list pagination — O(n) scan is slow on 1M+ users — 
//       revisit after search index added
```

### Recording in Commit
```
refactor(auth): extract token validation

Extracted validation logic for reusability.

Tech debt: Password reset flow still uses old email service;
should migrate to new service once notifications are refactored.
Tracked in issue #427.
```

### Debt Rotation
- **Monthly:** Review open tech debt issues
- **Quarterly:** Assess which debt is now critical and prioritize
- **Yearly:** Evaluate if old debt is obsolete or still relevant

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** Primary instructions section 4, 7
