---
title: "Specialist Guides Index"
description: "Minimal lookup table for agents: maps task domains to guides"
audience: "AI agents"
---

## Specialist Guides Quick Lookup

| Task | Essentials Guide | Full Guide | Quick-Ref |
|------|-----------------|-----------|-----------|
| **Error handling** | error-handling-essentials.md | error-handling.md | error-decision-tree.md |
| **Code review** | code-quality-essentials.md | code-quality.md | refactor-decision-tree.md |
| **Testing** | testing-essentials.md | testing-strategy.md | test-coverage-decision.md |
| **Deployment** | deployment-essentials.md | deployment-infrastructure.md | pre-flight-deployment.md |
| **Security** | security-essentials.md | security-hardening.md | security-quick-scan.md |
| **Architecture** | architecture-essentials.md | architecture-decisions.md | architecture-decision-template.md |
| **Performance** | N/A | N/A | performance-check.md |
| **Workflows** | N/A | N/A | guide-pairings.md |
| **Other domains** | N/A | checklists.md, user-engagement-model.md | N/A |

## Loading Rules (Also in primary instructions)

1. **Default:** Load essentials (covers 80% of tasks, 0.8-1.2K tokens)
2. **Quick decision:** Load quick-ref card (<500 tokens)
3. **Deep work:** Load full guide (3-3.5K tokens, only if essentials insufficient)
4. **Multi-specialist:** Load guide-pairings.md + relevant guides (see guide-pairings.md)

## Ecosystem Guides (Load if applicable)

- `node-typescript.md` (2.5K) — Node.js + TypeScript patterns
- `react-webapp.md` (2.8K) — React patterns

**Load only when working in that stack.**
