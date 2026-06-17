---
title: "Pre-Flight Deployment Checklist"
description: "200-token go/no-go decision tree: is this safe to deploy?"
version: "1.0"
---

## Deploy Checklist (5-Minute Review)

Quick answer: ✅ All these items need to be GREEN

### Tests & Code
- [ ] All tests passing (locally + CI)
- [ ] Code reviewed (2+ eyes)
- [ ] No debug code left in codebase
- [ ] No secrets in code/config

### Data & Rollback
- [ ] Database migration tested on staging
- [ ] Rollback plan documented (specific SQL/command)
- [ ] Database backup taken
- [ ] Can undo schema change safely

### Operations
- [ ] Environment variables set in production
- [ ] Secrets in vault (not in code/files)
- [ ] Monitoring dashboards ready
- [ ] Alerts configured (error rate, latency)
- [ ] Team on call for 30 minutes

---

## Deployment Decision Tree

```
All checklist items ✅ ?
│
├─ NO  → DO NOT DEPLOY
│       Fix the RED items first
│
├─ YES → Outside peak traffic? (morning, after 2pm)
│       │
│       ├─ NO  → WAIT for low-traffic window
│       │
│       └─ YES → GREEN LIGHT
│               Deploy using blue-green or canary
│               Monitor error rate for 30 min
│               Post-deploy: Check dashboards continuously
```

---

## Rollback (If things go wrong)

**Error rate > 1%?**  
→ Rollback immediately (revert git commit, redeploy old version)

**Latency spike?**  
→ Rollback immediately

**New feature broken?**  
→ Rollback immediately (investigate in staging later)

---

✅ **Use this card when:** About to deploy to production  
📖 **Use full guide when:** Setting up CI/CD pipeline or deployment strategies  
📍 **Location:** `.github/quick-refs/pre-flight-deployment.md`
