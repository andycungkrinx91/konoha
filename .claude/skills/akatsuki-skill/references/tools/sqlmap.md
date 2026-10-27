# SQLMap Database Injection Scanner Reference

SQLMap is an open-source penetration testing tool that automates the process of detecting and exploiting SQL injection flaws and taking over database servers. Within Akatsuki, it operates in detection-only and non-destructive verification mode.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/sqlmap` (+ `https://www.skills.sh/agentsecops/secopsagentkit/webapp-sqlmap`)
- Kali Linux Official: `https://www.kali.org/tools/sqlmap/`

## When to Use
- SQL Injection Vulnerability Verification: test suspected query parameters for SQL injection (Boolean-based, error-based, UNION query, time-based blind).
- Parameter Sanitization Auditing: confirm whether ORM and raw SQL query builders properly parameterize user input.
- Database Fingerprinting: determine DBMS type and version without modifying or dropping data.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `sqlmap`
- Target Scoping: Default `http://127.0.0.1:8080/api/items?id=1`
- Safety Class: `vulnerability_audit`
- Timeout: 45000ms
- Evidence Outputs: `/tmp/akatsuki_sqlmap.json`, `/tmp/akatsuki_sqlmap.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_sqlmap.*`, terminate lingering `sqlmap` processes

## Command Patterns
```bash
# 1. Non-destructive SQL injection detection with batch confirmation
sqlmap -u "http://127.0.0.1:8080/api/items?id=1" --batch --banner --level=1 --risk=1 -o /tmp/akatsuki_sqlmap.txt

# 2. Test specific parameter in JSON API POST body
sqlmap -u "http://127.0.0.1:3000/api/search" --data='{"query":"test"}' --headers="Content-Type: application/json" -p query --batch

# 3. Fast boolean and error-based injection check
sqlmap -u "http://127.0.0.1:8080/user?id=1" --batch --technique=BE --output-dir=/tmp/sqlmap_out
```

## Fail-Closed Notes
- Destructive operations (`--os-shell`, `--sql-shell`, `--drop-table`, `--os-pwn`) are strictly forbidden.
- Fails closed if container network isolation is compromised.
