---
title: "Error Decision Tree"
description: "200-token decision guide: transient vs. permanent vs. ambiguous errors"
version: "1.0"
---

## Single Decision: Is This Error Transient?

```
Does the operation make sense to retry?
│
├─ YES → TRANSIENT ERROR
│   └─ Retry with exponential backoff (1s, 2s, 4s, 8s)
│       ├─ Network timeout
│       ├─ Rate limit (429)
│       ├─ Temporary lock (DB busy)
│       └─ Load balancer timeout
│
└─ NO → Is it a user problem?
    │
    ├─ YES → PERMANENT, FAIL FAST
    │   ├─ Invalid input (bad email format)
    │   ├─ Auth failure (wrong password, no permission)
    │   ├─ Not found (404 resource doesn't exist)
    │   └─ Action: Return error message to user, log, move on
    │
    └─ MAYBE → AMBIGUOUS, LOG & ESCALATE
        ├─ Unexpected response structure
        ├─ Timeout after all retries exhausted
        ├─ Resource limit exceeded (disk full, memory)
        └─ Action: Log full error + context, set alert, page on-call
```

---

## One-Liner Rule

**Can you successfully retry it later?** → Transient (retry).  
**Is it a user's fault?** → Permanent (fail fast).  
**Neither?** → Ambiguous (log + alert).

---

✅ **Use this card when:** Deciding how to handle an error in code  
📖 **Use full guide when:** Understanding circuit breakers or domain-specific error handling  
📍 **Location:** `.github/quick-refs/error-decision-tree.md`
