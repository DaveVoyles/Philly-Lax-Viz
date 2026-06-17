# Should I Add a Test?

Quick decision tree for test coverage decisions.

## Test Priority Matrix

```
┌─ Is this code CRITICAL?
│  ├─ YES (payment, auth, security) → TEST (100% coverage)
│  └─ NO → Next question ↓
│
├─ Will BUGS here cause user pain?
│  ├─ YES → TEST (high impact)
│  ├─ NO → Next question ↓
│  
├─ Has this code had BUGS before?
│  ├─ YES (3+ fixes) → TEST (history of problems)
│  └─ NO → Next question ↓
│
├─ Is this code COMPLEX? (cyclomatic complexity >5)
│  ├─ YES → TEST (many branches = many bugs)
│  └─ NO → Next question ↓
│
├─ Will I TOUCH this code again?
│  ├─ YES (within 6 months) → TEST (protects refactoring)
│  └─ NO → Maybe skip (dead code)
│
└─ Can I write a test in <15 minutes?
   ├─ YES → TEST NOW
   └─ NO (complex setup) → Skip for now, revisit
```

## Coverage Rules (Pareto)

**80% value at 20% effort:**

| Coverage | Effort | Where to Test | Value |
|----------|--------|---------------|-------|
| **50%** | 10 min | Critical paths only | High |
| **70%** | 30 min | Happy path + edge cases | High |
| **85%** | 2 hours | Most paths | Diminishing |
| **95%** | 4+ hours | Every edge case | Low |

**Target 70% coverage. Skip the last 30%.**

## Test Type Decision

| Scenario | Test Type | Why |
|----------|-----------|-----|
| Logic, math, parsing | **Unit** | Fast, isolated |
| API contract | **Integration** | Catches interface issues |
| Full user flow | **E2E** | Catches integration bugs |
| Complex algorithm | **Unit** | Covers edge cases |
| Database + API | **Integration** | Real DB interactions |
| User signup → payment | **E2E** | End-to-end flow |

## When NOT to Test

- ❌ Trivial code (getters, simple assignments)
- ❌ Framework/library code (test your usage, not framework)
- ❌ UI style changes (test visually, not with tests)
- ❌ Prototype/spike code (delete before shipping)
- ❌ Third-party API mocks (too brittle)

## When to DEFINITELY Test

- ✅ Business logic (payments, auth, state machines)
- ✅ Error handling (exceptions, retries, failures)
- ✅ Security (input validation, permissions)
- ✅ Complex algorithms (sorting, matching, search)
- ✅ State transitions (state machines)
- ✅ Edge cases (empty arrays, null, negative)

## Quick Test Priority

1. **Unit tests first** (70% coverage, 80% value)
2. **Integration tests** (test API contracts)
3. **E2E tests** (critical user flows only, not everything)
4. **Performance tests** (if performance is critical)

## Coverage Anti-Patterns

- ❌ 100% coverage of trivial code (waste of time)
- ❌ Testing implementation instead of behavior
- ❌ Test code that's more complex than code being tested
- ❌ Mocking everything (defeats purpose of integration tests)
- ❌ Tests that pass when code is broken (useless tests)

---

**Decision:** Add test if 2+ conditions match the YES path. Otherwise, skip for now.
