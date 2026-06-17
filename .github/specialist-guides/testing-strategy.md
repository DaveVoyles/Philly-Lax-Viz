---
title: "Testing Strategy & Quality Assurance Guide"
description: "Unit, integration, E2E, performance, and security testing patterns, test pyramid, coverage expectations"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## Test Pyramid: Quantity vs. Value

```
           /\
          /  \         ~2-3% E2E tests (slow, comprehensive)
         /____\
        /      \       ~15-20% Integration tests (moderate)
       /        \
      /__________\     ~75-80% Unit tests (fast, isolated)
```

**Key Principle:** Write many fast tests (unit), fewer medium tests (integration), minimal slow tests (E2E).

---

## Unit Testing Patterns

### When to Write Unit Tests
- ✅ Business logic, algorithms, calculations
- ✅ Validation functions, parsers, formatters
- ✅ Pure functions with clear inputs/outputs
- ✅ Error paths and edge cases

### Isolation & Mocking
- **Mock external dependencies:** Database, HTTP, file system, clock
- **Don't mock:** Internal domain logic, frameworks (unless they're the subject)
- **When to use spies:** Verify side effects (logging, event emission) without changing behavior

### Test Data & Fixtures
- **Builders:** Create test objects with minimal setup (e.g., `UserBuilder().withEmail("test@example.com").build()`)
- **Factories:** Reusable, known-good test data for common scenarios
- **Avoid:** Brittle fixtures with unused fields; clear unused test data after test

### Naming Convention
```
test<FunctionName>_<Input>_<ExpectedOutcome>

✅ testCalculateDiscount_customerHas100PlusOrders_returns20Percent
✅ testParseDate_invalidDateString_throwsParseException
❌ testCalculateDiscount (unclear what's being tested)
❌ test1, test2, test3 (no information)
```

### Coverage Expectations
- **Critical paths:** 90%+ coverage
- **Business logic:** 80%+ coverage
- **Utilities & helpers:** 70%+ coverage
- **UI/view code:** 40-50% (integration tests often better)
- **Don't chase 100%:** Diminishing returns; focus on risk, not percentage

---

## Integration Testing

### What to Test
- ✅ Database operations (CRUD, queries, transactions)
- ✅ External API interactions (with mocks/stubs if possible)
- ✅ Workflow across multiple components
- ✅ Error handling across service boundaries
- ✅ Configuration loading and validation

### Test Data Setup
**Database Fixtures:**
```sql
-- Use migrations or seed scripts, not hardcoded INSERT statements
-- Example: tests/fixtures/users.sql loaded before each test
INSERT INTO users (id, email, name) VALUES (1, 'test@example.com', 'Test User');
INSERT INTO orders (id, user_id, total) VALUES (1, 1, 99.99);
```

**API Mocking:** Use libraries like Wiremock, Prism, or httpbin for predictable responses.

### Transactional Safety
- **Option 1:** Rollback after each test (fast, no cleanup)
- **Option 2:** Truncate/reset tables between tests (slower, cleaner)
- **Option 3:** Use temporary schemas (PostgreSQL, isolated per test)

### Timeout & Stability
- Set reasonable timeouts (5s for local, 10s for CI)
- Test flakiness is a code smell (usually timing issues, external dependency races)

---

## End-to-End (E2E) Testing

### When to Write E2E Tests
- ✅ Critical user workflows (login → purchase → confirmation)
- ✅ Cross-domain journeys (frontend + backend + database)
- ✅ Real browser behavior (JavaScript, DOM events)
- ❌ Single endpoint validations (use unit/integration instead)
- ❌ Minor UI changes (brittle, high maintenance)

### Page Object Pattern
```typescript
class LoginPage {
  async login(email: string, password: string) {
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
  }
}

// Test uses page objects, not raw selectors
test('Login with valid credentials succeeds', async () => {
  const loginPage = new LoginPage(page);
  await loginPage.login('test@example.com', 'password123');
  await expect(page).toHaveURL('/dashboard');
});
```

### Tools & Frameworks
- **Playwright** — Modern, fast, cross-browser support
- **Cypress** — Developer-friendly, good debugging
- **Selenium** — Legacy, works everywhere
- **WebdriverIO** — High-level, mobile-friendly

---

## Performance Testing

### Load Testing
- **Tool:** k6, JMeter, Locust, or cloud services (AWS, LoadImpact)
- **Threshold:** Define acceptable response time (e.g., p95 <500ms under 1K RPS)
- **When to run:** Before major releases, after performance optimizations

### Profiling
- **CPU Profiling:** Identify hot functions using flame graphs
- **Memory Profiling:** Detect memory leaks, excessive allocations
- **Database Query Profiling:** Find slow queries, missing indexes

### Benchmarking
```
Run 3+ times, compare against baseline:
- Before optimization: p95 = 800ms
- After optimization:  p95 = 400ms
- Improvement: 2× speedup ✅
```

---

## Security Testing

### Static Analysis (SAST)
- Scan code for vulnerabilities before runtime
- Tools: Snyk, SonarQube, Checkmarx, GitHub Advanced Security
- Run in CI: Fail build on critical/high severity findings

### Dynamic Analysis (DAST)
- Test running application for vulnerabilities
- Tools: OWASP ZAP, Burp Suite, Acunetix
- Typical checks: SQL injection, XSS, CSRF, insecure deserialization

### Dependency Scanning
- Check transitive dependencies for known vulnerabilities
- Tools: Snyk, Dependabot, WhiteSource
- Update cadence: Weekly scan, patch high/critical within 24-48h

### Fuzzing
- Feed random/malformed input to find edge cases
- Tools: libFuzzer (C++), AFL (C), go-fuzz (Go), AFL.rs (Rust)
- Good for parsers, codecs, protocol handlers

---

## Test Execution in CI/CD

### Parallelization Strategy
```
# Good: Run tests in parallel by type
- Unit tests (4 workers, ~2 min)
- Integration tests (2 workers, ~5 min)
- E2E tests (1 worker, ~10 min)

# Better: Distribute by feature/service
- Service-A unit + integration (parallel)
- Service-B unit + integration (parallel)
- E2E (depends on all services)
```

### Failure Handling
- **Unit/Integration:** Fail build immediately on failure
- **E2E:** Fail after collecting all results (provide full report)
- **Flaky tests:** Mark as "retry 2x"; if still flaky, investigate root cause (don't ignore)

### Coverage Reporting
```yaml
# Example GitHub Actions
- name: Test Coverage
  run: npm run test:coverage
  
- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/coverage-final.json
```

---

## Test Organization & Naming

### Directory Structure
```
src/
  components/
    Button.tsx
    Button.test.tsx              # Co-located with source
  services/
    auth.ts
    auth.test.ts
tests/
  fixtures/                       # Shared test data
    users.json
    products.json
  integration/                    # Integration tests
    api.test.ts
    database.test.ts
  e2e/                           # End-to-end tests
    login.spec.ts
    checkout.spec.ts
```

### Test File Naming
```
✅ Component.test.ts
✅ Component.spec.ts
✅ Component.test.tsx
❌ tests.ts (too generic)
❌ Component-test.ts (inconsistent)
```

---

## Common Anti-Patterns (Avoid)

### 🚫 Testing Implementation Details
```javascript
// ❌ BAD: Tests internal implementation
test('increment state', () => {
  const [count, setCount] = useState(0);
  setCount(1);
  expect(count).toBe(1);  // Testing React hook internals, fragile
});

// ✅ GOOD: Test user-visible behavior
test('button increments counter when clicked', async () => {
  render(<Counter />);
  await userEvent.click(screen.getByRole('button', { name: /increment/i }));
  expect(screen.getByText('1')).toBeInTheDocument();
});
```

### 🚫 Slow/Flaky Unit Tests
```javascript
// ❌ BAD: Unit test using real HTTP, causing flakiness
test('api call succeeds', async () => {
  const result = await fetch('https://api.example.com/data');
  expect(result.ok).toBe(true);  // Flaky: depends on network
});

// ✅ GOOD: Mock HTTP, fast and reliable
test('api call succeeds', async () => {
  fetchMock.get('*', { status: 200, body: { data: 'test' } });
  const result = await fetch('https://api.example.com/data');
  expect(result.ok).toBe(true);  // Reliable: mocked
});
```

### 🚫 Excessive Mocking
```javascript
// ❌ BAD: Mocking too much, testing nothing real
test('user login', () => {
  const mockDB = jest.fn();
  const mockAuth = jest.fn();
  const mockAPI = jest.fn();
  // Test is now testing mocks, not actual login logic
});

// ✅ GOOD: Test real login logic, mock only external dependencies
test('user login', () => {
  const mockDB = { users: [{ email: 'test@example.com', password: 'hashed' }] };
  // Test real validation + password checking, mock only DB call
});
```

---

## Quick Checklist

- ✅ Unit tests cover critical business logic (70%+ fast tests)
- ✅ Integration tests cover workflows and service boundaries
- ✅ E2E tests cover critical user journeys (minimal, <5% of suite)
- ✅ Tests are independent (no ordering, no shared state)
- ✅ Tests are deterministic (no flakiness, no timing issues)
- ✅ Coverage is >80% on critical paths, >70% overall
- ✅ CI runs all tests in <10 min (parallelize aggressively)
- ✅ Failures fail the build (no ignored/skipped tests in main)
- ✅ Test data is isolated (cleanup after each test)
- ✅ Performance expectations are documented (SLA per endpoint)

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** `.github/specialist-guides/code-quality.md` (Code review), `.github/specialist-guides/error-handling.md` (Error paths)
