# Nikto Web Server Scanner Reference

Nikto is an open-source web server scanner that tests web servers for multiple vulnerabilities, including dangerous files, outdated server software, insecure HTTP methods, and configuration flaws.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/nikto` (+ `https://www.skills.sh/agentsecops/secopsagentkit/webapp-nikto`)
- Kali Linux Official: `https://www.kali.org/tools/nikto/`

## When to Use
- Web Server Baseline Auditing: check server headers, HTTP options (TRACE, PUT, DELETE), and cookie flags.
- Default File & Backup Detection: discover unremoved installation files, backup scripts, and sensitive directories.
- TLS/SSL Configuration Check: identify weak ciphers and insecure protocol configurations on local servers.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `nikto`, `nikto.pl`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `vulnerability_audit`
- Timeout: 40000ms
- Evidence Outputs: `/tmp/akatsuki_nikto.json`, `/tmp/akatsuki_nikto.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_nikto.*`, terminate lingering `nikto` processes

## Command Patterns
```bash
# 1. Standard web server audit with JSON formatting
nikto -h http://127.0.0.1:8080 -Format json -o /tmp/akatsuki_nikto.json

# 2. Fast tuning scan focused on misconfigurations and information disclosure
nikto -h http://127.0.0.1:3000 -Tuning 2,3,a -Format json -o /tmp/akatsuki_nikto.json

# 3. SSL/TLS enabled port audit
nikto -h https://127.0.0.1:8443 -ssl -Format json -o /tmp/akatsuki_nikto.json
```

## Fail-Closed Notes
- Execution fails closed if target is non-local without explicit written RoE.
- All processes execute within `akatsuki-lab` sandbox container with non-host bridge.
