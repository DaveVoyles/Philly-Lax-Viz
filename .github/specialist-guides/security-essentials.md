---
title: "Security Essentials (Quick Reference)"
description: "Minimal security guidance for quick audits and implementation — focus on OWASP Top 3"
version: "1.0"
parent: "security-hardening.md"
---

## The Big 3: OWASP Top Issues (90% of breaches)

### 1. SQL Injection — Concatenating user input into SQL
```
❌ WRONG:  `SELECT * FROM users WHERE id = ${userId}`
✅ RIGHT:  `SELECT * FROM users WHERE id = $1` (parameterized)
```

### 2. XSS — Showing user input without escaping
```
❌ WRONG:  `<div>${userComment}</div>` (if comment is "alert('hacked')")
✅ RIGHT:  Use template escaping or sanitizer library
```

### 3. Broken Auth — Weak or missing authentication
```
❌ WRONG:  No auth check before accessing /api/admin
✅ RIGHT:  Verify JWT token / session before every protected route
```

---

## Secrets: The Quick Checklist

- [ ] No passwords in `.env` file checked into git (use vault/AWS Secrets Manager)
- [ ] `.env` file in `.gitignore`
- [ ] No API keys in code comments or logs
- [ ] Secrets rotated every 90 days (set calendar reminder)
- [ ] CI/CD uses different secrets than production
- [ ] Debug logs don't print tokens/passwords

**Quick Scan:** `grep -r "password\|api_key\|secret" src/` — should return NOTHING

---

## Input Validation: Three Rules

1. **Never trust user input** — All data from users, APIs, files is malicious until proven otherwise
2. **Validate early** — Check at entry point (API handler, form submission)
3. **Whitelist, don't blacklist** — `if (allowedValues.includes(input))` not `if (!maliciousPatterns.test(input))`

**Examples:**
- Email: Use email regex or library, not just "has @"
- Phone: Accept only digits, dash, space; strip the rest
- URL: Use URL parser, not regex
- User IDs: Must be alphanumeric, exact length 32

---

## Quick Audit Checklist

Run before shipping anything:

- [ ] Secrets scan: `git secrets scan --all`
- [ ] Dependency audit: `npm audit` or `pip audit`
- [ ] SAST scan: Run Snyk/SonarQube locally
- [ ] Permission check: `/admin` routes require admin role
- [ ] Password policy: Min 8 chars, bcrypt hashed, no plaintext storage
- [ ] Rate limiting: API endpoints have rate limits to prevent brute force
- [ ] Error messages: Don't reveal system info ("user not found" vs "invalid credentials")

---

**Use Full Guide For:** OWASP Top 10 (all 10), GDPR/compliance, audit logging, OAuth patterns  
**Full Guide:** `.github/specialist-guides/security-hardening.md`
