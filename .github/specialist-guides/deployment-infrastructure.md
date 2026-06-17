---
title: "Deployment & Infrastructure Guide"
description: "CI/CD pipelines, containerization, IaC, blue-green deployments, rollbacks, disaster recovery"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## CI/CD Pipeline Architecture

### Pipeline Stages
```
1. Trigger (push/PR) 
   ↓
2. Build & Test (unit + integration)
   ↓
3. Lint & Security Scan (SAST, dependencies)
   ↓
4. Artifact Build (Docker, JAR, binary)
   ↓
5. Staging Deploy (test integration)
   ↓
6. Production Gate (approval, canary)
   ↓
7. Production Deploy
   ↓
8. Smoke Tests & Monitoring
```

### Failure Handling
- **Early stages (build, lint):** Fail fast, don't proceed
- **Security scans:** Critical/High = block; Medium = warn
- **Integration tests:** All tests must pass
- **Production deploy:** Manual approval gate required

### Secrets Management in CI
- **Never in code:** No API keys, credentials, tokens in git
- **Use secrets manager:** GitHub Secrets, Azure Key Vault, AWS Secrets Manager
- **Scope narrowly:** CI secret only has permission for deployment, not admin
- **Rotate regularly:** Every 90 days or on team changes

---

## Containerization (Docker)

### Dockerfile Best Practices

**Multi-stage builds (reduce image size):**
```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --only=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Minimal base images:**
- ✅ `alpine` (5-10MB) — Fastest for small services
- ✅ `distroless` (Google's) — Secure, minimal, no shell
- ⚠️ `debian:bullseye` (100MB+) — Use only if needed
- ❌ `ubuntu` (70MB+) — Often unnecessary bloat

**Layer caching:**
```dockerfile
# Order: stable → frequently changing
FROM python:3.11-alpine
RUN apk add --no-cache postgresql-client  # Stable, cached

WORKDIR /app
COPY requirements.txt .                    # Stable, cached
RUN pip install -r requirements.txt

COPY . .                                   # Changes frequently, uncached
CMD ["python", "app.py"]
```

### Container Registry Strategy
- **Private registry:** Docker Hub, GitHub Container Registry (GHCR), ECR, Artifact Registry
- **Image tagging:** `latest`, semantic version (`v1.2.3`), git SHA (`abc123def`)
- **Retention policy:** Keep last 10 releases; delete old images after 90 days
- **Scanning:** Scan all images for vulnerabilities on push

---

## Infrastructure as Code (IaC)

### Tool Selection
| Tool | Best For | Learning Curve |
|------|----------|-----------------|
| **Terraform** | Multi-cloud, complex infrastructure | Medium |
| **CloudFormation** | AWS-only, native integration | Medium-High |
| **Kubernetes YAML** | Container orchestration | Low (basic), High (advanced) |
| **Ansible** | Configuration management, imperative | Low |
| **Pulumi** | Code-driven IaC (Python, Go, etc.) | Medium |

### Version Control Everything
```
infra/
  terraform/
    variables.tf
    main.tf
    outputs.tf
  k8s/
    deployments/
    services/
    configmaps/
  ansible/
    playbooks/
    roles/
```

**Never manual:** All infrastructure changes → code → PR → CI validation → merge → deploy

### Environment Parity
```
dev/ → staging/ → production/   (use same code, different variables)

# Variables differ, but code is identical
terraform/
  environments/
    dev/
      variables.tfvars       # dev settings
    staging/
      variables.tfvars       # staging settings
    production/
      variables.tfvars       # prod settings (most restrictive)
```

---

## Deployment Strategies

### Blue-Green Deployment
```
Before:     After:              Rollback:
Blue ✅     Blue (old) ⚫        Blue ✅
Green       Green ✅ (traffic)   Green (discarded)

• Deploy to Green without traffic
• Run smoke tests on Green
• Switch traffic from Blue → Green
• Keep Blue running for 1-2h in case rollback needed
• Cost: 2× compute (temporary), safest rollback
```

### Canary Release
```
Current:    Phase 1:           Phase 2:            Complete:
100% V1     90% V1, 10% V2     50% V1, 50% V2     100% V2

• Deploy V2 to small % of users
• Monitor error rate, latency
• If stable, increase % gradually
• If issues, rollback only affected users
• Cost: 1.1× compute (minimal), gradual risk
```

### Rolling Deployment
```
Replica 1: V1 → V2
Replica 2: V1 → V2       (continues serving)
Replica 3: V1 → V2       (no downtime, older version temporarily mixed)

• Kill and restart one instance at a time
• Zero downtime if replicas ≥ 2
• Risk: Mixed versions in flight (test compatibility)
```

### Choosing Strategy
- **Blue-Green:** Critical apps, can afford 2× cost, need instant rollback
- **Canary:** Moderate risk, want gradual rollout, monitor user impact
- **Rolling:** Non-critical services, minimal cost, okay with mixed versions

---

## Rollback Strategies

### Instant Rollback (Blue-Green)
```bash
# Switch traffic back to Blue (v1)
kubectl set selector service/app version=v1
# or
aws elb register-instances-with-load-balancer --instances [blue-instances]

# Timing: <30 seconds
```

### Quick Rollback (Restart Old Version)
```bash
# Keep old image in registry
docker pull myregistry/app:v1.2.3
docker run -d --name app-v1 myregistry/app:v1.2.3

# Reroute traffic to v1 via load balancer
# Timing: 1-2 minutes
```

### Gradual Rollback (Canary Reverse)
```
100% V2 → 90% V2, 10% V1 → ... → 100% V1

# Reduces customer impact, allows monitoring
# Timing: 10-20 minutes
```

### Database Rollback
- **Forward-compatible migrations:** Deploy schema changes before code changes
- **Backward-compatible code:** Old code must work with new schema
- **Example:** Add new column with default, deploy code later
- **Never rollback database directly:** Manual cleanup + data loss risk

---

## Disaster Recovery

### Backup Strategy
- **Daily snapshots:** Full database snapshot
- **Transaction logs:** Continuous backup (WAL archiving, binary logs)
- **Retention:** Keep 30 days of backups, 1 yearly archive
- **Test restores:** Monthly, verify backups are restorable

### RTO & RPO (Recovery Targets)
```
RTO (Recovery Time Objective): How long until we're back online?
  Goal: < 15 minutes (hot standby), < 1 hour (warm standby), < 4 hours (cold)

RPO (Recovery Point Objective): How much data loss is acceptable?
  Goal: < 5 minutes (frequent backups), < 1 hour (hourly), < 24 hours (daily)
```

### Disaster Recovery Plan
```
1. Detection (alert on system down)
2. Assessment (what failed?)
3. Notification (inform stakeholders)
4. Recovery (activate backup infrastructure)
5. Verification (run smoke tests)
6. Communication (update status page)
7. Post-incident review (what went wrong, how to prevent)
```

### Geographic Redundancy
- **Active-active:** Services running in 2+ regions, traffic distributed
- **Active-passive:** Primary region active, secondary dormant (promote on failure)
- **Cost vs. resilience:** Balance between HA and operational complexity

---

## Production Pre-Flight Checklist

Before deploying to production, verify:

- ✅ **Code:** Reviewed, approved, tested in staging
- ✅ **Database:** Schema changes forward-compatible, migration tested
- ✅ **Configuration:** All required env vars set, secrets rotated
- ✅ **Dependencies:** Updated, scanned for vulnerabilities
- ✅ **Monitoring:** Alerts configured, dashboards ready
- ✅ **Rollback:** Plan documented, tested, stakeholders informed
- ✅ **Communication:** Team notified, stakeholders aware, status page ready
- ✅ **Smoke tests:** Run post-deploy to verify health
- ✅ **Load tests:** Baseline performance established, no regressions
- ✅ **Incident response:** On-call engineer aware, incident channels open

---

## Post-Deployment Validation

### Smoke Tests (Immediate)
```
Health checks:
  - Service responds to requests (HTTP 200)
  - Database connection working
  - Dependencies healthy
  - Core endpoints functioning
  
Run in: < 2 minutes
Trigger: Automatically after deployment
Failure: Trigger rollback
```

### Monitoring & Observability
- **Logs:** Check for errors, warnings, unexpected output
- **Metrics:** CPU, memory, request latency, error rate
- **Alarms:** Trigger on: error rate >1%, p95 latency >2s, disk >80%
- **Duration:** Monitor for 30+ minutes (catch cascading failures)

### Gradual Traffic Increase (Canary)
```
t=0min:  1% traffic
t=5min:  5% traffic (check metrics)
t=10min: 25% traffic
t=20min: 100% traffic (all users)

If any metrics spike → immediate rollback
```

---

## Common Deployment Pitfalls

### 🚫 Not Testing the Rollback
```
❌ Deploy to prod without testing rollback procedure
✅ Test rollback in staging environment before prod
✅ Document exact commands to rollback
✅ Have on-call engineer review rollback plan
```

### 🚫 Database Migration Blocking
```
❌ Long-running migration locks table, causing downtime
✅ Use online migrations (no table lock)
✅ Test migration duration on production-sized data
✅ Run critical migrations in maintenance window
```

### 🚫 Forgetting Environment Parity
```
❌ Works in staging, fails in prod (different config)
✅ Identical infrastructure code (terraform, k8s) for all envs
✅ Use environment-specific variables only
✅ Test with prod-like data volume
```

### 🚫 No Canary/Blue-Green Safety Net
```
❌ Deploy to all users at once, catastrophic if broken
✅ Canary to 1-5% first, monitor, then expand
✅ Or blue-green with instant rollback capability
✅ Have alerting in place to detect issues immediately
```

---

## Quick Checklist

- ✅ Pipeline has approval gate before production
- ✅ All secrets managed centrally (never in code)
- ✅ Containers scanned for vulnerabilities on build
- ✅ Blue-green, canary, or rolling strategy chosen
- ✅ Rollback procedure tested and documented
- ✅ Database migrations tested on prod-sized data
- ✅ Monitoring and alerts configured and tested
- ✅ Backup and restore tested monthly
- ✅ Post-deploy smoke tests automated
- ✅ Incident response plan documented (SOP, on-call)

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** `.github/specialist-guides/error-handling.md` (Error recovery), `.github/specialist-guides/checklists.md` (Logging & Observability)
