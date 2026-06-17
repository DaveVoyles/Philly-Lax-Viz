# Is This a Performance Problem?

Quick decision tree for performance issues.

## Diagnosis Flowchart

```
┌─ Is it actually slow? (Measure, don't guess)
│  ├─ Have I profiled this? 
│  │  ├─ NO → PROFILE FIRST (use Chrome DevTools, Node perf, etc.)
│  │  └─ YES → Next question ↓
│  └─ NO → STOP (not a problem, skip optimization)
│
├─ What's the bottleneck?
│  ├─ LATENCY >10s? → Check network/API calls
│  ├─ LATENCY 1-10s? → Check computation/loops
│  ├─ LATENCY <1s? → Acceptable (unless user-critical)
│  └─ MEMORY >500MB? → Check memory leaks
│
├─ Is this affecting USERS RIGHT NOW?
│  ├─ YES → FIX (high priority)
│  └─ NO → Is it in critical path?
│          ├─ YES → FIX (prevents future problems)
│          └─ NO → DEFER (focus on features)
│
└─ Can I fix it in <2 hours?
   ├─ YES → FIX NOW
   └─ NO → File tech debt issue, prioritize later
```

## Latency Thresholds

| Metric | Red (Too Slow) | Yellow (OK) | Green (Good) |
|--------|----------------|-----------|----------|
| **Page load** | >5s | 1-5s | <1s |
| **API response** | >2s | 200-2000ms | <200ms |
| **Database query** | >500ms | 50-500ms | <50ms |
| **React render** | >100ms | 16-100ms | <16ms |
| **Memory usage** | >1GB | 500MB-1GB | <500MB |

## Quick Checks (Before Optimization)

```bash
# Is it actually slow or slow to my eyes?
time curl https://api.example.com/endpoint
# ↓
# Is it a network issue?
curl -w "@curl-timing-format.txt" https://api.example.com/endpoint
# ↓
# Is it a database issue?
EXPLAIN ANALYZE SELECT * FROM table WHERE condition;
# ↓
# Is it a code issue?
node --prof app.js && node --prof-process isolate-*.log > output.txt
```

## Common Quick Fixes

| Problem | Fix | Effort |
|---------|-----|--------|
| N+1 queries | Batch queries / JOIN | Low |
| Large payloads | Pagination / compression | Low |
| Unindexed DB | Add index | Low |
| Memory leak | Check circular refs | Medium |
| Slow algorithm | O(n) vs O(n²) analysis | Medium |
| Cache miss | Add caching layer | Medium |

## When NOT to Optimize

- ❌ Before profiling (you're guessing)
- ❌ Premature optimization (99% of code is unused)
- ❌ User doesn't notice it
- ❌ In critical section <1 week before release
- ❌ At expense of readability (unreadable fast code is dead code)

---

**Decision:** Fix if latency threshold exceeded AND affecting users OR in critical path.
