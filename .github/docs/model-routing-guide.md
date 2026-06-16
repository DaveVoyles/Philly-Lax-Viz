# Model Routing Guide: Optimize Cost & Quality

Use this guide to route tasks to the appropriate model. Correct routing cuts token spend by **40–55%** while maintaining solution quality.

---

## Quick Reference Table

| Task Category | Primary Model | Fallback | Speed | Cost | Best Use | Avoid |
|---|---|---|---|---|---|---|
| **Debugging & Troubleshooting** | Claude Haiku 4.5 | Gemini Flash | ⚡⚡⚡ | 🟢 Ultra-low | Config validation, error analysis, log parsing | Architecture design |
| **Code Implementation** | Claude Sonnet 4.6 | Claude Opus | ⚡⚡ | 🟡 Moderate | Writing features, refactoring, unit tests | Complex multi-module logic |
| **Complex Reasoning** | Claude Opus 4.8 | Sonnet (with retry) | ⚡ | 🔴 High | Multi-file architecture, trade-off analysis | Simple tasks |
| **Web Research** | Gemini Flash | Sonnet | ⚡⚡⚡ | 🟢 Ultra-low | Package docs, best practices, API lookups | Code implementation |
| **Code Review** | Claude Sonnet 4.6 | Opus | ⚡⚡ | 🟡 Moderate | Diff auditing, security checks, style | Detailed architecture |
| **Documentation** | Claude Haiku 4.5 | Gemini Flash | ⚡⚡⚡ | 🟢 Ultra-low | Writing READMEs, guides, comments | Code design decisions |

---

## Detailed Routing Rules

### 1. Claude Haiku 4.5 — Ultra-Cheap, Excellent for Pattern Matching
**Cost:** ~96% cheaper than Opus
**Ideal for:** Config validation, error interpretation, log parsing, syntax checks, simple refactors

#### When to Use Haiku
✅ "Is this YAML syntax correct?"  
✅ "What does this error message mean?"  
✅ "Parse this log and find the timestamp of failure"  
✅ "Does this function signature match the interface?"  
✅ "Reformat this JSON to pretty-print"  
✅ "Extract all database connection strings from this config"

#### When NOT to Use Haiku
❌ "Design a caching layer for 10M users"  
❌ "Should we use PostgreSQL or MongoDB for this schema?"  
❌ "Trace the call flow across 5 services"

---

### 2. Claude Sonnet 4.6 — Best Reasoning-to-Cost Ratio
**Cost:** ~10× cheaper than Opus
**Ideal for:** Code implementation, unit test writing, focused refactoring, detailed explanations

#### When to Use Sonnet
✅ "Implement JWT authentication in Express"  
✅ "Write comprehensive unit tests for this module"  
✅ "Refactor this function to use async/await"  
✅ "Explain how this library's plugin system works"  
✅ "Write API documentation for this endpoint"

#### When NOT to Use Sonnet
❌ "Design the overall microservices architecture"  
❌ "Analyze trade-offs between 4+ different approaches"  
❌ "Identify complex interactions across 10+ modules"

---

### 3. Claude Opus 4.8 — Advanced Reasoning (Use Sparingly)
**Cost:** Baseline (1×)
**Ideal for:** Architectural decisions, complex trade-off analysis, novel problem-solving

#### When to Use Opus
✅ "Design a distributed cache for 100M requests/day"  
✅ "We have 5 approaches to sharding. Which is best and why?"  
✅ "Analyze the system complexity of migrating from monolith to microservices"  
✅ "Identify architectural debt and propose a refactor roadmap"

#### When NOT to Use Opus
❌ "Fix this syntax error"  
❌ "Write a simple CRUD endpoint"  
❌ Any task that Sonnet can handle equally well

---

### 4. Gemini Flash — Speed & Retrieval (Web Research)
**Cost:** ~98% cheaper than Opus
**Ideal for:** Package documentation, best practices, API specs, web search, citations

#### When to Use Gemini Flash
✅ "Find the latest Next.js best practices for SSR"  
✅ "What's the current state of Rust async/await?"  
✅ "Compare SQLAlchemy vs SQLModel for ORM"  
✅ "Give me the TypeScript 5.1 release notes"

#### When NOT to Use Gemini Flash
❌ "Implement this feature using best practices"  
❌ "Analyze this code and suggest improvements"  
❌ Tasks requiring deep contextual reasoning

---

## Routing Decision Tree

```
START: New task arrives
│
├─ Is it debugging or troubleshooting?
│  └─ YES → Use Haiku
│           (error messages, config validation, log parsing)
│
├─ Is it code implementation (write/modify)?
│  └─ YES → Use Sonnet
│           (features, refactors, tests, docs)
│
├─ Is it web research or package lookup?
│  └─ YES → Use Gemini Flash
│           (best practices, documentation, specs)
│
├─ Does it require architectural reasoning?
│  └─ YES → Use Opus
│           (complex design, multiple trade-offs)
│
└─ Otherwise → Use Sonnet (safe default for anything not above)
```

---

## Cost Savings Example

**Scenario:** Typical week of development tasks

| Task | Default (Opus) | Routed (Smart) | Savings |
|---|---|---|---|
| 5× debugging tasks | 500K tokens | 50K tokens (Haiku) | 90% |
| 10× code implementations | 2M tokens | 200K tokens (Sonnet) | 90% |
| 3× architecture designs | 600K tokens | 600K tokens (Opus) | 0% |
| 5× web research | 200K tokens | 10K tokens (Flash) | 95% |
| **Week Total** | **3.3M tokens** | **860K tokens** | **74% savings** |

---

## Model Failover & Retry Rules

### If Haiku is insufficient:
→ Retry with **Claude Sonnet** (don't jump to Opus)

### If Sonnet is insufficient:
→ Retry with **Claude Opus** with explicit constraint: `"This is complex. Here's all context upfront: [files, context]."`

### If Gemini Flash fails on web research:
→ Use **Claude Sonnet** with the research agent (`task` tool, `agent_type: research`)

### If Opus is overkill (over-solving):
→ Decompose the problem into smaller Sonnet tasks

---

## Implementation Checklist

When launching a task:

- [ ] Identified task category (debug / implement / research / design)
- [ ] Assigned primary model based on routing rules
- [ ] If task is >10 min effort, is it decomposable into cheaper sub-tasks?
- [ ] Will Haiku/Flash genuinely work, or am I upgrading unnecessarily?
- [ ] Prepared upfront context (files, logs, configs) to reduce exploration

---

## Anti-Patterns to Avoid

| ❌ Anti-Pattern | ✅ Better Practice |
|---|---|
| Using Opus for all tasks | Route by complexity; default to Sonnet |
| Switching models mid-task | Pick upfront; commit for the task duration |
| Using Haiku for code design | Use Sonnet; Haiku is for validation only |
| Sending partial context to a cheaper model | Front-load all context; cheaper models work better with complete input |
| Retry-loop between models | Diagnose first; if you need Opus, ask it upfront with full context |

---

**Version:** 1.0  
**Last Updated:** June 16, 2026
