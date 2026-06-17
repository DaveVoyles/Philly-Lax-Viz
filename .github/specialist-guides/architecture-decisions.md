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

### Complete Trade-off Analysis Example

**Scenario:** Choosing caching strategy for user profile service

| Criterion | Weight | Redis | In-Memory | Database | Memcached |
|-----------|--------|-------|-----------|----------|-----------|
| **Performance (p99 latency)** | 30% | 9 (fast, <5ms) | 10 (fastest, <1ms) | 5 (slow, 50ms) | 8 (fast, 10ms) |
| **Operational Complexity** | 20% | 5 (requires ops) | 10 (none) | 9 (built-in) | 6 (moderate) |
| **Cost** | 15% | 6 (moderate) | 10 (free) | 9 (built-in) | 7 (managed) |
| **Scalability (horizontal)** | 20% | 9 (cluster) | 2 (single-node) | 10 (distributed DB) | 8 (cluster) |
| **Data Consistency** | 15% | 7 (eventual) | 8 (eventual) | 10 (strong) | 6 (eventual) |

**Scores:** Redis: 7.5 | In-Memory: 6.8 | Database: 8.5 | Memcached: 7.3

**Decision:** Database (highest overall score), or Redis if performance critical

**Rationale:** Database provides consistency + scalability; Redis if <5ms latency is non-negotiable despite ops cost

---

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

## More Design Patterns

### Mediator Pattern (Reduce Coupling)
**Problem:** Many objects talking to each other directly (tight coupling, hard to test)

```python
# ❌ BEFORE: Complex interdependencies
class Order:
  def __init__(self, inventory, payment, notification):
    self.inventory = inventory      # Couples to Inventory
    self.payment = payment          # Couples to Payment
    self.notification = notification # Couples to Notification

  def checkout(self):
    self.inventory.reserve(items)
    self.payment.process(amount)
    self.notification.send("Order confirmed")

# ✅ AFTER: Mediator handles coordination
class OrderMediator:
  def __init__(self, inventory, payment, notification):
    self.inventory = inventory
    self.payment = payment
    self.notification = notification

  def checkout(self, order):
    self.inventory.reserve(order.items)
    self.payment.process(order.amount)
    self.notification.send(f"Order {order.id} confirmed")

class Order:
  def __init__(self, mediator):
    self.mediator = mediator  # Only couples to Mediator
  
  def checkout(self):
    self.mediator.checkout(self)  # Delegates, doesn't coordinate directly
```

### Builder Pattern (Complex Object Construction)
**Problem:** Object with many optional parameters, confusing constructors

```python
# ❌ BEFORE: Many constructor overloads
class HTTPRequest:
  def __init__(self, url):
    pass
  def __init__(self, url, headers):  # Error: duplicate definition
    pass
  def __init__(self, url, headers, timeout, retries, auth):
    pass

# ✅ AFTER: Builder pattern
class HTTPRequest:
  def __init__(self, url):
    self.url = url
    self.headers = {}
    self.timeout = 30
    self.retries = 3

class HTTPRequestBuilder:
  def __init__(self, url):
    self.request = HTTPRequest(url)
  
  def with_headers(self, headers):
    self.request.headers = headers
    return self
  
  def with_timeout(self, timeout):
    self.request.timeout = timeout
    return self
  
  def with_retries(self, retries):
    self.request.retries = retries
    return self
  
  def build(self):
    return self.request

# Usage: Clear, fluent, no confusion
request = HTTPRequestBuilder('https://api.example.com') \
  .with_headers({'Authorization': 'Bearer token'}) \
  .with_timeout(60) \
  .with_retries(5) \
  .build()
```

---

## Architectural Anti-Patterns (Avoid)

### 🚫 Leaky Abstraction
```python
# ❌ BAD: Abstraction leaks implementation details
class UserRepository:
  def get_by_id(self, user_id):
    # Caller shouldn't know about SQL
    return execute_sql(f"SELECT * FROM users WHERE id = {user_id}")

# ✅ GOOD: Hides implementation
class UserRepository:
  def get_by_id(self, user_id):
    return User.from_row(self.db.fetch_one(
      Query.select().from_('users').where('id', '=', user_id)
    ))
```

### 🚫 God Object (Everything in One Class)
```python
# ❌ BAD: User class knows about database, caching, email, auth, logging
class User:
  def save_to_db(self): ...
  def cache(self): ...
  def send_email(self): ...
  def hash_password(self): ...
  def generate_jwt_token(self): ...
  def log_activity(self): ...
  # 100+ methods, unclear responsibility

# ✅ GOOD: Separate concerns
class User:
  def __init__(self, id, email, password_hash):
    self.id = id
    self.email = email
    self.password_hash = password_hash

class UserRepository:
  def save(self, user): ...  # Database responsibility

class EmailService:
  def send_confirmation(self, user): ...  # Email responsibility

class AuthService:
  def hash_password(self, password): ...  # Auth responsibility
  def verify_password(self, password, hash): ...
```

### 🚫 Premature Optimization
```python
# ❌ BAD: Optimized too early without profiling
class CacheOptimizer:
  # Complex caching logic before proving it's needed
  # Hard to maintain, probably premature

# ✅ GOOD: Write correct code first, optimize proven bottlenecks
class UserService:
  def get_user(self, user_id):
    return db.fetch(f"SELECT * FROM users WHERE id = {user_id}")

# Profile → Find bottleneck → Then optimize
# Add caching ONLY after measurement shows it's needed
```

---

## SOLID Violations with Fixes

### Single Responsibility Violation
```python
# ❌ BAD: Class does parsing AND validation AND saving
class UserProcessor:
  def process(self, csv_line):
    # Parse CSV
    fields = csv_line.split(',')
    # Validate
    if not self._validate(fields):
      raise ValueError("Invalid data")
    # Save
    self.db.insert('users', fields)

# ✅ GOOD: Separate concerns
class CSVParser:
  def parse(self, line):
    return line.split(',')

class UserValidator:
  def validate(self, fields):
    if not fields or len(fields) < 3:
      raise ValueError("Invalid data")
    return True

class UserRepository:
  def save(self, user):
    self.db.insert('users', user)

class UserProcessor:
  def __init__(self, parser, validator, repo):
    self.parser = parser
    self.validator = validator
    self.repo = repo
  
  def process(self, csv_line):
    fields = self.parser.parse(csv_line)
    self.validator.validate(fields)
    user = User.from_fields(fields)
    self.repo.save(user)
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
