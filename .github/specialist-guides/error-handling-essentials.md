---
title: "Error Handling Essentials (Quick Reference)"
description: "Minimal guidance for classifying and handling errors — use this when time is limited"
version: "1.0"
parent: "error-handling.md"
---

## Error Classification Decision Tree

**Q: Can the operation be retried?**

- **YES** → Transient error (network timeout, rate limit, database lock)
  - **Action:** Retry with exponential backoff (1s, 2s, 4s, 8s, stop)
  - **Example:** API call returns 503 Service Unavailable
  
- **NO** → Permanent or ambiguous error
  - **Is it a user input problem?** (validation, auth, permission)
    - **YES** → Permanent, inform user, don't retry
    - **NO** → Ambiguous (usually a bug), log + escalate

---

## Quick Patterns

### Transient Errors: Retry with Backoff
```javascript
async function callAPIWithRetry(url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetch(url);
    } catch (err) {
      if (isTransient(err) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
      } else throw err;
    }
  }
}
```

### Permanent Errors: Fail Fast
- Input validation → Return error immediately to user
- Authorization failure (401, 403) → Don't retry, inform user
- Resource not found (404) → Don't retry unless polling

### Ambiguous Errors: Log & Monitor
- Unexpected response structure → Log full error + context, escalate to on-call
- Timeout (no retry succeeded) → Log, set alert, page on-call engineer

---

## Three Log Statements You Need

```
1. Transient (will retry):
   logger.warn("api_timeout", { url, attempt: 2, nextRetryMs: 4000 })

2. Permanent (user-facing):
   logger.error("auth_failed", { userId, reason: "invalid_password" })

3. Ambiguous (investigate):
   logger.error("unexpected_response", { url, status: 200, body: {...}, stackTrace })
```

---

**Use Full Guide For:** Circuit breakers, cascading failures, domain-specific patterns (API/DB/file I/O)  
**Full Guide:** `.github/specialist-guides/error-handling.md`
