# PortSwigger Burp Suite Reference

Burp Suite is an industry-standard integrated platform for performing security testing of web applications. Its various tools work seamlessly together to support the entire testing process, from initial mapping and analysis of an application's attack surface through to finding and exploiting security vulnerabilities.

## Source
- Kali Linux Official: `https://www.kali.org/tools/burpsuite/`
- PortSwigger Documentation: `https://portswigger.net/burp/documentation`
- Chunin Threat Intelligence: Synthesized headless scanning and proxy automation patterns

## When to Use
- Web Application Penetration Testing: intercept, view, and modify HTTP/HTTPS requests and responses in real time.
- Automated Active & Passive Scanning: identify OWASP Top 10 web flaws, Cross-Site Scripting (XSS), SQLi, and CSRF vulnerabilities.
- API & Microservice Interception: audit REST, GraphQL, and WebSocket protocols in isolated dev sandboxes.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `burpsuite`, `/usr/bin/burpsuite`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `vulnerability_audit`
- Timeout: 60000ms
- Evidence Outputs: `/tmp/akatsuki_burpsuite.xml`, `/tmp/akatsuki_burpsuite.json`
- Cleanup Steps: Remove `/tmp/akatsuki_burpsuite.*`, terminate lingering `burpsuite` processes

## Command Patterns
```bash
# 1. Run headless project file configuration for automated scanning
burpsuite --project-file=/tmp/akatsuki_project.burp --config-file=/tmp/burp_config.json

# 2. Intercept and proxy traffic through local port 8080
curl -x http://127.0.0.1:8080 -s http://127.0.0.1:3000/api/v1/health

# 3. Export scanner findings and crawl reports
java -jar -Djava.awt.headless=true /usr/share/burpsuite/burpsuite.jar --unattended
```

## Fail-Closed Notes
- Burp Suite executes exclusively inside the isolated container sandbox `akatsuki-lab`.
- Out-of-scope external targets without explicit written authorization are blocked fail-closed.
