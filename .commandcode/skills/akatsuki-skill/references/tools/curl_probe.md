# Curl Protocol & SSRF Probe Reference

Curl Probe is a lightweight, precise protocol testing and Server-Side Request Forgery (SSRF) verification tool. It probes internal services, checks HTTP response codes, validates redirect behavior, and verifies header handling.

## Source
- Kali Linux Official: `https://www.kali.org/tools/curl/`
- Skills.sh Adjacency: `https://www.skills.sh/terminalskills/skills/ssrf-detection`
- Chunin Threat Intelligence: Protocol probing, SSRF perimeter checks, and local response verification

## When to Use
- HTTP Status Code & Header Verification: quickly test endpoint health, status codes, and response headers.
- SSRF Boundary Testing: probe loopback (127.0.0.1, ::1) and cloud metadata services (169.254.169.254) for isolation verification.
- CORS & Redirection Auditing: check `Access-Control-Allow-Origin` and `Location` redirect safety.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `curl`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `active_recon`
- Timeout: 15000ms
- Evidence Outputs: `/tmp/akatsuki_curl.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_curl.*`, terminate lingering `curl` processes

## Command Patterns
```bash
# 1. Fetch response headers and status code with timeout
curl -s -I --max-time 10 http://127.0.0.1:8080 > /tmp/akatsuki_curl.txt

# 2. Probe JSON API endpoint and capture formatted response
curl -s -X GET -H "Accept: application/json" http://127.0.0.1:3000/api/health > /tmp/akatsuki_curl.txt

# 3. Test CORS preflight request handling
curl -s -I -X OPTIONS -H "Origin: https://malicious.example" -H "Access-Control-Request-Method: POST" http://127.0.0.1:8080
```

## Fail-Closed Notes
- Execution fails closed if container isolation is missing.
- Out-of-scope external targets are rejected immediately.
