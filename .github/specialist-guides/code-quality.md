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

## Refactoring Examples

### Callback Hell → Async/Await
```javascript
// ❌ BEFORE: Callback nesting
getUserData(userId, function(err, user) {
  if (err) return handleError(err);
  getOrders(user.id, function(err, orders) {
    if (err) return handleError(err);
    getShippingStatus(orders[0].id, function(err, status) {
      if (err) return handleError(err);
      console.log(user, orders, status);
    });
  });
});

// ✅ AFTER: Async/await clarity
async function displayUserWithOrders(userId) {
  try {
    const user = await getUserData(userId);
    const orders = await getOrders(user.id);
    const status = await getShippingStatus(orders[0].id);
    console.log(user, orders, status);
  } catch (err) {
    handleError(err);
  }
}
```

### God Object → Composition
```python
# ❌ BEFORE: One class doing everything (1000+ lines)
class Order:
  def calculate_tax(self): ...
  def send_invoice(self): ...
  def apply_discount(self): ...
  def check_inventory(self): ...
  def log_metrics(self): ...
  # 50+ methods, unclear responsibility

# ✅ AFTER: Separate concerns
class Order:
  def __init__(self, items, tax_calculator, inventory_service):
    self.items = items
    self.tax_calculator = tax_calculator
    self.inventory = inventory_service
  
  def total_with_tax(self):
    subtotal = sum(item.price for item in self.items)
    return self.tax_calculator.calculate(subtotal)
  
  def can_fulfill(self):
    return self.inventory.check_all(self.items)

class TaxCalculator:
  def calculate(self, subtotal): ...

class InventoryService:
  def check_all(self, items): ...
```

### Complex Conditionals → Strategy Pattern
```python
# ❌ BEFORE: Nested conditionals
def calculate_price(user, product):
  if user.is_premium:
    if product.category == 'electronics':
      if user.loyalty_points > 1000:
        return product.price * 0.7
      else:
        return product.price * 0.8
    else:
      return product.price * 0.9
  else:
    return product.price

# ✅ AFTER: Strategy pattern
class PricingStrategy:
  def apply(self, base_price, user, product):
    raise NotImplementedError

class PremiumElectronicsStrategy(PricingStrategy):
  def apply(self, base_price, user, product):
    discount = 0.7 if user.loyalty_points > 1000 else 0.8
    return base_price * discount

class PremiumOtherStrategy(PricingStrategy):
  def apply(self, base_price, user, product):
    return base_price * 0.9

def get_strategy(user, product):
  if user.is_premium:
    return PremiumElectronicsStrategy() if product.category == 'electronics' else PremiumOtherStrategy()
  return Strategy()  # Standard pricing
```

---

## Common Anti-Patterns (Avoid)

### 🚫 Feature Envy (Using others' data too much)
```python
# ❌ BAD: OrderProcessor knows too much about Order internals
class OrderProcessor:
  def process(self, order):
    subtotal = sum(item.price * item.qty for item in order.items)
    tax = subtotal * order.tax_rate
    return subtotal + tax

# ✅ GOOD: Ask Order to calculate its own total
class OrderProcessor:
  def process(self, order):
    return order.calculate_total()

class Order:
  def calculate_total(self):
    subtotal = sum(item.price * item.qty for item in self.items)
    return subtotal * (1 + self.tax_rate)
```

### 🚫 Data Clumps (Repeated groups of variables)
```python
# ❌ BAD: User info repeated across methods
def create_user(name, email, phone, address, city, state, zip):
  pass

def update_user(name, email, phone, address, city, state, zip):
  pass

# ✅ GOOD: Group into objects
class Address:
  def __init__(self, street, city, state, zip):
    self.street = street
    self.city = city
    self.state = state
    self.zip = zip

class User:
  def __init__(self, name, email, phone, address):
    self.name = name
    self.email = email
    self.phone = phone
    self.address = address
```

### 🚫 Primitive Obsession (Using primitives instead of objects)
```python
# ❌ BAD: Phone number as string, validated everywhere
def validate_and_format_phone(phone: str) -> str:
  # Repeated in 10+ places
  return f"({phone[:3]}) {phone[3:6]}-{phone[6:]}"

# ✅ GOOD: Phone as domain object
class PhoneNumber:
  def __init__(self, number: str):
    if not self._is_valid(number):
      raise ValueError("Invalid phone number")
    self.value = number
  
  def formatted(self) -> str:
    return f"({self.value[:3]}) {self.value[3:6]}-{self.value[6:]}"
```

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
