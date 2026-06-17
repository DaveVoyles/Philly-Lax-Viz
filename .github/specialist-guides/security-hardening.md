---
title: "Security Hardening Guide"
description: "Secrets management, authentication/authorization, input validation, OWASP, API security, compliance"
version: "1.0"
lastUpdated: "2026-06-16"
---

[← Back to primary instructions: `.github/copilot-instructions.md`]

## Secrets Management

### The Golden Rule
**Never commit secrets to git.** Ever.

### Secret Types & Storage
| Type | Examples | Storage | Rotation |
|------|----------|---------|----------|
| **Credentials** | API keys, OAuth tokens, database passwords | Secrets Manager (AWS, Azure, 1Password) | Every 90 days |
| **Encryption Keys** | Database encryption, message signing | HSM or Key Vault (never code) | After key compromise |
| **Certificates** | TLS/SSL, code signing | Certificate authority, auto-renewal | Before expiration (30 days) |
| **Tokens** | JWT, session tokens, API tokens | Secrets Manager with short TTL | Minutes to hours |

### Environment Variables
```bash
# ✅ GOOD: Use env vars, never commit
export DB_PASSWORD="$(aws secretsmanager get-secret-value --secret-id prod/db --query SecretString --output text)"
export API_KEY="$(vault kv get -field=value secret/api-key)"

# ❌ BAD: Committed to git
DB_PASSWORD="super_secret_123"  # Exposed forever
```

### Secrets Rotation Strategy
```
Daily:  Short-lived tokens (JWT, session tokens)
Weekly: API credentials, database passwords
Monthly: TLS certificates (automated)
Every 90 days: Long-lived credentials, master keys
```

### Secret Scanning
```bash
# Scan for accidentally committed secrets
git-secrets --scan
truffleHog --entropy=True .

# Prevent commits with secrets
git-secrets --install
git-secrets --register-aws
```

---

## Authentication (AuthN)

### Authentication Methods

**OAuth 2.0 (User Authorization)**
- ✅ Industry standard, secure delegation
- ✅ Third-party provider (Google, GitHub, Microsoft)
- ✅ User never gives password to your app
- ❌ Complexity, external dependency
- Use for: Public-facing apps, social login

**JWT (JSON Web Tokens)**
- ✅ Stateless, scalable, good for APIs
- ✅ Self-contained (claim validation)
- ⚠️ No built-in revocation (use blacklist or short TTL)
- Use for: API authentication, microservices

**Session-Based (Traditional)**
- ✅ Built-in, familiar, revocation easy
- ✅ Server controls session state
- ❌ Scaling requires sticky sessions or shared store
- Use for: Monolithic web apps, traditional servers

**SAML 2.0**
- ✅ Enterprise standard, robust
- ⚠️ Complex, XML-heavy
- Use for: Enterprise B2B, SSO

### Implementation Best Practices

**Password Hashing:**
```python
# ✅ GOOD: Strong hashing with salt
import bcrypt
password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))

# ❌ BAD: Plain text
password_hash = hashlib.sha256(password.encode()).hexdigest()  # Reversible with rainbow tables

# ❌ BAD: Weak hashing
password_hash = hashlib.md5(password.encode()).hexdigest()  # Broken, too fast
```

**Token Expiration & Refresh:**
```
Access token (JWT):  15 minutes (short-lived, low risk if stolen)
Refresh token:       7 days (long-lived, rotate on use)

On token expiration:
1. Client sends refresh token
2. Server validates refresh token
3. Server issues new access token (no re-login needed)
4. Refresh token invalidated (single-use or rotate)
```

**Multi-Factor Authentication (MFA):**
- ✅ Required for: Admin accounts, service accounts, critical operations
- ✅ Methods: TOTP (Time-based OTP, e.g., Google Authenticator), SMS, hardware keys
- ⚠️ SMS is weaker than TOTP (SIM swapping risk)
- Enforce: Especially for cloud accounts, databases, production access

---

## Authorization (AuthZ)

### Access Control Models

**RBAC (Role-Based Access Control)**
```
User → Role → Permissions
    admin     [create, read, update, delete]
    user      [read]
    guest     []

Pros: Simple, fast to implement
Cons: Limited flexibility (can't express complex rules)
```

**ABAC (Attribute-Based Access Control)**
```
Decision: Can user=john perform action=delete on resource=order if time < 17:00?

Attributes:
  User: (name, department, clearance)
  Resource: (owner, sensitivity, type)
  Action: (name, risk_level)
  Context: (time, ip_address, location)

Rule Engine evaluates all attributes
Pros: Flexible, fine-grained
Cons: Complex, slow if not optimized
```

**Least Privilege Principle**
- Grant minimum required permissions
- Default deny (user must explicitly have permission)
- Regular audits (remove unused permissions)
- Example:
  ```
  ✅ CI/CD service account: Deploy to specific service only, not admin
  ✅ Database user: Read from specific tables, not DROP permissions
  ❌ Developer: Full production access (security risk)
  ```

---

## Input Validation & Injection Prevention

### Validation Types

**Whitelist (Recommended)**
```python
# ✅ GOOD: Only allow known-good patterns
allowed_statuses = ['pending', 'approved', 'rejected']
if status not in allowed_statuses:
    raise ValueError(f"Invalid status: {status}")
```

**Blacklist (Avoid)**
```python
# ❌ BAD: Hard to enumerate all bad inputs
blocked_chars = ['<', '>', '"', "'"]
if any(char in user_input for char in blocked_chars):
    raise ValueError("Invalid characters")
# Attacker finds: encoded, unicode, new variants
```

### SQL Injection Prevention
```python
# ❌ BAD: String concatenation
query = f"SELECT * FROM users WHERE email = '{email}'"  # Vulnerable

# ✅ GOOD: Parameterized queries
query = "SELECT * FROM users WHERE email = %s"
cursor.execute(query, (email,))  # Parameter binding, safe
```

### Cross-Site Scripting (XSS) Prevention
```html
<!-- ❌ BAD: Unescaped user input -->
<p>Welcome, {{ user_input }}</p>  <!-- User enters: <script>alert('xss')</script> -->

<!-- ✅ GOOD: HTML-escaped output -->
<p>Welcome, {{ user_input | escape }}</p>  <!-- Renders: &lt;script&gt;...&lt;/script&gt; -->
```

### CSRF (Cross-Site Request Forgery) Prevention
```html
<!-- ✅ GOOD: CSRF token in form -->
<form method="POST" action="/transfer">
  <input type="hidden" name="csrf_token" value="{{ csrf_token }}">
  <input type="text" name="amount">
  <button type="submit">Transfer</button>
</form>

<!-- Server validates token matches session -->
```

---

## API Security

### Rate Limiting
```
Limit: 100 requests per minute per API key

Implementation:
- Count requests in sliding window
- Return 429 (Too Many Requests) when exceeded
- Provide Retry-After header

Pricing impact: Prevents abuse, protects infrastructure
```

### API Key Management
```python
# ✅ GOOD: API key + secret validation
api_key = request.headers.get('X-API-Key')
api_secret = request.headers.get('X-API-Secret')
validate_api_key(api_key, api_secret)  # Both required, secret never sent in URL

# ❌ BAD: API key only in URL
GET /api/data?api_key=abc123  # Logged in proxies, browser history
```

### API Versioning & Deprecation
```
# v1 - Deprecated (Dec 2026)
GET /api/v1/users

# v2 - Current (supports both v1 and v2 clients)
GET /api/v2/users

# v3 - New (with breaking changes)
GET /api/v3/users

Deprecation timeline:
  - v1 deprecated: July 2026
  - v1 sunset: Dec 2026 (removed)
  - Migration guide provided: 6 months notice
```

### Secure API Communication
- ✅ **HTTPS only:** TLS 1.2+, no HTTP
- ✅ **Certificate pinning:** (Optional) Pin server cert in mobile apps
- ✅ **HSTS header:** Force HTTPS for all future requests
- ✅ **No sensitive data in URLs:** Use POST body instead

---

## OWASP Top 10 (2021)

| # | Risk | Example | Prevention |
|---|------|---------|-----------|
| 1 | Broken Access Control | Can access other user's data | RBAC, ABAC, verify ownership |
| 2 | Cryptographic Failures | Passwords stored plaintext | Hash + salt, TLS, encryption at rest |
| 3 | Injection | SQL injection via user input | Parameterized queries, input validation |
| 4 | Insecure Design | No auth for sensitive endpoints | Threat modeling, secure by design |
| 5 | Security Misconfiguration | Default credentials, verbose errors | Hardening, minimal exposure, error sanitization |
| 6 | Vulnerable Components | Old library with known CVE | Dependency scanning, regular updates |
| 7 | Auth Failures | Weak password policy, no MFA | Strong hashing, MFA, session timeouts |
| 8 | Data Integrity Failures | Unsigned JWTs, insecure updates | Sign tokens, verify signatures, secure delivery |
| 9 | Logging & Monitoring Failures | No audit trail, can't detect attacks | Comprehensive logging, alerting, retention |
| 10 | SSRF (Server-Side Request Forgery) | Internal network access via user request | Validate URLs, block internal ranges, firewall |

---

## Dependency Security

### Vulnerability Scanning
```bash
# Scan for known vulnerabilities
npm audit
pip install safety && safety check
cargo audit
go list -json -m all | nancy sleuth

# In CI/CD: Fail build on high/critical
```

### Dependency Update Strategy
```
Critical (CVE):  Update within 24-48 hours
High:            Update within 1 week
Medium:          Update within 2 weeks
Low:             Update within monthly cycle

Always test before updating (breaking changes possible)
```

### Lock Files
```
✅ package-lock.json, poetry.lock, Gemfile.lock
   Commit to git, ensures reproducible builds
   Update only intentionally, review changes
```

---

## Audit Logging & Compliance

### What to Log
```
✅ Authentication events (login, logout, MFA)
✅ Authorization changes (permission grant/revoke)
✅ Data access (who read/wrote what, when)
✅ Configuration changes (infrastructure, code)
✅ Sensitive operations (delete, export, transfer)
✅ Failed attempts (login failures, permission denied)

❌ Passwords, tokens, encryption keys
❌ Verbose debug logs in production
```

### Log Format
```json
{
  "timestamp": "2026-06-16T22:45:30Z",
  "user_id": "u123",
  "action": "data_export",
  "resource": "customers_table",
  "result": "success",
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0..."
}
```

### Retention & Analysis
- **Retention:** Keep 90+ days (regulatory compliance)
- **Immutable storage:** Write-once, read-many (WORM)
- **Analysis:** Run automated checks for anomalies (unusual access patterns)
- **Alerting:** High-risk actions trigger immediate alert

---

## Security Checklist

- ✅ No secrets committed to git (secret scanning enabled)
- ✅ Secrets rotated every 90 days
- ✅ TLS/HTTPS for all communication
- ✅ Passwords hashed with bcrypt (or better)
- ✅ MFA required for admin/sensitive accounts
- ✅ RBAC or ABAC configured and tested
- ✅ Input validation and output encoding in place
- ✅ SQL injection prevention (parameterized queries)
- ✅ XSS prevention (HTML escaping)
- ✅ CSRF tokens on state-changing requests
- ✅ API rate limiting configured
- ✅ Dependency vulnerability scanning in CI/CD
- ✅ Audit logging enabled for sensitive operations
- ✅ Security headers set (HSTS, CSP, X-Frame-Options)
- ✅ Error messages don't leak sensitive info
- ✅ Regular security audits and penetration testing

---

**Version:** 1.0  
**Last Updated:** June 16, 2026  
**Related:** `.github/specialist-guides/checklists.md` (Security & Auth), `.github/specialist-guides/deployment-infrastructure.md` (Secrets in CI/CD)
