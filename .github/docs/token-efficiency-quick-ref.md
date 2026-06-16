# 🚀 Token Efficiency Quick Reference

**Biggest Lever:** Session boundaries (15–20 turns) = 40–60% cost reduction  
**Updated:** June 16, 2026

---

## 1️⃣ Session Management: The $$ Difference

| Problem | Solution | Savings |
|---------|----------|---------|
| Sessions >15 turns with more work | Split into fresh sessions | 40–60% |
| Gradual file exploration over 20 turns | Front-load all context upfront | 80% |
| Trial-and-error debugging loops | Diagnose upfront, implement once | 85% |
| Using Opus for everything | Route by task type (Haiku/Flash for 60% of work) | 55% |

---

## 2️⃣ Before Every Task: Cost-First Checklist

- [ ] **Task complexity?** → S/M/L → *Decompose XL into multiple sessions*
- [ ] **Can it fit in 15–20 turns?** → YES: single session | NO: split phases
- [ ] **What context do I need upfront?** → Collect logs/configs/files → paste in opening message
- [ ] **What's the model routed to?** → Haiku (debug) | Sonnet (code) | Opus (design) | Flash (research)
- [ ] **Is this a diagnosis task?** → Collect all input upfront → ask for ranked hypotheses in 1 turn

---

## 3️⃣ Session Boundaries: When to Reset

**Open new session when:**
- ✅ Switching major phases (design → implement → test → deploy)
- ✅ Turn count approaches 15–20 and work remains
- ✅ Switching from exploration to implementation
- ✅ Topic shifts significantly (auth → caching → monitoring)

**How to reset:**
```bash
/clear              # CLI: clear session
# OR open new tab with summary pasted
```

**Cost saved:** 40M–80M tokens per reset

---

## 4️⃣ Task Decomposition Pattern

**Bad (1 session, 40 turns, 600M tokens):**
```
diagnose → implement → test → deploy [all in one session]
```

**Good (4 sessions, 8–12 turns each, 100M total):**
```
Session 1 [Design]       → deliverable: plan + diagram
Session 2 [Implement]    → deliverable: code + unit tests
Session 3 [Test]         → deliverable: integration tests + fixes
Session 4 [Verify]       → deliverable: production-ready + runbook
```

**Example:** See `.github/docs/task-decomposition-cookbook.md`

---

## 5️⃣ Front-Load Context: Never Explore Gradually

**BAD:**
```
User: "Why is auth failing?"
Agent: "Let me check src/auth.py..."
[Turn 2] Reads file → questions
[Turn 20] Finally diagnoses
Cost: 20 × exploration = 300K tokens
```

**GOOD:**
```
User: "Why is auth failing?
[hcr: src/auth.py src/api_handlers.py:40-120 error.log config.yml]"
Agent: [Immediate diagnosis, no exploration needed]
Cost: 1 turn + 2 follow-ups = 50K tokens
```

**Savings:** 6× cheaper

---

## 6️⃣ Model Routing: Don't Use Opus for Everything

| Task | Model | Cost |
|------|-------|------|
| "Is this YAML syntax right?" | Haiku | 🟢 |
| "Implement JWT auth" | Sonnet | 🟡 |
| "Design distributed cache" | Opus | 🔴 |
| "Find React best practices" | Gemini Flash | 🟢 |

**See:** `.github/docs/model-routing-guide.md`

---

## 7️⃣ Diagnostic-First Debugging

**BAD:** Trial-and-error loop (30 turns, try X then Y then Z)
**GOOD:** Collect all context → ask for diagnosis → implement top hypothesis

**Template:**
```
Turn 1: Dump [logs, metrics, configs, changes]
        Ask: "Ranked hypotheses with evidence?"
        
Turn 2: Top hypothesis confirmed
        Implement fix
        
Turn 3: Verify in production
```

**Cost:** 3 turns vs 30 turns = 90% savings

---

## 8️⃣ Session Handoff: Avoid Re-Exploration

When a session nears its end with work remaining, create a summary:

```markdown
## Session Summary: [Task] — [Date]

### ✅ What Was Done
- [Outcome 1]
- [Outcome 2]

### ⬜ What's Left
- [Next phase — specific]

### 🚀 How to Resume
1. [Exact starting action]
2. [Key files to know]
3. [Context (git branch, env vars)]
```

**Next session:** Paste summary as opening message
**Cost saved:** Avoids re-reading 10 files over 10 turns

---

## 📚 Reference Docs

| Doc | Purpose |
|-----|---------|
| `.github/agents/autonomous-fleet-agent.md` § 10 | Full session economics rules |
| `.github/docs/session-summary-template.md` | Copy-paste template for session handoffs |
| `.github/docs/model-routing-guide.md` | Detailed model selection logic |
| `.github/docs/task-decomposition-cookbook.md` | Real examples: K8s deployment, debugging, features |

---

## 🎯 Quick Win Examples

### Example 1: Debugging (Was 181M tokens)
**Before:** "Troubleshoot error" (30 turns of trial-and-error)
**After:** 
- Session 1: Collect logs → diagnose (2 turns, Haiku)
- Session 2: Implement fix (3 turns, Sonnet)
- Session 3: Verify (2 turns, Haiku)
**Total:** 7 turns, ~50M tokens (72% savings)

### Example 2: Feature (Was 300M tokens)
**Before:** Single 40-turn session
**After:**
- Session 1: Design (6 turns, Sonnet)
- Session 2: Backend (10 turns, Sonnet)
- Session 3: Frontend (10 turns, Sonnet)
- Session 4: Integration (5 turns, Haiku)
**Total:** 31 turns across 4 sessions, ~100M tokens (67% savings)

### Example 3: Infrastructure (Was 379M tokens)
**Before:** "Deploy Fleet" (37 turns)
**After:**
- Session 1: Architecture (6 turns, Sonnet)
- Session 2: K8s setup (8 turns, Sonnet)
- Session 3: Services (8 turns, Sonnet)
- Session 4: Monitoring (6 turns, Haiku)
**Total:** 28 turns across 4 sessions, ~100M tokens (74% savings)

---

## ⚡ The 3-Step Decision Framework

**When a task arrives:**

1. **Estimate size:** S (solo, <3min) | M (8–12 turns) | L (multi-session) | XL (reject, decompose)
2. **Model route:** Haiku (debug) | Sonnet (code) | Opus (design) | Flash (research)
3. **Context prep:** Gather logs/files/configs → include in opening message
4. **Decompose?** If M/L and can split phases → separate sessions; else single session

**Cost expected:** S: 10K | M: 100K | L per phase: 100K | (Avoid XL)

---

**Version:** 1.0  
**Effective:** June 16, 2026  
**Expected Savings:** 40–74% of token spend with consistent application
