---
title: "Architecture Essentials (Quick Reference)"
description: "Minimal architecture guidance — just the ADR template and decision checklist"
version: "1.0"
parent: "architecture-decisions.md"
---

## ADR Template (Architecture Decision Record)

Copy this format for every architecture decision:

```markdown
# ADR-N: [Title] (e.g., "Choose PostgreSQL as primary datastore")

## Context
Why are we deciding this now? What problem does it solve?
(1-3 sentences)

## Decision
What did we choose? (1 sentence)

## Options Considered
1. [Option A] — pros/cons
2. [Option B] — pros/cons
3. [Option C] — pros/cons

## Consequences (Why this choice)
- Pros: [what's good about it]
- Cons: [what's hard about it]
- Risk: [what could go wrong]

## Related Decisions
- ADR-1: [Related decision]
```

**Store in:** `docs/decisions/ADR-N-title.md`  
**When to write:** Anything that's hard to change later (database, API style, deployment model)

---

## Design Pattern Quick Reference

**Need to swap algorithms at runtime?** → **Strategy Pattern**  
**Need to simplify complex object creation?** → **Builder Pattern**  
**Need loose coupling between components?** → **Observer/Event Pattern**  
**Need to add behavior to existing objects?** → **Decorator Pattern**  
**Need to handle different types the same way?** → **Adapter Pattern**

---

## SOLID Quick Checklist

- [ ] **S — Single Responsibility:** Each class has one reason to change
- [ ] **O — Open/Closed:** Open for extension, closed for modification (use interfaces)
- [ ] **L — Liskov Substitution:** Subclasses can replace parent without breaking code
- [ ] **I — Interface Segregation:** Don't force classes to implement methods they don't use
- [ ] **D — Dependency Inversion:** Depend on abstractions, not concrete implementations

**Red flag:** Class with 5+ responsibilities, if/else chains checking types, "god object"

---

## Architecture Decision Checklist

Before proposing a major architecture change, ask:

- [ ] **Reversible?** Can we undo this if it doesn't work? (If not, extra caution)
- [ ] **Documented?** Is the rationale written down (ADR)?
- [ ] **Team aligned?** Did we discuss with 2+ engineers?
- [ ] **Tested?** Can we prove it works (prototype, spike)?
- [ ] **Scaling?** Does it work at 10x current load?
- [ ] **Cost?** Does it increase operational/money cost? By how much?

**Irreversible decisions** (database choice, API versioning, deployment model) require extra review.  
**Reversible decisions** (internal refactoring, new util function) can be faster.

---

## Anti-Patterns (What NOT to do)

🚫 **Big Ball of Mud** — No clear architecture, everything talks to everything  
→ **Fix:** Define clear layers (API → Service → Data) and enforce boundaries

🚫 **God Object** — One class doing too much (user manager doing auth + payments + logging)  
→ **Fix:** Extract concerns into separate classes (SingleResponsibility)

🚫 **Over-Engineering** — Building for scale you don't have yet  
→ **Fix:** Start simple, add complexity when you hit the limit

🚫 **Leaky Abstractions** — Implementation details leaked into interface  
→ **Fix:** Hide internal details, expose only what callers need

---

**Use Full Guide For:** Complete trade-off analysis, all design patterns, architectural anti-patterns  
**Full Guide:** `.github/specialist-guides/architecture-decisions.md`
