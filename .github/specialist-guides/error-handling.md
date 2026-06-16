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
