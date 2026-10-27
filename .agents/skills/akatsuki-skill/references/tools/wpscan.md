# WPScan WordPress Security Assessment Reference

WPScan is a black box WordPress vulnerability scanner. It scans remote WordPress installations to find security issues, vulnerable plugins, outdated themes, and user enumeration flaws.

## Source
- Skills.sh: `https://www.skills.sh/agent-skills-hub/agent-skills-hub/wordpress-penetration-testing` (+ `https://www.skills.sh/crtvrffnrt/skills/pentest-web-enumeration`)
- Kali Linux Official: `https://www.kali.org/tools/wpscan/`

## When to Use
- WordPress Security Auditing: identify core WordPress version vulnerabilities and known CVEs.
- Vulnerable Plugin & Theme Detection: audit installed plugins and themes against known exploit databases.
- Configuration Assessment: check for sensitive file exposure (`wp-config.php.bak`, debug logs).

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `wpscan`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `vulnerability_audit`
- Timeout: 40000ms
- Evidence Outputs: `/tmp/akatsuki_wpscan.json`
- Cleanup Steps: Remove `/tmp/akatsuki_wpscan.*`, terminate lingering `wpscan` processes

## Command Patterns
```bash
# 1. Passive enumeration of vulnerable plugins and themes with JSON output
wpscan --url http://127.0.0.1:8080 --enumerate vp,vt --format json -o /tmp/akatsuki_wpscan.json

# 2. Fast non-intrusive scan without password attacks
wpscan --url http://127.0.0.1:3000 --detection-mode passive --format json -o /tmp/akatsuki_wpscan.json

# 3. Comprehensive plugin enumeration with stealth user agent
wpscan --url http://127.0.0.1:8080 -e ap --random-user-agent --format json -o /tmp/akatsuki_wpscan.json
```

## Fail-Closed Notes
- Password brute-forcing (`--passwords`) is strictly forbidden in automated CI audits.
- Invocations against non-local targets fail closed without explicit authorization.
