# Task Decomposition Cookbook: Split Multi-Step Workflows

This guide shows real examples of how to split expensive, long-running tasks into **separate, focused sessions**. Each session is a complete, self-contained outcome that feeds into the next.

---

## The Core Pattern

**Bad Pattern:** Single 30–40 turn session trying to diagnose + implement + test + deploy.
- Cost: ~300M tokens
- Context bloat: Early exploration penalizes later turns
- Error recovery: One mistake breaks the whole task

**Good Pattern:** 3–4 focused sessions, each 8–12 turns, each owning one clear outcome.
- Cost: ~100M tokens total (3–4 smaller windows)
- Fresh context: Each session starts clean
- Modularity: If one session fails, others continue

---

## Case Study 1: Infrastructure Deployment

### Task: "Deploy Kubernetes cluster and application services"

**Bad Approach (Single Session):**
```
Turn 1-5:   Research K8s options, cluster sizing, networking
Turn 6-10:  Design the deployment architecture
Turn 11-20: Implement cluster, install operators, config networking
Turn 21-30: Deploy application services
Turn 31-35: Test, debug failures, fix configs
Turn 36+:   Monitoring, logging, verification

Total: 40 turns, ~600M tokens
```

**Good Approach (Decomposed):**

#### Session 1: "Design K8s Architecture"
**Goal:** Produce a complete deployment plan with diagrams, risk assessment.
**Duration:** 6–8 turns
**Deliverable:**
- Architecture diagram (Excalidraw)
- Cluster sizing recommendation (CPU/memory/storage)
- Networking design (VPC, subnets, security groups)
- High-level implementation roadmap
- Risks and mitigations

**End with:** Session summary (Section 10.6 of autonomous-fleet-agent.md)

---

#### Session 2: "Set Up K8s Cluster"
**Goal:** Cluster running, health checks passing, nodes ready.
**Duration:** 8–10 turns
**Prerequisite:** Read Session 1's summary
**Deliverable:**
- Cluster provisioned (EKS / AKS / GKE)
- Ingress controller installed
- Network policies configured
- Storage class created
- Cluster health verified (`kubectl get nodes` all Ready)

**End with:** Session summary

---

#### Session 3: "Deploy Application Services"
**Goal:** Services running, no errors, all endpoints responsive.
**Duration:** 8–10 turns
**Prerequisite:** Read Session 2's summary
**Deliverable:**
- Deployments created (API, frontend, database)
- Services exposed (LoadBalancer, ClusterIP)
- Logs clean (no error spam)
- Smoke tests passing

**End with:** Session summary

---

#### Session 4: "Verify & Monitoring"
**Goal:** Full integration verified, monitoring dashboards live.
**Duration:** 5–7 turns
**Prerequisite:** Read Session 3's summary
**Deliverable:**
- End-to-end test passing
- Monitoring dashboard active (Prometheus/Grafana)
- Logging aggregated (ELK, Datadog, etc.)
- Runbook created
- Sign-off checklist complete

**Total Cost:** ~4 sessions × 100K tokens = ~400K tokens (33% of single-session cost)

---

## Case Study 2: Debugging a Complex System

### Task: "Service is slow, find root cause and fix"

**Bad Approach (Single Session):**
```
Turn 1:   "Service is slow"
Turn 2:   "Try restarting it" → still slow
Turn 3:   "Check CPU/memory" → normal
Turn 4:   "Check network" → ok
Turn 5:   "Check database" → high latency
Turn 6:   "Check indexes" → found it! One index missing
Turn 7:   "Create index" → applied
Turn 8:   "Verify fix" → slow query now fast
Turn 9:   "Explain root cause" → index was the problem

Total: 9 turns of trial-and-error, ~150K tokens
```

**Good Approach (Diagnosis-First):**

#### Session 1: "Diagnose Root Cause"
**Goal:** Ranked hypothesis list with evidence.
**Duration:** 1–2 turns
**Input (Front-Loaded):**
```
Attached:
- logs/error.log (last 100 lines)
- metrics/prometheus.json (CPU, memory, network)
- queries/slow.sql (slow query log)
- config/database.yml (connection pool, indexes)
- git log --oneline -5 (recent changes)
```

**Turn 1 Prompt:**
```
Service is slow since [when]. Here's complete context:
[All logs, metrics, configs, recent changes]

Diagnosis: Provide ranked hypotheses with evidence:
1. Most likely cause (evidence: X from logs/metrics)
2. Second most likely (evidence: Y)
3. Third option (evidence: Z)
```

**Deliverable:**
- Ranked hypothesis list (e.g., "Missing index (90% confidence)" vs "Memory pressure (5%)")
- Evidence for each
- Recommended next step

**Cost:** ~1–2 turns = 25K tokens

---

#### Session 2: "Implement Top Fix"
**Goal:** Fix deployed and verified.
**Duration:** 4–6 turns
**Prerequisite:** Read Session 1's diagnosis
**Deliverable:**
- Fix implemented (e.g., `CREATE INDEX ...`)
- Local tests passing
- Slow query now fast (evidence: query plan)
- Monitoring shows improvement

**Cost:** ~5 turns = 50K tokens

---

#### Session 3: "Verify & Prevent Recurrence"
**Goal:** Integrated and protected.
**Duration:** 3–5 turns
**Prerequisite:** Read Session 2's summary
**Deliverable:**
- Fix deployed to production
- Monitoring dashboard shows recovery
- Post-mortem: Why did this happen?
- Prevention: Index creation policy added to CI/CD

**Cost:** ~4 turns = 40K tokens

**Total Cost:** ~70K tokens (47% of single-session cost)

---

## Case Study 3: Feature Implementation

### Task: "Implement multi-factor authentication (MFA)"

**Bad Approach (Single Session):**
```
Turn 1-5:   Research MFA libraries, flow design
Turn 6-15:  Implement backend (models, endpoints, validation)
Turn 16-25: Implement frontend (UI, state management)
Turn 26-35: Integration testing, fix failures
Turn 36-40: Security audit, documentation

Total: 40 turns, ~600M tokens
```

**Good Approach (Decomposed):**

#### Session 1: "Design MFA Architecture"
**Duration:** 5–7 turns
**Deliverable:**
- Flow diagram (registration → validation → challenge → verify)
- Database schema (users, mfa_devices, otp_secrets)
- API contract (endpoints, payloads)
- Security checklist (rate limits, token expiry, secret storage)

---

#### Session 2: "Implement Backend"
**Duration:** 10–12 turns
**Prerequisite:** Session 1 summary
**Deliverable:**
- Models created (User MFA settings, OTP tokens)
- Endpoints implemented (register, validate, challenge, verify)
- Tests passing (happy path, error cases)
- Rate limiting in place

---

#### Session 3: "Implement Frontend"
**Duration:** 10–12 turns
**Prerequisite:** Session 1 + Session 2 summary
**Deliverable:**
- MFA registration UI (QR code display, secret input)
- MFA login flow (OTP entry)
- Error handling (invalid OTP, expired tokens)
- Tests passing

---

#### Session 4: "Integration & Security"
**Duration:** 8–10 turns
**Prerequisite:** All prior sessions
**Deliverable:**
- End-to-end flow tested
- Security audit complete (no hardcoded secrets, proper token handling)
- Documentation updated (user guide, API docs)
- Rollback plan if needed

**Total Cost:** ~4 sessions × 100K tokens = ~400K tokens (33% of single-session cost)

---

## Decomposition Decision Checklist

When faced with a multi-step task, ask:

- [ ] **Is there a natural phase boundary?** (design → implement → test → deploy)
- [ ] **Can each phase be independent?** (later phase doesn't block earlier one)
- [ ] **Does each phase have a clear deliverable?** (not "make progress", but "X is done")
- [ ] **Can the next session start without the full context of this one?** (summary is sufficient)

**If YES to all:** Decompose into separate sessions.

---

## Session Opening Template

When starting a subsequent session, use this structure:

```markdown
Resume: [Task Name] — Phase [N]/[Total]

[Paste the previous session's summary]

Model routing: [Haiku|Sonnet|Opus|Flash]
Expected effort: [S|M|L] (roughly [N] turns)

Start with: [Exact first action from "How to Resume"]
```

---

## Anti-Patterns

| ❌ Anti-Pattern | ✅ Better Approach |
|---|---|
| Sessions are too granular (1 turn each) | Aim for 8–12 turns per session; too fragmented loses efficiency |
| Next session doesn't reference prior summary | Always paste prior summary as opening context |
| Phases are loosely coupled (can't start next until this one is done) | Decompose only when phases are relatively independent |
| No clear deliverable per session | Define "done" upfront; each session owns a testable outcome |
| Using a heavy model (Opus) for all phases | Route by task type (design → Sonnet, debugging → Haiku, etc.) |

---

**Version:** 1.0  
**Last Updated:** June 16, 2026
