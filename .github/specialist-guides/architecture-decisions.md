---
title: "Architectural Decision-Making Guide"
description: "ADR framework, SOLID principles, design patterns, and trade-off analysis"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## ADR (Architectural Decision Record) Framework

### When to Write an ADR

**Must Write:**
- Architecturally significant decisions (impacts system design, scalability, maintainability, cost)

**Should Write:**
- Multi-team decisions
- Long-lived choices
- High-risk trade-offs

**Skip:**
- Tactical choices (function refactoring)
- Easily reversible decisions (variable naming)
- Implementation details

### Examples That Warrant ADRs
- ✅ Database choice (PostgreSQL vs. MongoDB)
- ✅ API versioning strategy (URL vs. header)
- ✅ Authentication approach (JWT vs. session vs. OAuth)
- ✅ Caching strategy (Redis vs. in-memory vs. CDN)
- ✅ Deployment model (monolith vs. microservices)

### Examples That Don't
- ❌ Loop refactoring (implementation detail)
- ❌ Variable naming (code style)
- ❌ Test organization (project structure)

### ADR Template (MADR 4.0.0)
```markdown
# [Number]: [Title]

## Context
[Problem, constraints, context]

## Decision
[What we decided]

## Consequences
[Positive and negative outcomes]

## Alternatives Considered
[Options rejected and why]

## Related Decisions
[Links to related ADRs]
```

**Location:** `docs/decisions/NNNN-title.md` (numbered sequentially)

---

## SOLID Principles Application

### Single Responsibility
Each module/function has one reason to change. If you describe it with "and", it's too big.

### Open/Closed
Open for extension, closed for modification. Use interfaces, not concrete implementations.

### Liskov Substitution
Subtypes are interchangeable with base types. No surprises when using subclasses.

### Interface Segregation
Clients depend only on interfaces they use. Avoid forcing clients to depend on unused methods.

### Dependency Inversion
Depend on abstractions, not concretions. Inject dependencies, don't hardcode them.

---

## Design Pattern Guidelines

### Common Patterns & When to Use

**Strategy:** Multiple algorithms for same problem (choose at runtime)
- Example: Multiple payment processors, file format handlers

**Factory:** Decouple object creation from usage
- Example: Creating different logger implementations

**Observer:** Decouple event producers from consumers
- Example: Event listeners, callbacks, subscriptions

**Adapter:** Integrate incompatible interfaces
- Example: Wrapping third-party APIs, legacy code

**Decorator:** Add behavior to objects dynamically
- Example: Logging, caching, compression wrappers

---

## Trade-off Analysis Framework

### Step-by-Step

1. **Identify Options:** List 2-3 realistic approaches
2. **Define Criteria:** What matters? (performance, simplicity, cost, flexibility, maintainability)
3. **Score Each:** Rate each option against criteria (high/medium/low or numeric)
4. **Decide:** Choose best overall (rarely "best at everything")
5. **Document:** Record decision and trade-off in ADR or commit message

### Example Trade-off
```
Option A (Redis):     Fast (+), Adds operational complexity (-), Costs money (-)
Option B (In-Memory): Simpler (+), Not distributed (-), Limited size (-)
Option C (Database):  Persistent (+), Slower (-), Complex query logic (-)

Decision: Option A (Redis)
Rationale: Performance is critical; operational complexity justified
Trade-off: Accepting added complexity for speed and distributed cache benefits
```

---

## Patterns for Common Decisions

### Choosing a Database
- **Structured relational data** → PostgreSQL
- **Document-oriented** → MongoDB
- **High throughput, eventual consistency** → Cassandra
- **Key-value, extreme speed** → Redis
- **Decision criteria:** Data model, scale, consistency needs, query patterns

### Choosing an API Style
- **REST:** Standard, simple, stateless (good default)
- **GraphQL:** Client specifies fields, reduces over-fetching (good for mobile)
- **gRPC:** High-performance, streaming (good for services)
- **Webhooks:** Event-driven, decoupled (good for notifications)
- **Decision criteria:** Client diversity, performance, simplicity, real-time needs

### Choosing Deployment Model
- **Monolith:** Simpler to start, easier debugging, shared resources
- **Microservices:** Independent scaling, fault isolation, team autonomy
- **Serverless:** No ops, pay-per-use, auto-scaling
- **Decision criteria:** Team size, scaling patterns, operational capacity

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** Primary instructions section 7
