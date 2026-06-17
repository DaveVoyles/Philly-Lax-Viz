---
title: "Security Quick Scan"
description: "200-token checklist: OWASP Top 3 security vulnerabilities"
version: "1.0"
---

## 5-Minute Security Scan

Run this checklist before code review:

### SQL Injection (Concatenating SQL strings)
```
❌ SELECT * FROM users WHERE id = ${userId}
✅ SELECT * FROM users WHERE id = $1 (parameterized)
```
**Scan:** grep for string concatenation in SQL queries  
**Fix:** Use parameterized queries / prepared statements

---

### XSS (Showing user input without escaping)
```
❌ <div>{userComment}</div> (if userComment has HTML)
✅ Use framework escaping: React escapes by default
```
**Scan:** grep for innerHTML (not textContent)  
**Fix:** Let framework handle escaping, or use sanitizer

---

### Broken Auth (Missing permission checks)
```
❌ app.get('/api/admin', handler) — no auth check
✅ app.get('/api/admin', requireRole('admin'), handler)
```
**Scan:** Find all `/api/` routes, verify each has auth  
**Fix:** Add auth middleware to protected routes

---

## Quick Audit (3 minutes)

```bash
# Grep for common issues:
grep -r "SELECT.*\${" src/        # SQL injection risk
grep -r "innerHTML" src/          # XSS risk
grep -r "password\|secret\|key" . # Secrets in code
grep -r "hardcoded.*[a-zA-Z0-9]{20}" src/ # API keys

# Check for common mistakes:
npm audit                         # Vulnerable dependencies
git secrets scan --all            # Leaked credentials
```

---

## Three Must-Haves

- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated (whitelist, not blacklist)
- [ ] All sensitive operations require auth check

---

✅ **Use this card when:** Quick security review before merging  
📖 **Use full guide when:** Need OWASP Top 10, GDPR, compliance details  
📍 **Location:** `.github/quick-refs/security-quick-scan.md`
