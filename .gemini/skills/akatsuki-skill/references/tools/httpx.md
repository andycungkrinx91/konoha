# ProjectDiscovery HTTPX Web Probe Reference

HTTPX is a fast, multi-purpose HTTP probing toolkit from ProjectDiscovery. It performs comprehensive HTTP probing with customizable matchers, response parsing, TLS certificate inspection, and technology detection.

## Source
- Skills.sh: `https://www.skills.sh/crtvrffnrt/skills/pentest-web-enumeration`
- Kali Linux Official: `https://www.kali.org/tools/httpx-toolkit/`

## When to Use
- HTTP Endpoint Validation: verify live HTTP/HTTPS services across multiple local ports.
- Web Status & Title Enumeration: capture status codes, page titles, content lengths, and redirects.
- TLS/SSL Inspection: inspect local certificate common names, SANs, and issuer chains.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `httpx`, `/root/go/bin/httpx`, `/usr/local/go/bin/httpx`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `active_recon`
- Timeout: 25000ms
- Evidence Outputs: `/tmp/akatsuki_httpx.json`
- Cleanup Steps: Remove `/tmp/akatsuki_httpx.*`, terminate lingering `httpx` processes

## Command Patterns
```bash
# 1. Probe standard ports with title and status code in JSON format
httpx -u http://127.0.0.1 -p 80,443,3000,8000,8080 -title -status-code -json -o /tmp/akatsuki_httpx.json

# 2. Extract server headers, technologies, and response timing
httpx -u http://127.0.0.1:8080 -tech-detect -response-time -json -o /tmp/akatsuki_httpx.json

# 3. Follow redirects and display final URL location
httpx -u http://127.0.0.1:3000 -follow-redirects -status-code -json -o /tmp/akatsuki_httpx.json
```

## Fail-Closed Notes
- Execution without container isolation is blocked immediately.
- High-concurrency rate limits are applied to prevent resource exhaustion within the sandbox.
