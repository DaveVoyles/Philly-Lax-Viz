---
title: "Testing Essentials (Quick Reference)"
description: "Minimal testing guidance — just the test pyramid and basic patterns"
version: "1.0"
parent: "testing-strategy.md"
---

## The Test Pyramid (What to Write)

```
       👁️  E2E Tests (10%)
      /  \
    /      \
   🔗 Integration Tests (30%)
  /          \
/              \
🧪 Unit Tests (60%)
```

**Rule:** Write 60% unit tests, 30% integration, 10% E2E. Don't invert the pyramid.

---

## Unit Test Pattern (Fast, Many)

**What:** Single function/method in isolation  
**Speed:** <1ms per test  
**Mocking:** Mock all external dependencies  
**Coverage:** Target >80% per file  

```javascript
describe('calculateTax', () => {
  it('should apply 10% tax to $100', () => {
    const result = calculateTax(100, 0.1);
    expect(result).toBe(110);
  });
  
  it('should handle $0 amount', () => {
    const result = calculateTax(0, 0.1);
    expect(result).toBe(0);
  });
});
```

**When to write:** Every time you write a function. Test should exist before or same time as code.

---

## Integration Test Pattern (Slower, Fewer)

**What:** Multiple components together (e.g., API handler + database)  
**Speed:** 10-100ms per test  
**Setup:** Use test database or in-memory DB  
**Coverage:** Key workflows only (happy path + 1-2 error cases)  

```javascript
describe('POST /api/users', () => {
  it('should create user and return id', async () => {
    const res = await request(app).post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' });
    
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    
    // Verify it's in database
    const user = await db.users.findById(res.body.id);
    expect(user.name).toBe('Alice');
  });
});
```

---

## E2E Test Pattern (Slowest, Rare)

**What:** Full flow from user perspective (UI click → API → DB → response)  
**Speed:** 1-5 seconds per test  
**When:** Critical paths only (login, checkout, core feature)  
**Count:** 3-5 per major feature  

```javascript
describe('User signup flow', () => {
  it('should sign up and login', async () => {
    await page.goto('https://app.example.com/signup');
    await page.type('input[name=email]', 'alice@example.com');
    await page.type('input[name=password]', 'P@ssw0rd');
    await page.click('button[type=submit]');
    
    await page.waitForNavigation();
    const url = page.url();
    expect(url).toContain('/dashboard');
  });
});
```

---

## CI/CD Gate: What Must Pass Before Merge

```yaml
# Pull request blocks merge if any fail:
- ✅ Unit tests: >80% coverage
- ✅ Integration tests: 0 flaky tests
- ✅ Lint: 0 errors
- ✅ Type check: 0 errors (TS/strict mode)
- ✅ Security scan: 0 high/critical vulns
- ✅ E2E (if critical path): 0 failures
```

---

## Anti-Patterns (Don't Do This)

🚫 **Flaky tests** — Pass/fail randomly (bad timing, test pollution)  
→ **Fix:** Use explicit waits, isolate test data, clean up after each test

🚫 **Test-after** — Write test after code  
→ **Fix:** TDD (test-first) catches edge cases earlier

🚫 **Testing implementation, not behavior** — Test internal state  
→ **Fix:** Test inputs → outputs, let implementation be a black box

🚫 **100% coverage** — Tests that don't prove anything  
→ **Fix:** Focus on critical logic and edge cases (80% is usually right)

---

**Use Full Guide For:** Mocking libraries, test data factories, performance testing, security testing  
**Full Guide:** `.github/specialist-guides/testing-strategy.md`
