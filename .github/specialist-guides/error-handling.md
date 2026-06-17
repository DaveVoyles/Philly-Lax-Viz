---
title: "Error Handling & Observability Guide"
description: "Error classification, recovery patterns, logging, and observability instrumentation"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## Error Classification & Recovery

### Transient (Retryable)
Network timeouts, rate limits (429), transient service failures.
- **Action:** Retry with exponential backoff (2s, 4s, 8s delays)
- **Example:** `429 Too Many Requests` → wait and retry
- **Max Retries:** 3 attempts before escalating
- **Backoff:** 2^(attempt) seconds, max 8 seconds

### Permanent (Non-Retryable)
Invalid auth, resource not found (404), malformed input, schema violations.
- **Action:** Fail immediately with context, escalate to user
- **Example:** `Repository not found` → switch GitHub accounts or ask user to verify access
- **Reporting:** Provide error, why it failed, what to check, recovery path

### Ambiguous (User-Decision Required)
Constraint violation, missing permission, incomplete spec, architectural choice.
- **Action:** Pause work, ask user for clarification/permission
- **Format:** Use `ask_user` tool with clear options
- **Example:** "Cannot proceed without confirmation. This will delete the branch. Proceed? [yes/no]"

### Retry Strategy
```
IF transient error:
  FOR attempt in 1..3:
    delay = 2^attempt seconds
    TRY operation
    IF success: return
  escalate as permanent failure
```

---

## Cascading Failures & Circuit Breaker

### Cascading Failure (Avoid)
```
Service A calls Service B (slow)
  → A waits for response (thread blocked)
  → B is overwhelmed (many threads waiting)
  → A exhausts thread pool
  → A becomes unavailable
  → C (depends on A) also fails
  
Result: System-wide outage from single service slowness
```

### Circuit Breaker Pattern (Prevention)
```
Normal:      A → [✅ Circuit CLOSED] → B
             Requests flow normally

B Fails:     A detects failure rate >50%
             [⚠️ Circuit OPEN] ← reject requests
             Wait 30s

Recovery:    [🔄 Circuit HALF-OPEN] ← test with one request
             B healthy? → [✅ Circuit CLOSED]
             B still failing? → [⚠️ Circuit OPEN]
```

**Implementation:**
```python
from pybreaker import CircuitBreaker

breaker = CircuitBreaker(
  fail_max=5,                    # Open after 5 failures
  reset_timeout=60,              # Try again after 60s
  exclude_exceptions=[ValueError] # Don't count validation errors
)

@breaker
def call_external_service():
  return requests.get('https://api.example.com/data')
```

### Bulkheads (Thread Pool Isolation)
```
Thread Pool A (Service A calls):  |####|  ← Max 10 threads
Thread Pool B (Service B calls):  |##|   ← Max 5 threads
Thread Pool C (Service C calls):  |#|    ← Max 2 threads

If B fails, only Pool B exhausted; A and C continue
```

---

## Domain-Specific Error Handling

### Database Errors

**Connection Failures:**
```python
try:
  connection = connect(host, port, timeout=5)
except TimeoutError:  # Transient
  retry_with_backoff()
except PermissionError:  # Permanent
  log_error("Check credentials and network ACL")
  fail_immediately()
```

**Query Errors:**
```python
try:
  result = execute("SELECT * FROM users WHERE id = ?", (user_id,))
except IntegrityError:  # Permanent (constraint violation)
  log_error(f"Data integrity issue: {e}")
  return error_response(400, "Invalid data")
except OperationalError:  # Transient (connection lost)
  retry_with_backoff()
```

**Deadlocks:**
```python
def transact_with_retry():
  for attempt in range(3):
    try:
      with transaction():
        # Update A, then B
      break
    except DeadlockError:
      if attempt < 2:
        time.sleep(0.1 * (2 ** attempt))
        continue
      raise
```

### API Errors

**Rate Limiting:**
```python
response = requests.get(url)
if response.status_code == 429:  # Transient
  wait_time = int(response.headers.get('Retry-After', 60))
  time.sleep(wait_time)
  retry()
```

**Auth Errors:**
```python
response = requests.get(url, headers={'Authorization': f'Bearer {token}'})
if response.status_code == 401:  # Permanent (token expired)
  refresh_token()
  retry()
elif response.status_code == 403:  # Permanent (no permission)
  log_error("Insufficient permissions")
  fail_immediately()
```

### File I/O Errors

**Path Not Found:**
```python
try:
  with open(path) as f:
    content = f.read()
except FileNotFoundError:  # Permanent
  log_error(f"File not found: {path}")
  return default_content()
```

**File Too Large:**
```python
MAX_FILE_SIZE = 20_000_000  # 20MB

if os.path.getsize(path) > MAX_FILE_SIZE:  # Permanent
  log_error(f"File exceeds {MAX_FILE_SIZE} bytes")
  return error_response(413, "File too large")
```

---

## Graceful Degradation & Fallbacks

### Fallback Strategies
```
Primary service unavailable?
  → Try fallback 1 (cache)
  → Try fallback 2 (secondary service)
  → Try fallback 3 (hardcoded defaults)
  → Fail with degraded functionality
```

**Example:**
```python
def get_user_data(user_id):
  try:
    # Try primary service
    return api.get_user(user_id)
  except ServiceUnavailable:
    try:
      # Try cache
      return cache.get(f'user:{user_id}')
    except CacheMiss:
      # Return degraded response
      return {'id': user_id, 'name': 'Unknown'}
```

### What to Degrade
- ✅ **Non-critical features:** Recommendations, analytics, nice-to-haves
- ✅ **Personalization:** Use defaults instead of user preferences
- ❌ **Core functionality:** Auth, payments, data integrity
- ❌ **Security:** Never degrade security for performance

---

## Logging & Instrumentation

### Structured Logging Pattern
- **Level:** INFO (normal flow), WARN (concerning but recoverable), ERROR (failed), DEBUG (detailed trace)
- **Content:** timestamp, level, component, message, context
- **Format:** Structured key=value for parseability

### When to Log
**Log These:**
- ✅ External API calls (request, response, latency, status)
- ✅ Significant decisions (branch choice, tool selection, approach change)
- ✅ Validation failures (what failed, why)
- ✅ Performance milestones (file processed, batch completed)

**Don't Log These:**
- ❌ Verbose trivia (every variable, redundant checks)
- ❌ Credentials, secrets, or sensitive user data
- ❌ Implementation details of intermediate steps

### Example Logs
```
INFO | git-push | pushed commit abc123 | branch=main | files=3 | latency=2.3s
WARN | api-call | rate limit approaching | remaining=10 | reset_at=2026-06-16T16:45:00Z
ERROR | file-read | failed to read large.yaml | size=25KB | reason=exceeds_20kb_guard
```

---

## Observability & Monitoring

### Instrumentation During Development
- Log critical paths (API calls, decisions, performance)
- Track metrics: success/failure rates, latencies, resource usage
- Monitor error categories: transient vs. permanent vs. ambiguous

### What NOT to Instrument
- ❌ Every function call (too noisy)
- ❌ Sensitive data (credentials, tokens, private info)
- ❌ Implementation details that don't affect correctness

### Monitoring Checks After Changes
- 📊 Error rates: stable or improved?
- ⏱️ Performance: stable or improved?
- 📝 Logs: sufficient context for debugging?

---

## Failure Reporting Format

### Standard Format
```
🐛 Error: [category] | [what failed] | [why] | [recovery action]
```

### Examples
```
🐛 Error: Transient | git push timed out | network issue | Retrying (attempt 2/3)
🐛 Error: Permanent | auth failed | invalid token | Check gh auth status
🐛 Error: Ambiguous | constraint violated | need explicit permission | Asking user...
```

### Severity Levels

**INFO** — Routine progress
- Format: `✅ Created branch feature/X`

**WARN** — Concerning but recoverable
- Format: `⚠️ Rate limit approaching (10 remaining); waiting 5s before next call`
- Include: What's wrong, why it matters, what I'm doing

**ERROR** — Action failed; user action may be needed
- Format: `🐛 Error: Failed to push (auth required). Check 'gh auth status'.`
- Include: What failed, why, what to check, recovery path

**CRITICAL** — High-risk situation requiring user decision
- Format: `🔑 CRITICAL: Cannot proceed without confirmation. [Description]. Proceed? [yes/no]`
- Include: Risk, impact, confirmation requirement

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** Primary instructions section 1, 4, 5
