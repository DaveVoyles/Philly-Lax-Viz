---
name: "Autonomous Fleet Agent"
description: >
  Fleet and orchestration rules. Load this file when the task involves
  multiple agents, independent lanes, or parallel execution.
  Base execution rules (always-on) live in .github/copilot-instructions.md.
---

## 1. Fleet Core Directives & Sizing

The Autonomous Fleet Agent coordinates **multiple sub-agents working in parallel** to execute complex, multi-part tasks.
This file **extends** the base guidelines in `.github/copilot-instructions.md`. All base rules (e.g. security, ADRs, tests, commits, and verification) are fully inherited.

### When to Use Fleet vs. Solo

**Use Fleet when:** ≥3 genuinely independent workstreams, unfamiliar domain requiring parallel research, or complex multi-part tasks where parallel execution provides clear time/cost savings.

**Skip Fleet (use solo) when:** Task is sequential, system is familiar, <5 steps, or a straightforward single-agent task. Fleet overhead (fresh sub-agent contexts) isn't justified for small/routine work.

**Decision:** If uncertain, start solo. Escalate to fleet only if you hit parallelizable bottlenecks. Avoid forcing fleet on sequential tasks just for visibility — a solo agent with checkpoints is often cheaper.

### Wave Sizing & Planning
Break work into sequential **Waves**. Each wave consists of parallel **Lanes** mapped to independent outcomes.
- Track all tasks, waves, and lane status using the database `todos` and `todo_deps` tables.
- **Wave 0 (Research Phase):** Optional — run parallel research lanes if the domain is unfamiliar or task is high-risk. Skip for routine work.
- Maintain a **Context Map** in the plan file for Medium/High risk tasks before initiating execution waves.

### Fleet Sizing Guidance
Use t-shirt sizing to estimate complexity and determine the active fleet size:
- **Small (S):** Solo agent. Single logical change, low risk, 1-2 files.
- **Medium (M):** 2-3 agents in parallel. Moderate risk, independent files/directories.
- **Large (L):** 3-4 agents in parallel. High risk, cross-cutting features, multiple dependencies.
- **Extra Large (XL):** Reject. Deconstruct into multiple Medium waves first.

---

## 2. Fleet Name Map & Character Assignments

To make the workspace lively, easy to track, and consistent, the orchestrator assigns deterministic names and emojis from the **Fleet Name Map** to parallel lanes:

| Order | Fleet Name | Emoji | Best Use Case |
|-------|------------|-------|---------------|
| 1st   | **Han** | 😉🚀 | Lead investigator, audit lanes, or fast-paced actions |
| 2nd   | **Yoda** | 👽✨ | Core coding logic, structural changes, adapter adapters |
| 3rd   | **Leia** | 👑💁‍♀️ | Scope controllers, integration coordination, front-end layout |
| 4th   | **Chewy** | 🐻💪 | Command execution, test suites, builds, heavy lifting |
| 5th   | **R2** | 🤖🔧 | Validation, script execution, refactoring, code sanitization |
| 6th   | **Luke** | 🌟⚔️ | Implementation of new modules, security interfaces, gateways |
| 7th   | **Darth** | 😈⚡ | Deep optimization, database migrations, complex SQL queries |

*Rule: Include the assigned name and emoji in each sub-agent prompt so the fleet is easy to track and coordinate.*

---

## 3. Risk Tiers & Rollback Plan

Classify the task before making changes:
- **Low Risk:** Docs, small refactors, isolated scripts, non-behavioral config. (Validation: Targeted test/verification).
- **Medium Risk:** Features, workflow logic, multi-file refactors. (Validation: Area-specific regression checks).
- **High Risk:** Auth, secrets, infrastructure, data mutation, destructive operations, CI/CD, or major user-facing blast radius. (Validation: Stricter global checks, rollback plan, and user-facing checkpoint before first side-effecting step).

### Rollback Plan (Required for High Risk)
Before running a High Risk wave, document in the plan:
```markdown
## Rollback Plan
- **Safe state:** [Last known-good state/commit]
- **Rollback steps:** [Exact commands to restore safe state]
- **Rollback trigger:** [Condition requiring rollback]
- **Verified restorable:** [ ] yes / no
```

---

## 4. Agent Registry & Specialist Lane Routing

### Agent Registry
Map lanes to specific sub-agent types using the `task` tool:

| Agent Type | Tool Parameter (`agent_type`) | Best For | Avoid For | LLM Tier Heuristic |
| :--- | :--- | :--- | :--- | :--- |
| **explore** | `"explore"` | Codebase research, symbol lookup, parallel investigation | Implementation | **Flash/Cost-Optimized** (`claude-haiku-4.5`, `gpt-5.4-mini`) |
| **research**| `"research"` | Web search, package docs, advisories with citations | Repo edits, commands | **Flash/Cost-Optimized** (`claude-haiku-4.5`, `gpt-5.4-mini`) |
| **task** | `"task"` | Running builds, tests, linters, installs (pass/fail) | Complex reasoning | **Flash/Cost-Optimized** (`claude-haiku-4.5`, `gpt-5.4-mini`) |
| **general-purpose** | `"general-purpose"` | Multi-step coding, complex refactoring, logic | Quick lookups | **Advanced Reasoning** (`claude-sonnet-4.6`, `claude-opus-4.8`) |
| **Rubber Duck** | `"general-purpose"` (with review-only prompt) | Plan/code critiques, catching blind spots | Modifying files | **Advanced Reasoning** (`claude-sonnet-4.6`, `claude-opus-4.8`) |
| **code-review** | `"code-review"` | Pre-commit diff auditing (staged changes) | File execution | **Advanced Reasoning** (`claude-sonnet-4.6`, `claude-opus-4.8`) |

### Specialist Lane Routing
If any of the following domains arise, assign a specialist lane:

**UI/Accessibility:** Route to `general-purpose` — ensure keyboard navigation (Tab flow, focus states), screen-reader labels (`aria-label`, `alt` text), semantic HTML.

**Security/Auth:** Route to `general-purpose` — verify least-privilege scoping, zero hardcoded secrets, safe logging (no credentials/PII).

**Database/Migration:** Route to `general-purpose` — require pre-migration backups and dry-run preview for destructive SQL (`DROP`, `TRUNCATE`, `ALTER`).

**QA Sign-off:** Independent verification lane (no code fixes). Return a brief sign-off: verdict (pass/fail/blocked), checks run, coverage, bugs found.

---

## 5. Wave 0: Parallel Research Phase & Synthesis (Optional)

### When to Run Wave 0
- **Medium or High risk work** with unfamiliar domains
- **Complex research questions** requiring parallel investigation
- **Skip if:** Task is routine, domain is familiar, or risk is low

### Research Execution
If Wave 0 is needed:
- Assign parallel `explore` or `research` agents to focused questions
- Wave 0 is **strictly read-only**: no code writes
- Gather findings under a `## Findings` section in the plan
- Document patterns, risks, and implementation pathways before Wave 1

---

## 6. Checkpoint Cadence, Active Polling & Stuck Agent Protocol

### Checkpoint Cadence
The orchestrator monitors active lanes based on the following time parameters:

| Effort | First Checkpoint | Update Frequency | Active Polling | Silent Escalation | Hard Stop (Auto-Stop) |
|--------|------------------|------------------|----------------|-------------------|----------------------|
| **S**  | 5 mins           | Every 3-5 mins   | Proactive (5m) | > 8 mins silent   | 15 mins              |
| **M**  | 10 mins          | Every 5-8 mins   | Proactive (10m)| > 15 mins silent  | 30 mins              |

- **Active Polling Rule:** The orchestrator does not wait for agents to report. At each checkpoint window, the orchestrator proactively evaluates the agent's latest communication log and updates its progress in the plan file with `✅`, `🔄`, or `⚠️`.

### Stuck Agent Protocol
If an active sub-agent stalls, hangs, becomes silent past its escalation threshold, or loops on the same error 3 times:
1. **Create Handoff Note:** Write a brief note documenting current status and blockers:
   ```markdown
   ### Handoff: Lane [N] ([Fleet Name]) — [timestamp]
   - **Scope:** [what this lane owns]
   - **Files touched:** [list]
   - **Progress:** [completed work]
   - **Blocker:** [why it is stuck]
   - **Next step:** [exact action the replacement agent must take first]
   ```
2. **Terminate Process:** Terminate the stuck agent's process or command.
3. **Reassign & Launch:** Launch a replacement agent in the same lane. Include their fleet name and emoji, link to the handoff note path, and instruct them to read the handoff note first.
4. **Notify User:** Post a brief notification to the user explaining the swap.

---

## 7. Quality Gates & Rubber Duck Review Loop

### Quality Gates
Before any wave is considered complete, it must pass these strict Quality Gates:
- **Gate 1 (Self-Review):** Review the staged diff (`git diff --cached`) for debug logs, test mocks, or credential leaks.
- **Gate 2 (Diff Size Ceilings):** If changes exceed **500 lines**, split them into smaller logical commits.
- **Gate 3 (Automated Suites):** Targeted tests must return 100% pass status, and linter warnings must be resolved.
- **Gate 4 (Code Review):** Run the `code-review` agent on staged changes.

### Rubber Duck Review Loop
The **Rubber Duck Reviewer** is a specialized non-editing `general-purpose` agent role launched with an explicit critique prompt:
- **Plan Critique:** Duck must review and comment on the wave plan before Wave 1 begins.
- **Mid-wave Check:** Duck reviews complex implementation files before validation starts.
- **Verdict-Gated Progress:** If the Duck returns a `fail` verdict, the orchestrator **MUST** pause and address the feedback before proceeding.

---

## 8. Sub-Agent Prompts & Communication

### Stable Prompt Caching Structure
To maximize prompt caching hit rates, segregate static and dynamic parameters:
1. **Stable Top (Static):** Place role definitions, system rules, and permanent constraints at the absolute top.
2. **Dynamic Bottom (Variable):** Place inputs, turn history, and logs at the bottom.

### Prompting Sub-Agents Template
Structure the prompt to the sub-agent exactly as:
```text
Agent [N] - [Fleet Name] [Emoji] - [Role]

Context:
- Repo/Path: | Relevant files: | Constraints:
- Context Map & Requirement IDs: [REQ-###] | [ASM-###]

Wave:
- Wave: [N] | Effort: [S|M|L|XL] | Plan file: [Path]
- Checkpoint: [Time] | Update frequency: Every [X mins]

Scope:
- Own: [Exact files/directories]
- Do NOT touch: [Unrelated/adjacent areas]
- Lane Contract: [producer/consumer details, format, start condition]

Deliverable & Done When:
- [Detailed outcome and validation criteria]
- Update posted to the communication log
```

### Communication Protocol
Post brief checkpoints to the user using visual emoji markers:
```markdown
### Checkpoint Format (Bullet Style)
🔍 **Lane 1 (Han 😉🚀):** Audit complete — 12 files scanned, 3 patterns found
✅ **Lane 2 (Yoda 👽✨):** Implementation phase 1 complete — 4 adapters created, tests pass
```

**In the plan file, record updates as:**
```markdown
### Progress Log
- 14:32 Lane 1 (Han): 🔍 Audit complete — 12 files scanned
- 14:45 Lane 2 (Yoda): 🛠️ Implementing adapters (2/4 done)
- 15:00 Lane 1 (Han): ✅ Audit final report posted
```

### Fleet Launch Brief
Before dispatching lanes, post a brief announcement to the user:

```markdown
### 🚀 Fleet Launch — Wave [N]
**Task:** [1-line summary]
**Risk:** Low | Medium | High
**Lanes:**
- **Lane 1 (Han 😉🚀):** [Scope — files/directories]
- **Lane 2 (Yoda 👽✨):** [Scope]
- **Lane N:** [Scope]
```

Solo tasks skip this announcement.

### Mandatory Completion Recap
After **every wave** (or solo task) the orchestrator MUST post a completion recap to the user. This is non-optional — do not consider a task complete until this recap is posted.

The recap MUST always end with **exactly 2 Recommended Next Steps**.

```markdown
### ✅ Wave [N] Complete — [Task summary]
[1–2 sentences describing what is now true and whether anything is blocked.]

#### Agent Contributions
| Agent       | Lane     | Delivered                        | Result      |
|-------------|----------|----------------------------------|-------------|
| Han 😉🚀    | LANE-001 | [Deliverable Han produced]       | ✅ Passed   |
| Yoda 👽✨   | LANE-002 | [Deliverable Yoda produced]      | ✅ Passed   |

#### 🔭 Recommended Next Steps
1. **[Specific action]** — [Why it adds value or what risk it addresses]
2. **[Specific action]** — [Why it adds value or what risk it addresses]
```

> Rules:
> - The "Recommended Next Steps" block is mandatory on every recap. No exceptions.
> - Always provide exactly 2 items — not 1, not 3.
> - Each item must be a concrete action (not a vague suggestion) with a one-line rationale.

---

## 9. Execution Plan Template
Always create/update the plan file using the structured format found in **`.github/docs/fleet-plan-template.md`**. Refer directly to that template file to initialize your plan document. Do not copy-paste the template structure into this instruction file.

---

## 10. Session Economics & Token Efficiency

Token spend is the dominant cost lever. This section documents proven patterns to compress token usage by 40–60% through smarter session boundaries, upfront context, and model selection.

### 10.1 Session Boundaries: The Biggest Lever

**Rule:** Start a new session every **15–20 turns** (or when switching major topics).

Why this matters:
- Long sessions accumulate conversation history that the model increasingly ignores after ~15 turns.
- Session resets clear old history — you lose nothing valuable, just noise.
- Fresh context windows yield **3–5× lower input tokens** for the same logical work.
- Each new session is a "context checkpoint" that reduces downstream token bloat.

#### When to Reset Sessions
1. **Turn limit:** After 15–20 turns, end the session proactively.
2. **Topic shift:** When moving from Phase A → Phase B (e.g., "diagnose" → "fix" → "test"), open a fresh session.
3. **Hand-off:** When handing work off to a fresh day or human, create a full summary (see Section 10.5).

#### How to Reset
```bash
# Option 1: Explicit /clear in CLI
/clear

# Option 2: Open a new terminal or chat tab
# Copy the session summary (Section 10.5) as opening context
# Paste: "Resume task: [summary]"
```

**Cost Impact:** Prevents 40M–80M token accumulation per long task. Example: "Deploy Fleet Update" (379M tokens) could have been 3–4 focused sessions (~100M total).

---

### 10.2 Task Decomposition: Split Multi-Step Workflows

**Rule:** Break recurring multi-step patterns into separate focused sessions, each owning a complete, self-contained outcome.

#### Bad Pattern (Expensive)
- Single 30-turn session: "diagnose → implement → test → verify"
- Conversation history grows; later turns pay the cost of early exploration.
- **Token cost:** ~300M for complex task.

#### Good Pattern (Efficient)
- **Session 1:** "Set up [component]" — diagnose, design, plan. (5–8 turns)
- **Session 2:** "Implement [component]" — code & self-verify. (8–12 turns)
- **Session 3:** "Test [component]" — run suites, fix failures. (5–8 turns)
- **Session 4:** "Verify & integrate" — final checks, hand off. (3–5 turns)
- **Token cost:** ~100M total (3–4 smaller, focused contexts).

#### Workflow Examples

**Example A: Infrastructure Deployment**
```
Session 1: "Design deployment architecture"
→ Outcome: architecture diagram, deployment steps, risk assessment

Session 2: "Set up Kubernetes cluster"
→ Outcome: cluster running, health checks passing

Session 3: "Deploy application services"
→ Outcome: services running, logs clean

Session 4: "Verify & monitor"
→ Outcome: integration complete, monitoring dashboards active
```

**Example B: Debugging Complex System**
```
Session 1: "Collect logs & diagnose root cause"
→ Outcome: ranked hypothesis list with evidence

Session 2: "Implement fix for top hypothesis"
→ Outcome: fix applied, local tests pass

Session 3: "Integration test & deploy"
→ Outcome: production verified, no regressions
```

---

### 10.3 Front-Load Context: Eliminate Gradual Exploration

**Rule:** Instead of exploring files one-by-one over 20 turns, provide complete context upfront in the opening message.

#### Bad Pattern (Expensive)
```
User: "Why is auth failing?"
Assistant: "I'll investigate. Let me check src/auth.py..."
[Turn 2] Reads file → asks question
[Turn 3] Reads related file → more questions
[Turn 20] Finally makes diagnosis
```
- Cost: 20 turns × 15K avg tokens = 300K tokens wasted on exploration.

#### Good Pattern (Efficient)
```
User: "Why is auth failing?
[hcr attached: src/dashboard/auth.py, src/dashboard/api_handlers.py:40-120, logs/error.log, config/auth.yml]"
Assistant: [Immediate diagnosis with 3–4 ranked hypotheses, no exploration]
```
- Cost: 1 turn × 25K tokens (context) + 2 follow-up turns = ~50K total.
- **Savings:** 6× cheaper.

#### Implementation
Use `hcr` (GitHub Copilot CLI context referencing) to include files upfront:
```bash
# DO THIS
hcr "Diagnose slow database query" src/db/queries.sql:1-50 logs/slow.log schema.sql

# NOT THIS
User: "Why is the query slow?"
[Waits for gradual file reads]
```

**When to use front-loaded context:**
- Debugging: Include error logs, code files, configs.
- Code review: Include staged diff, related files.
- Architecture review: Include relevant modules, deployment configs.
- Optimization: Include metrics, profiling output, related code.

---

### 10.4 Model Selection by Task Type

Not all tasks need Opus. Route to the right model to cut costs while maintaining quality.

| Task Type | Use This Model | Why | Cost vs Opus |
|-----------|---|---|---|
| Iterative debugging, config questions, error messages | **Claude Haiku 4.5** | Fully capable for "does this look right?" 95+ IQ | ~96% cheaper |
| Code writing, explanations, design review | **Claude Sonnet 4.6** | Best reasoning-to-cost ratio for implementation | ~10× cheaper |
| Architecture, multi-file logic, complex reasoning | **Claude Opus 4.8** | Needed only for truly complex decisions | Baseline (1×) |
| Web research, documentation search | **Gemini Flash** | Fast, cheap, excellent retrieval | ~98% cheaper |

#### Routing Examples
```
User: "Is this config syntax right?"
→ Use: Claude Haiku (config syntax validation, no reasoning needed)

User: "Implement OAuth2 flow for the dashboard"
→ Use: Claude Sonnet (focused code implementation, moderate complexity)

User: "Design a distributed cache architecture for 10M users"
→ Use: Claude Opus (complex reasoning, multiple trade-offs)

User: "Find the latest React best practices"
→ Use: Gemini Flash (web research, retrieval, citations)
```

**Cost Impact:** Routing 60% of work to Haiku saves ~55% of total token spend.

---

### 10.5 Diagnostic-First Debugging: Eliminate Trial-and-Error

**Rule:** Collect all relevant logs, configs, and context upfront. Ask for a complete diagnosis with ranked hypotheses in 1–2 turns instead of iterating "try this, no try that" for 30 turns.

#### Bad Pattern (Expensive)
```
[Turn 1] "Plex is slow"
[Turn 2] "Try restarting the service"
[Turn 3] "Still slow, try increasing memory"
[Turn 4] "Still slow, check disk I/O"
[Turn 30] "Found it — wrong database index"
Cost: 30× exploration = ~450K tokens
```

#### Good Pattern (Efficient)
```
[Turn 1] "Plex is slow. [attached: logs, system metrics, configs, recent changes]"
[Turn 2] "Diagnosis: Ranked hypotheses — (1) Wrong index (evidence: query plan X), 
(2) Memory pressure (evidence: metrics Y), (3) Disk contention (evidence Z)"
[Turn 3] "Implement top hypothesis, verify"
Cost: 3 turns = ~50K tokens
```

#### Checklist: What to Dump Upfront
- **Error messages / logs** (last 50 lines)
- **System metrics** (CPU, memory, disk, network)
- **Configuration files** (relevant sections, no secrets)
- **Recent changes** (git log last 5 commits)
- **Expected behavior** (1 sentence)
- **Actual behavior** (1 sentence)

---

### 10.6 Session Summary & Handoff Template

When a session approaches 15+ turns **and more work remains**, end it with a complete summary for the next session.

#### Template
```markdown
## Session Summary [Date] — [Task Name]

### What Was Done ✅
- [Completed outcome 1] (brief, 1 line)
- [Completed outcome 2]
- [Completed outcome 3]

### What Worked
- [Technique/pattern that was effective]
- [Tool/command that saved time]

### What's Left ⬜
- [Next phase or remaining work — be specific]
- [Blockers, if any]

### How to Resume 🚀
1. [Exact starting action]
2. [Key file paths to know]
3. [Context to load: git branch, env vars, etc.]

### Key Files
- `src/module.ts` (lines 40–120 are critical)
- `config/prod.yml` (database section matters)

### Important Decision
- [What was decided and why] — do not revisit this.
```

#### Next Session Opening Message
```markdown
Resume: [Task Name]

[Paste the summary from the previous session]

Continue with: [Next step from "What's Left"]
```

**Cost Impact:** Prevents re-reading files and re-explaining context. Fresh session loads the summary in 1 turn instead of re-exploring 10 turns.

---

### 10.7 Session Economics Checklist

Before ending any session, verify:

- [ ] **Turn count:** If >15 turns and work remains, create a summary.
- [ ] **New session trigger:** If switching major topics, open a fresh session.
- [ ] **Model routed correctly:** Haiku for debugging, Sonnet for code, Opus only if needed.
- [ ] **Context front-loaded:** Next time, include files/logs upfront to avoid exploration.
- [ ] **Diagnosis before iteration:** Avoided "try this, try that" loops?
- [ ] **Handoff complete:** If handing off to human or next day, include the summary template.

---

**Version:** 5.36
**Last Updated:** June 16, 2026
**Status:** Refined — Fleet is opt-in for complex work; section economics kept intact
