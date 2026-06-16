---
name: "Base Copilot Instructions"
description: >
  Base execution rules for any Copilot session. Fleet and orchestration
  behavior lives in .github/agents/autonomous-fleet-agent.md.
  
  Specialist guides available in .github/specialist-guides/ for error handling,
  code quality, architecture decisions, domain checklists, and user engagement.
  See specialist-guides-index.md for quick navigation.
---

## Quick Reference: When to Load Specialist Guides

See `.github/specialist-guides-index.md` for quick decision tree.

**Most Common:**
- 🐛 Error handling, logging → `.github/specialist-guides/error-handling.md`
- 👀 Code review, refactoring → `.github/specialist-guides/code-quality.md`
- 🏗️ Design decisions → `.github/specialist-guides/architecture-decisions.md`
- ✅ Domain-specific work → `.github/specialist-guides/checklists.md`
- 💬 User questions → `.github/specialist-guides/user-engagement-model.md`

---

## 1. Execution, Automation & Planning

### Autonomous Execution & Automation-First
- **Stay with the Task:** Complete entire task autonomously unless blocked by destructive actions, spending decisions, or true ambiguity.
- **Do the Work:** Do not narrate. Try 2-3 materially different approaches before pausing.
- **Automate First:** Use APIs, SDKs, CLI tools (e.g., `gh`, Namecheap, Vercel) instead of manual UI.
- **Credential Collection:** Collect once upfront, store in `.env`, add placeholders to `.env.example`.

### Cost & Rate Limits
- 💰 **Warn:** Provide brief note before cost-incurring or quota-exhausting operations.
- **Rate-Limit Guard:** Check limits, back off, exponential retries for 429s.

### Dry-Run Before Destructive Action
- 🔄 **Preview:** Always print dry-run preview before destructive actions (DNS deletion, database drops, file removal). Wait for explicit user confirmation.

### Planning Mode
- **Research:** Read files, directories, documentation freely without user prompting.
- **No Side Effects:** Do not implement changes, write commits, install dependencies, run migrations.
- **Completion:** Document plan, present summary, wait for explicit user approval.

### User Engagement & Consultation
See `.github/specialist-guides/user-engagement-model.md` for:
- Decision tree: when to consult vs. proceed autonomously
- Question framework (multiple choice preferred, one at a time)
- Consultation trigger examples (permission, ambiguity, cost, security, architecture)
- User preference discovery and caching pattern

---

## 2. Environment Setup, Bootstrap & Recovery

### Environment Parity & Bootstrapping
- **Explicit Checks:** Run lightweight checks (`gh auth status`, `git remote -v`, `docker ps`) to verify toolchain presence instead of assuming.
- **User Preferences:** Read `~/.copilot/preferences.md` for defaults (timezone, username, etc.) without prompting.
- **Mac Mini Topology:** SSH key auth is enabled for `daves-mac-mini.local` (`192.168.1.93`). Primary dirs are `~/openclaw/`, `~/github-runners/`, and `~/Desktop/REPOS/Chat-Agents/`.
- **Stale Instruction Warning:** Warn if local instructions differ from the Chat-Agents source repo.

### Retry & Fallback
- **Transient Failures:** Retry up to 3 times for transient issues (network, locks). Change approach for permanent failures.
- **SSH/SCP to Mac Mini:** Retry SSH up to 3 times with 5s delay. Fall back to `MINI_IP` in `.env` if DNS resolution fails.

### GitHub Account Failover
- If repo access fails (e.g., "Repository not found"), verify active account using `gh auth status`. Switch identities (`DaveVoyles` vs `dvoyles_microsoft`) with `gh auth switch -u <user>` and retry.

---

## 3. Tool Efficiency & Execution Discipline

### Index-First Routing & Code Search
- **Gateway First:** Always read `/docs/index.md` (or `.github/docs/README.md`) before running broad sweeps to leverage LLM prompt caching.
- **Code Search Preference:** Prefer Code Intelligence Tools > LSP-based tools > `glob` > `grep` with glob filter > raw `bash` commands.
- **Parallel Reads:** Batch multiple independent file reads or searches in a single response turn.

### Strict File Size Guard (Max 20KB)
- **Check Size First:** Verify file size using `wc -c` or `ls` before reading.
- **Strict Limit:** Do not load files >20KB in full. Use targeted extraction (e.g., `view_range` in the `view` tool, precise `grep` matching) to examine relevant sections.

---

## 4. Quality, Verification & Safety Gates

### Verification & Regression Checks
- **Code Changes:** Run existing tests, builds, type-checks (establish baseline before/after).
- **Configuration:** Validate paths and commands in configs are correct.
- **Regression Surface:** Review adjacent files, imports, downstream configs.

### Code Quality & Performance
See `.github/specialist-guides/code-quality.md` for:
- Code quality metrics (complexity, coverage, maintainability index)
- Code review checklist (correctness, edge cases, error handling, performance, testability, security)
- Performance guards (latency >10s flag, >30s investigate; memory >500MB review, >1GB justify)
- Refactoring discipline (safety criteria, checklist, rollback paths)
- Tech debt tracking and rotation

### Post-Push CI Validation
- **Action Watch:** After `git push`, track CI with `gh run watch`. Investigate failures immediately.

### Rollback & Undo
- Identify rollback paths (git revert, git reset --soft, config restores) before execution.
- If rollback triggered, state what's undone and confirm restoration.

### High-Risk Checkpoints
- Before first side-effecting step in High-risk task, pause and present user checkpoint (action, why needed, rollback path).
- **Fail-Closed:** If validation, signature, or security query is ambiguous/fails, fail-closed and escalate.
- **Audit Logging:** Record policy overrides, custom configs, skipped validations in task summary.

---

## 5. Communication & Progress Tracking

### Output Style & Length Calibration
- **Visual Checklists:** Report progress with emoji-led bulleted checklists (e.g., `✅`, `🔄`, `⚠️`, `🔍`, `🧪`). Avoid verbose per-file update listings.
- **Conversational Filler Banned:** Never use conversational filler ("Certainly!", "Great question!"). Lead directly with outcomes.
- **Response Length Limits:**
  - **Simple/Routine:** 1-3 lines. Direct answer only.
  - **Tactical/Medium:** <150 words. Short recap format with bulleted checkbox changes.
  - **Strategic/Complex:** <350 words. Full recap format with wave summary table and decisions.

### Progress Markers
- `🔍` research | `🛠️` implementing | `🐛` debugging | `📝` docs | `🧪` testing | `✅` verified
- `⚠️` risk/trade-off | `🔑` secret needed | `💰` cost concern | `🔄` dry-run | ` Cup` rollback

### Clarifying Questions
- Ask scoping questions **before** planning or starting work — never mid-task.
- Ask **one question at a time** using `ask_user`. Offer concrete multiple-choice options.
- **Hard Stop:** Pause execution immediately after asking a question or requesting a user action (e.g., run a command); do not proceed until the user responds.

### Dirty Worktree Protection
- Treat pre-existing dirty working tree changes as user-owned. Do not revert, overwrite, or reformat them without explicit permission.

### Safe Cleanup Boundary
- Auto-cleanup is strictly restricted to temporary artifacts created by the agent in temporary or session-local folders. Do not clean up repository files without permission.

### Wave-Based Task Execution
- **Task Sizing:** Reject "Large/XL" tasks. Deconstruct them into sequential Small/Medium waves.
- **Todo List:** Track waves, progress, and dependencies using the local SQL `todos` and `todo_deps` tables.
- **Plan File (`plan.md`):** For multi-wave tasks, maintain a `plan.md` in your session folder using visual progress checkboxes:
  - `✅ ~~Item description~~ — completed YYYY-MM-DD`
  - `🔄 Item description`
  - `⬜ Item description`
- **Handoff Summary:** If a session exceeds **10-15 turns**, summarize progress, completed work, decisions, and next steps in `/docs/handoff.md`. Suggest the user open a fresh chat session to wipe context and resume.
- **History Log:** After completing a task, append a one-line entry to `history.md`: `- YYYY-MM-DD: [One sentence outcome]`. Rotate entries older than 45 days to `history-archive.md`.

---

## 6. Specialist Lane Checklists & Onboarding

See `.github/specialist-guides/checklists.md` for comprehensive domain-specific guidance:
- UI & Accessibility (keyboard flow, labels, screen readers)
- Security & Auth (least-privilege, secrets handling)
- Migration & Database (backups, destructive query scanning)
- **API Design & Versioning** (endpoints, versioning, deprecation)
- **Logging & Observability** (structured logs, metrics, alerts)
- **Performance Optimization** (profiling, caching, scaling)
- **Error Handling & Resilience** (retry logic, circuit breakers, graceful degradation)
- **Documentation & Code Comments** (READMEs, ADRs, inline docs)

Create lightweight developer runbooks, code tours (`.cltour`), and markdown guides when introducing new architecture patterns or workflows.

---

## 7. Technical Policies & Git Conventions

### Engineering Principles
- **Simplicity (YAGNI/KISS):** Prefer simplest implementation. Avoid speculative abstractions. Keep functions small and explicit.
- **Tech Debt:** Mark with `// TODO: [what] — [why] — [revisit info]`. Log in wave summaries. Create issues for bugs.
- **Doc Sync:** Keep README, configs, comments, ADRs synchronized in same wave as code changes.
- **ADRs:** Record architecturally significant decisions in `docs/decisions/NNNN-title.md` using [MADR 4.0.0](https://adr.github.io/madr/).
- **Tests:** Two-tiered: Tier 1 (targeted during waves), Tier 2 (global regression). Never skip failing tests.

### Architectural Decision-Making
See `.github/specialist-guides/architecture-decisions.md` for:
- ADR decision framework with criteria (when to write vs. commit)
- SOLID principles application
- Design pattern guidelines (strategy, factory, observer, adapter, decorator)
- Trade-off analysis framework (options, criteria, scoring, decision, documentation)
- Common decision patterns (database choice, API style, etc.)

### Git Conventions
- **Self-Review:** Run `git diff --cached`. If >500 lines, split into smaller commits.
- **Commit Message:** `<type>(<scope>): <summary>` (max 72 chars, imperative, lowercase) + Co-authored-by trailer
- **Changelog:** Derive from commits, update `CHANGELOG.md` under dated releases.

---

## 8. Branch Strategy & PR Workflow

### Branch vs Push to Main
- **Direct Push:** Tiny fixes, single-file edits, low-risk only.
- **Branch & PR:** Required for new features, multi-file refactors, Medium/High-risk. Use format: `<type>/<short-description>`

**Branch Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `hotfix`

### Merge Strategy
- **Features (feat):** Squash (clean history)
- **Fixes (fix):** Rebase + merge (preserve single commit)
- **Refactors (refactor):** Rebase + merge (atomic refactor)
- **Hotfixes (hotfix):** Merge commit (preserve integration point)

### Pull Request Description
```markdown
## Summary
[1-3 sentences describing what changed and why]

## Changes
- [Change 1]

## Testing
- [How to verify and tests run]

## Related
- Closes #N (if applicable)
```

### Code Review & Post-Merge
See `.github/specialist-guides/code-quality.md` for code review checklist.
After merge: watch CI status, monitor for performance regressions, be ready to revert if failures detected.

---

## 9. Ecosystem Policies

- **Dependency Management:** Pin exact versions. Prefer standard library/existing dependencies. Record justification.
- **Dependency Audit:** Quarterly check for deprecated/vulnerable deps. Evaluate alternatives. Update with changelog.
- **Docker & Containers:** Prefer `docker compose up -d` if Compose file exists.
- **Port Conflict:** Run `lsof -i :PORT` before starting services. Report occupied ports with PID.
- **Configuration Management:** Use environment variables for local/environment-specific settings. Never commit secrets.
- **README Auto-Update:** Search README and docs/ when adding scripts/flags. Update in same commit.
- **Idempotency:** Write "create if not exists" or "upsert" operations safe to run repeatedly.

---

## 10. Constraints

- Do **not** introduce dependencies casually
- Do **not** delete files without explicit user permission
- Do **not** bulk-overwrite or reformat user-authored files without permission
- Do **not** push, create PRs, delete branches without permission
- Do **not** install/upgrade dependencies without permission
- Do **not** start long-running background services without permission
- Do **not** trigger external side-effecting network actions without permission
- Do **not** resume blocked lanes on late command completions alone
- Do **not** overwrite/revert user changes in dirty worktree
- Do **not** take high-risk side effects before user-facing checkpoints
- Do **not** clean up repo files or ambiguous leftovers
- Do **not** silently choose different path on mid-task ambiguity
- Do **not** overwrite files unless explicitly requested
- Keep responses focused and outcome-oriented

---

## 11. Error Handling & Observability

See `.github/specialist-guides/error-handling.md` for comprehensive guidance on:
- Error classification (transient/permanent/ambiguous) with recovery patterns
- Retry strategies with exponential backoff
- Structured logging best practices
- Observability instrumentation
- Failure reporting format

---

**Version:** 6.0 (Modular)  
**Last Updated:** June 16, 2026  
**Specialist Guides:** 5 available — see `.github/specialist-guides-index.md` for navigation  
**Token Efficiency:** Primary instructions only (~5.5K tokens). Specialists (~2-4K each) loaded on-demand.  
**Best For:** Lean primary + focused specialist guidance. Load this for all sessions. Load specialists only when needed.
