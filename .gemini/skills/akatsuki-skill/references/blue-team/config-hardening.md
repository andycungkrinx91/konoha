# Secure Configuration & Hardening Audit Reference

The Secure Configuration and Hardening Audit workflow evaluates container configurations, network port listeners, file permissions, web server options, and authentication mechanisms for security compliance.

## Source
- Primary: `https://www.skills.sh/agentsecops/secopsagentkit/detection-sigma`
- Reference: `src/workflow/akatsuki/blue_workflows.js` (Phase 6)

## When to Use
- Production Deployment Verification: verify default web auth passwords, cookie settings, and session timeouts.
- Container & Sandbox Hardening: audit Dockerfile security options (`no-new-privileges`, `cap-drop=ALL`).
- Network Listener Auditing: ensure administrative APIs and bridges bind strictly to `127.0.0.1` rather than public interfaces.

## Key Hardening Controls
1. Local Binding Invariant: Services (Web UI port 1404, LLM Bridge Gateway port 19999) must bind strictly to `127.0.0.1`.
2. Timing-Safe Auth Verification: Web auth tokens and tunnel PINs must be validated using constant-time comparisons (`crypto.timingSafeEqual`) to prevent timing attacks.
3. Memory-Hard Password Hashing: User passphrases use Argon2id with 64MB memory cost, 3 iterations, and 4 lanes.
4. HTTP Security Headers: Content-Security-Policy, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, and Strict-Transport-Security.

## Audit Workflow
```bash
# 1. Verify loopback port binding
node -e "const net = require('net'); /* verify local listeners */"

# 2. Run security baseline checks
node tests/test_security_baseline.js
```

## Fail-Closed Notes
- Listening on public interfaces (`0.0.0.0`) without tunnel PIN protection constitutes a critical delivery blocker.
