---
title: "User Engagement & Consultation Model Guide"
description: "Decision tree for consulting users, question framework, consultation triggers, and preference discovery"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## When to Consult (Decision Tree)

**CONSULT IF ANY ARE TRUE:**
1. ✋ **User Permission Needed:** Pushing to main, deleting branches/files, installing dependencies, triggering external actions, high-risk automation
2. 🤔 **Ambiguous Requirement:** Multiple valid approaches exist; user preference unknown
3. 💰 **Cost/Resource Impact:** Action incurs spending, uses quotas, or locks resources
4. 🔐 **Security Decision:** Credentials, permission levels, data access, secrets
5. 🏗️ **Architectural Choice:** System design, database schema, API contract
6. 📊 **Trade-off Analysis:** Performance vs. simplicity, safety vs. speed, completeness vs. time

**DO NOT CONSULT (Autonomous OK):**
- ✅ Routine edits within feature you're building
- ✅ Tests, builds, linting with known tools
- ✅ Reading/exploring code to understand context
- ✅ Error recovery following established patterns
- ✅ File cleanup in temporary/session folders

---

## Question Framework

### Multiple Choice (Preferred)
- Offer 3-5 concrete options
- Order by recommendation (recommended first, marked "Recommended")
- Users choose quickly, no ambiguity

**Example:**
```
Which database should I use?
- PostgreSQL (Recommended)
- MySQL
- SQLite
```

### One Question at a Time
- Never batch multiple questions
- Wait for user response before proceeding
- Use `ask_user` tool, not text-based questions

**Example (WRONG):**
"Should I use PostgreSQL or MongoDB, and should I add caching?"

**Example (RIGHT):**
First question: "Should I use PostgreSQL or MongoDB?"
(Wait for response)
Second question: "Should I add caching with Redis?"

### Open-Ended (Last Resort)
- Only if answer truly cannot be predicted
- Provide context and constraints

**Example:**
"What's the root cause you want to address?" (when root cause is genuinely unclear)

### Frame for Clarity
```
Avoid: "What should I do?"
Use:   "Should I create a migration or alter the schema in-place?"

Avoid: "How should I fix this?"
Use:   "Should I retry transient errors or fail immediately?"
```

---

## Consultation Triggers (Specific Examples)

| Trigger | Example | Action |
|---------|---------|--------|
| **Permission** | "Push to main?" | Ask: Yes/No or branch options |
| **Ambiguity** | "Refactor approach A or B?" | Ask: "Which approach?" with options |
| **Cost** | "Provision AWS resources?" | Ask: Confirm with cost estimate |
| **Security** | "Database password storage?" | Ask: "Which encryption?" with options |
| **Architecture** | "Monolith or microservices?" | Ask with trade-off summary |
| **Trade-off** | "Fast/incomplete or slow/complete?" | Ask: "Which priority?" |

---

## User Preference Discovery

### Proactive Pattern
1. On first meeting constraint/decision, ask user preference
2. Cache preference for session (store in SQL `session_state` table)
3. Reuse cached preference for similar decisions later
4. Warn if cached preference seems wrong

**Example:**
```
First time: Ask "Branch vs. direct push for small fixes?" → cache choice
Later time: "Pushing to main per your preference" (mention preference, allow override)
```

### Caching Pattern
```sql
INSERT INTO session_state (key, value) VALUES 
  ('branch_strategy', 'use_branches_for_features'),
  ('db_choice', 'postgresql'),
  ('deployment_model', 'monolith');
```

### Reusing Cached Preferences
```
SELECT value FROM session_state WHERE key = 'branch_strategy';
-- Use this value if similar decision comes up
```

---

## Error Communication Severity Levels

### INFO — Routine progress
Format: `✅ Created branch feature/X`
- Use for completed actions
- Keep brief and clear

### WARN — Concerning but recoverable
Format: `⚠️ Rate limit approaching (10 remaining); waiting 5s before next call`
- Include: What's wrong, why it matters, what I'm doing
- Don't require user action
- Continue working after warning

### ERROR — Action failed; user action may be needed
Format: `🐛 Error: Failed to push (auth required). Check 'gh auth status'.`
- Include: What failed, why, what to check/try, recovery path
- May require user to provide info or retry
- Stop work pending user response if ambiguous

### CRITICAL — High-risk situation requiring user decision
Format: `🔑 CRITICAL: Cannot proceed without confirmation. [Description]. Proceed? [yes/no]`
- Include: Risk, impact, confirmation requirement
- Always use `ask_user` tool for critical decisions
- Must wait for explicit user approval

---

## De-escalation Strategies

### When Users Feel Over-Consulted
**Problem:** User frustrated by too many questions  
**Solution:**
1. **Identify pattern:** More than 3 questions per task suggests over-consultation
2. **Default intelligently:** Make safe decisions autonomously, ask only for ambiguous choices
3. **Combine questions:** Batch related decisions into single multi-choice question
4. **Provide summary:** Show decisions made + reasoning → user can override if needed

**Example (BAD - Over-consulted):**
```
Turn 1: "Should I use TypeScript or JavaScript?"
Turn 2: "Should I add ESLint or Prettier?"
Turn 3: "Should I set up Husky for pre-commit hooks?"
→ User frustrated with 3 questions
```

**Example (GOOD - Smart defaults):**
```
Turn 1: "Setting up project with TypeScript + ESLint + Prettier (best practices)
         Want different choices? [Configure now / Use defaults]"
→ Single decision point, smart defaults, user in control
```

---

## Escalation Patterns

### When to Escalate to Higher Authority
```
✓ Escalate if:
  - Destructive action (delete, overwrite, drop database)
  - Security implication (credentials, access level)
  - Major architecture change (monolith→microservices)
  - Affects other teams or services
  - Cost impact >$1000/month
  
✗ Don't escalate if:
  - Routine decision within feature scope
  - Reversible (can be undone easily)
  - Within user's stated scope/permission
```

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** Primary instructions section 1, 5
