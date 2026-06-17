---
title: "Architecture Decision Template"
description: "150-token ADR one-pager: template for architecture decisions"
version: "1.0"
---

## Architecture Decision Record (ADR) Template

**Store in:** `docs/decisions/ADR-N-title.md` (replace N with sequential number)

---

## ADR-N: [Decision Title]

**Status:** Proposed | Accepted | Superseded  
**Date:** YYYY-MM-DD  

### Context
Why are we making this decision now? What's the problem?

**Example:** "We're building a payment feature and need to decide where to store payment data."

---

### Decision
What did we choose?

**Example:** "Use Stripe as third-party processor; we will store only Stripe payment IDs and amounts in our database, never card numbers."

---

### Options Considered

| Option | Pros | Cons | Score |
|--------|------|------|-------|
| **Stripe (CHOSEN)** | Secure, PCI-compliant, handles disputes | 2.9% per transaction | ⭐⭐⭐ |
| Own payment processor | Full control, cheaper | PCI audits required, regulatory burden | ⭐⭐ |
| PayPal integration | Simple, trusted | Less flexible, different API | ⭐⭐ |

---

### Consequences

**Pros:**
- Stripe handles PCI compliance (we don't store sensitive data)
- Disputes, refunds, fraud handled by Stripe
- Mature API with excellent documentation

**Cons:**
- 2.9% + $0.30 per transaction (cost adds up at scale)
- Dependency on third party (Stripe down = our payments down)
- Limited customization of checkout flow

**Risks:**
- Payment failures could hurt user experience
- Need to handle Stripe webhook failures gracefully

---

### Related Decisions
- ADR-3: Use async queues for payment webhooks
- ADR-5: Store audit logs for all payment events

---

## When to Write an ADR

✅ **Write if it's:**
- Hard/expensive to change later (database choice, API versioning, payment processor)
- Has major trade-offs (cost vs. features, complexity vs. reliability)
- Affects multiple teams
- Will need to explain to newcomers

❌ **Skip if it's:**
- Easy to change (internal refactoring, naming)
- One-time decision (this specific configuration)
- Obvious best practice

---

✅ **Use this template when:** Documenting a major architecture decision  
📖 **Use full guide when:** Need help with trade-off analysis or SOLID principles  
📍 **Location:** `.github/quick-refs/architecture-decision-template.md`
