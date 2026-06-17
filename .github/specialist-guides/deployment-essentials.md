---
title: "Deployment Essentials (Quick Reference)"
description: "Minimal deployment guidance — pre-flight checklist for production pushes"
version: "1.0"
parent: "deployment-infrastructure.md"
---

## Pre-Flight Deployment Checklist (30-Minute Review)

Run these **before** you push to production:

### Code & Tests
- [ ] All tests passing locally AND in CI
- [ ] Code reviewed and approved (2 eyes minimum)
- [ ] No TODO/FIXME comments left in critical paths
- [ ] No debug console.log statements
- [ ] No secrets in code, config, or environment

### Database & Migration
- [ ] Migration tested on staging DB (can be undone)
- [ ] Rollback plan documented (SQL to undo schema change)
- [ ] Backup taken (snapshot of DB before migration)
- [ ] No breaking schema changes without dual-write period

### Configuration & Secrets
- [ ] All environment variables set in production
- [ ] Secrets loaded from vault (not hardcoded, not in .env file)
- [ ] Config matches actual production environment
- [ ] Feature flags set correctly (new feature turned off until verified)

### Monitoring & Rollback
- [ ] Dashboards created (latency, error rate, memory)
- [ ] Alerts configured (error rate > 1%, latency p99 > 500ms)
- [ ] Rollback plan written (which command/button to press)
- [ ] Team on call for 30 minutes post-deployment

### Go/No-Go Decision
- [ ] All checkboxes above: ✅
- [ ] Timeline: outside of peak traffic? ✅
- [ ] **Decision: GREEN (deploy) or RED (hold)**

---

## Deployment Strategies (Pick One)

### Blue-Green (Safest for critical systems)
```
1. Deploy to unused server (green)
2. Run smoke tests on green
3. Switch traffic to green
4. Keep blue as instant rollback
Rollback: Switch traffic back to blue (instant)
```

### Canary (Good for most apps)
```
1. Deploy to 1 server (5% of traffic)
2. Monitor error rate, latency
3. If good, expand to 25%, then 100%
Rollback: Route traffic back to old version (instant)
```

### Rolling (Most common for many servers)
```
1. Take 1 server out of load balancer
2. Deploy new version to that server
3. Run health checks
4. Add back to load balancer
5. Repeat for next server
Rollback: Re-deploy old version to affected servers
```

---

## If Something Goes Wrong

**Error rate spiking?**
1. Check dashboards (what changed?)
2. Check logs (what's the error?)
3. Check if related to this deployment (check timestamps)
4. If related: **ROLLBACK IMMEDIATELY**
5. Investigate in non-prod (staging) after

**Rollback command:**
```bash
# Most common: re-deploy old version
kubectl rollout undo deployment/api

# Or manually: revert to previous config
git revert <commit-hash>
git push main
# Wait for CI to deploy old version
```

---

## Post-Deployment (First 30 Minutes)

- [ ] Error rate: < 1% ✅
- [ ] Latency p99: < 500ms ✅
- [ ] New feature working: test critical path ✅
- [ ] No alerts firing ✅
- [ ] Team reviewing logs continuously ✅

**After 30 minutes:** Likely safe. Monitor for next 2 hours anyway.

---

**Use Full Guide For:** CI/CD pipeline design, containerization, infrastructure as code, disaster recovery  
**Full Guide:** `.github/specialist-guides/deployment-infrastructure.md`
