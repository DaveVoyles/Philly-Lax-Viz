# Should I Refactor This Code?

Quick decision tree for refactoring decisions.

## Start Here: Is This Code Causing Problems?

```
┌─ Is this code SLOWING DOWN DEVELOPMENT?
│  ├─ YES → Can I understand it in <2 min? 
│  │        ├─ NO → REFACTOR (readability issue)
│  │        └─ YES → Next question ↓
│  └─ NO → Can BUGS easily hide here?
│           ├─ YES → REFACTOR (maintainability risk)
│           └─ NO → Next question ↓
│
├─ Is this code DUPLICATED elsewhere?
│  ├─ YES (3+ places) → REFACTOR (DRY violation)
│  ├─ YES (2 places) → Maybe (depends on context)
│  └─ NO → Next question ↓
│
├─ Has this code CHANGED 5+ times in 6 months?
│  ├─ YES → REFACTOR (unstable, needs simplification)
│  └─ NO → Next question ↓
│
└─ Am I adding NEW FUNCTIONALITY here?
   ├─ YES → REFACTOR FIRST, then add feature
   └─ NO → SKIP REFACTOR (not worth the risk)
```

## Refactoring Rules

**ALWAYS refactor if:**
- Code blocks >20 lines (split into functions)
- Cyclomatic complexity >10 (too many branches)
- Same logic in 3+ places (extract to shared function)
- Function does >1 thing (single responsibility)
- Variable names are unclear (rename for clarity)

**SOMETIMES refactor if:**
- Code is 10-20 lines (only if unclear)
- Complexity 6-10 (depends on context)
- Duplication in 2 places (context matters)
- Tests exist (safe to refactor) vs. no tests (risky)

**SKIP refactoring if:**
- No failing tests in this code
- Not planning to touch this code soon
- Refactoring touches >5 files (too much risk)
- Deadline is <1 day away
- Code works and nobody complains

## Cost-Benefit Check

Before refactoring, estimate:

| Factor | Effort | Risk | Benefit |
|--------|--------|------|---------|
| Readability | Low | Low | High |
| Duplication | Medium | Low | High |
| Complexity | High | Medium | High |
| Performance | Medium | High | Medium |
| New framework | High | High | Medium |

**Refactor if:** `Effort + Risk < Benefit`

## Anti-Patterns (Don't Refactor For These)

- ❌ "It's old code" (doesn't matter if it works)
- ❌ "I want to use a new framework" (not refactoring, rewriting)
- ❌ "The naming is weird" (just rename variables, don't restructure)
- ❌ "It's not how I'd write it" (personal preference, skip)
- ❌ "Perfect is the enemy of done" (good enough > perfect+late)

---

**Decision:** Refactor if YES to 2+ above questions. Otherwise, skip.
