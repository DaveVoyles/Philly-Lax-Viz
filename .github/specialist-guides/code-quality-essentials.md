---
title: "Code Quality Essentials (Quick Reference)"
description: "Minimal guidance for code review and quality gates — use when doing quick reviews"
version: "1.0"
parent: "code-quality.md"
---

## 5-Minute Code Review Checklist

### ✅ Correctness (Read the code, trace logic)
- [ ] Variable names are clear (no `x`, `tmp`, `data`)
- [ ] Loop boundaries correct (off-by-one errors?)
- [ ] Null/undefined checks before access
- [ ] Array/string bounds checked before indexing
- [ ] No unreachable code or dead branches

### ✅ Performance (Look for obvious waste)
- [ ] No N+1 queries (loop inside loop, query in loop)
- [ ] No unnecessary allocations (creating objects in tight loops)
- [ ] Caching used where reads >> writes
- [ ] No exponential algorithms on large inputs

### ✅ Security (Check for vulnerabilities)
- [ ] No hardcoded secrets/passwords
- [ ] User input validated before use
- [ ] SQL queries use parameterized queries (not string concat)
- [ ] Auth/permission checked before sensitive operations
- [ ] Errors don't leak sensitive info to user

### ✅ Testability (Is this code easy to test?)
- [ ] Dependencies injected (not hardcoded)
- [ ] Functions do one thing (single responsibility)
- [ ] Complex logic extracted into testable functions
- [ ] Mocks/stubs possible for external dependencies

### ✅ Edge Cases (What could break?)
- [ ] Empty inputs handled (empty array, null, empty string)
- [ ] Boundary conditions tested (0, -1, max int, empty collection)
- [ ] Concurrency issues if relevant (race conditions, deadlocks)
- [ ] Resource cleanup guaranteed (file close, connection release)

---

## Red Flags (Ask for changes if you see these)

🚩 **Cognitive Complexity > 10** (if/else/switch/loop nesting too deep) → Ask for extraction  
🚩 **Function > 50 lines** → Likely doing too much, ask for split  
🚩 **3+ levels of nesting** → Extract inner code to helper function  
🚩 **Magic numbers** → Ask "why is it 1000? why is it hardcoded?" → Use constant  
🚩 **Comments explaining what, not why** → Code should be self-documenting  

---

## Standard Responses

**Too complex:** "Can we extract this into a helper function? The nested logic is hard to follow."  
**Missing test:** "Can we add a test for the error case (when X fails)?"  
**Performance concern:** "This loops over all items for each item (N²). Can we use a Set or Map?"  
**Security:** "This concatenates user input into the query. Use parameterized queries instead."

---

**Use Full Guide For:** Refactoring patterns, tech debt scoring, design patterns, anti-pattern fixes  
**Full Guide:** `.github/specialist-guides/code-quality.md`
