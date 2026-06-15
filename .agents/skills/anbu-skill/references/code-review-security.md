# Security Code Review Playbook

> Read when: user asks for secure code review, vulnerability review, OWASP-style code audit, or remediation guidance.

## Contents

- When to use
- Severity format
- Review workflow
- Authentication review
- Authorization review
- Input validation
- Output encoding / XSS
- SQL/NoSQL injection
- Command injection
- SSRF
- Insecure file uploads
- Secrets exposure
- Insecure CORS
- CSRF (where relevant)
- Dependency and supply-chain risk
- IDOR/BOLA checks
- Rate limiting and abuse prevention
- Logging and telemetry safety
- Infrastructure / CI/CD review notes
- Cloud / IAM review notes
- Concrete fix examples
- Final checklist

## When to Use

Use this reference for:
- PR security reviews and secure coding audits.
- API/backend vulnerability assessment at code level.
- Incident follow-up reviews to prevent recurrence.
- "Find and fix security bugs" requests in application code.

## Severity Format

Use this format for each finding:

`[Severity] Title`  
`Location:` file + function + line(s)  
`Impact:` what attacker can do  
`Exploitability:` preconditions and ease  
`Evidence:` safe repro / code snippet  
`Fix:` concrete patch guidance  
`Validation:` tests to prove mitigation

Severity levels:
- **Critical**: immediate compromise risk (RCE, auth bypass to admin, sensitive data exfiltration at scale).
- **High**: major impact with realistic exploitation (IDOR on sensitive records, SQLi with broad read/write).
- **Medium**: meaningful security weakness requiring additional conditions.
- **Low**: limited impact or hard-to-exploit issue.
- **Informational**: security hygiene gaps, hardening improvements.

## Review Workflow

1. Map entry points: HTTP, queues, cron, webhooks, admin tooling.
2. Trace trust boundaries: user input, partner input, internal services, data stores.
3. Review authn/authz first, then injection classes, then data protection.
4. Validate likely issues using safe payloads and unit/integration tests.
5. Propose minimum-risk fixes with explicit regression tests.

## Authentication Review

Check for:
- Weak password/session/token handling.
- Missing MFA enforcement for privileged operations.
- Insecure token validation (`alg=none`, missing issuer/audience checks).
- Session fixation or missing session rotation after login.
- Insecure cookie flags (`HttpOnly`, `Secure`, `SameSite`).

## Authorization Review

Check for:
- Missing object-level checks (IDOR/BOLA).
- Role checks in UI only (must enforce server-side).
- Overbroad admin/service roles.
- Tenant isolation violations in multi-tenant apps.
- Missing policy checks on background jobs and async handlers.

## Input Validation

Require:
- Schema validation at API boundary (type, format, length, bounds).
- Allowlist validation for enum-like fields and dynamic sort/filter keys.
- Canonicalization before validation where needed.
- Reject unknown fields for sensitive endpoints.

## Output Encoding / XSS

Check for:
- Unescaped user content rendered in HTML/JS contexts.
- Unsafe templating helpers or `dangerouslySetInnerHTML` patterns.
- Missing CSP where browser-rendered rich content exists.
- Untrusted Markdown/HTML rendering without sanitizer.

## SQL / NoSQL Injection

Check for:
- String-concatenated queries and dynamic operators.
- Unsanitized filters in ORM/ODM query builders.
- Direct use of user input in regex/operator objects.

Required fixes:
- Parameterized/prepared statements.
- Typed validation and operator allowlists.
- Block raw query features unless explicitly justified and guarded.

## Command Injection

Check for:
- Shell command construction with raw input.
- Unsafe `exec` variants where no shell is required.
- Path traversal in command/file arguments.

Required fixes:
- Prefer native library/API over shell invocation.
- Use argument arrays, strict allowlists, and path normalization.

## SSRF

Check for:
- User-controlled URLs fetched by backend services.
- Lack of DNS/IP validation and internal network blocking.
- Redirect-following to untrusted destinations.

Required fixes:
- URL allowlist by host/scheme/port.
- Block private/meta-data ranges and link-local addresses.
- Enforce outbound egress controls.

## Insecure File Uploads

Check for:
- Extension-only checks.
- No MIME/magic-number verification.
- Direct execution/public serving of uploaded content.

Required fixes:
- Validate size/type/content; store outside executable paths.
- Rename files, strip metadata where needed, scan for malware.
- Use signed URLs and short-lived access policies.

## Secrets Exposure

Check for:
- Hardcoded credentials, tokens, private keys.
- Secrets in logs, error traces, and CI artifacts.
- Insecure default configs committed to source.

Required fixes:
- External secret manager + rotation policy.
- Redaction filters for logs and tracing.
- Repo scanning gates for secret patterns.

## Insecure CORS

Check for:
- `*` origin with credentials.
- Dynamic origin reflection without allowlist.
- Overbroad methods/headers exposed to browsers.

Required fixes:
- Explicit origin allowlist.
- Restrict credentialed routes and methods.

## CSRF (Where Relevant)

Apply when using browser cookies/sessions:
- CSRF tokens on state-changing requests.
- SameSite cookie policy and origin/referer checks.
- Avoid GET for mutating operations.

## Dependency / Supply-Chain Risk

Check for:
- Known CVEs in direct/transitive dependencies.
- Unpinned/high-risk packages and scripts.
- Unverified build artifacts.

Required fixes:
- SCA scanning in CI, version pinning policy, signed artifacts/SBOM where feasible.

## IDOR / BOLA Checks

For every endpoint using identifiers:
- Verify ownership/tenant access after lookup, not before.
- Avoid predictable identifiers where unnecessary.
- Add tests for cross-tenant object access attempts.

## Rate Limiting / Abuse Prevention

Check for:
- No throttling on login/reset/token endpoints.
- No anti-automation for expensive operations.
- Missing circuit breakers for burst abuse.

Required fixes:
- Per-IP + per-account limits, exponential backoff, lockouts with safe recovery.

## Logging Sensitive Data

Ensure:
- Structured logs avoid tokens/passwords/full PII.
- Debug logs disabled in production.
- Security events are logged with traceable request/context IDs.

## Infrastructure / CI/CD Notes

During code review, also confirm:
- Secrets are injected securely in pipelines (OIDC, vault, no long-lived static keys).
- Build/release gates block critical findings.
- Runtime container settings are hardened (non-root, minimal perms).

## Cloud / IAM Notes

Confirm:
- Service identities use least privilege.
- No wildcard permissions without documented necessity.
- App code does not assume over-privileged cloud roles.

## Concrete Fix Examples

**SQL injection (unsafe)**
```js
const q = `SELECT * FROM users WHERE email = '${email}'`;
```
**Fix**
```js
const q = 'SELECT * FROM users WHERE email = ?';
db.execute(q, [email]);
```

**Missing object authorization (unsafe)**
```ts
return orderRepo.findById(orderId);
```
**Fix**
```ts
const order = await orderRepo.findById(orderId);
if (!order || order.tenantId !== ctx.tenantId) throw new ForbiddenError();
return order;
```

**Command injection (unsafe)**
```python
os.system(f"tar -czf out.tgz {user_path}")
```
**Fix**
```python
subprocess.run(["tar", "-czf", "out.tgz", safe_path], check=True)
```

## Final Checklist

- [ ] Findings include severity, impact, exploitability, and precise location.
- [ ] Authn/authz and IDOR/BOLA paths were explicitly reviewed.
- [ ] Injection classes (SQL/NoSQL/command/XSS/SSRF) were reviewed with safe repro.
- [ ] Secrets exposure, CORS/CSRF, and sensitive logging were checked.
- [ ] Dependency/supply-chain and CI/CD security controls were reviewed.
- [ ] Cloud/IAM implications were noted for affected code paths.
- [ ] Every finding includes concrete remediation and validation steps.
