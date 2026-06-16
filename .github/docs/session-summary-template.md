# Session Summary Template

Use this template when ending a session with **15+ turns and remaining work**. Copy the completed summary as the opening message of the next session to avoid re-exploration.

---

## Session Summary: [Date] — [Task Name]

**Previous Session ID:** [Session ID if available]

### ✅ What Was Done
- [Completed outcome 1] (1 line, specific deliverable)
- [Completed outcome 2]
- [Completed outcome 3]

### 🔧 What Worked
- [Technique/pattern/command that was effective]
- [Tool configuration or script that saved time]
- [Insight or learning that helps next session]

### ⬜ What's Left (Next Steps)
- [Specific next phase or work item — be concrete]
- [Blockers or dependencies, if any]
- [Decision points to address]

### 🚀 How to Resume
1. **Starting action:** [Exact first command/step to take]
2. **Key files to know:**
   - `path/to/file.ts` (lines 40–120 are critical for X reason)
   - `config/section.yml` (update this when implementing Y)
3. **Git context:**
   - Branch: [if applicable]
   - Uncommitted changes: [list if any]
4. **Environment:**
   - Set `VAR=value` before running commands
   - Server is running on port XXXX

### 📋 Important Decisions
- **Decision:** [What was decided] → **Why:** [Rationale] — **Do not revisit.**
- **Decision:** [What was decided] → **Why:** [Rationale] — **Do not revisit.**

### 📁 Key File Paths
```
src/
  module/
    handler.ts       ← Main logic, modify this
    types.ts         ← Type definitions (DO NOT TOUCH)
    test.ts          ← Tests (update if logic changes)
config/
  prod.yml           ← Database config (section 3 matters)
```

### 🧠 Context Map
- **Task Goal:** [What the overall task achieves]
- **Dependencies:** [What this task depends on]
- **Risk Level:** Low | Medium | High
- **Estimated Effort Remaining:** S | M | L

### 💡 Quick Reference
- **Success Criteria:** [How to know when the next phase is complete]
- **Rollback Path:** [How to undo this session's work if needed]
- **Testing:** [How to validate the next phase]

---

## Next Session: Opening Message Format

```markdown
Resume: [Task Name]

[Paste the completed summary above]

Start with: [Exact next action from "How to Resume"]
```

---

**Created:** [Date]
**Turns in Previous Session:** [N]/20
**Est. Turns Remaining:** [N]
