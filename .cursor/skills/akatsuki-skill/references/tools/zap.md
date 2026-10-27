# OWASP ZAP (Zed Attack Proxy) Reference

OWASP ZAP (Zed Attack Proxy) is a widely used open-source web application security scanner. Within Akatsuki, ZAP provides automated baseline and passive/active scanning for OWASP Top 10 web vulnerabilities.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/owasp-zap` (+ `https://www.skills.sh/agentsecops/secopsagentkit/dast-zap`)
- Kali Linux Official: `https://www.kali.org/tools/zaproxy/`

## When to Use
- Automated Web Application DAST: audit web interfaces and APIs against OWASP Top 10 vulnerability categories.
- Security Header & Cookie Auditing: verify Content-Security-Policy, HSTS, X-Frame-Options, and SameSite flags.
- Passive & Baseline Scanning: analyze traffic passively without modifying application state.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `zap.sh`, `zap-baseline.py`, `zap-api-scan.py`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `vulnerability_audit`
- Timeout: 60000ms
- Evidence Outputs: `/tmp/akatsuki_zap.json`, `/tmp/akatsuki_zap.html`
- Cleanup Steps: Remove `/tmp/akatsuki_zap.*`, terminate lingering ZAP daemon processes

## Command Patterns
```bash
# 1. Fast baseline scan of web target with JSON report
zap-baseline.py -t http://127.0.0.1:8080 -J /tmp/akatsuki_zap.json

# 2. OpenAPI / Swagger API schema security scan
zap-api-scan.py -t http://127.0.0.1:8080/api/v1/swagger.json -f openapi -J /tmp/akatsuki_zap.json

# 3. Quick command-line scan with rule ignore and warning threshold
zap-baseline.py -t http://127.0.0.1:3000 -I -m 2 -J /tmp/akatsuki_zap.json
```

## Fail-Closed Notes
- Deep active attack scans (`zap-full-scan.py`) are gated by red-team standing authorization.
- Host-level execution is blocked; container sandbox execution is mandatory.
