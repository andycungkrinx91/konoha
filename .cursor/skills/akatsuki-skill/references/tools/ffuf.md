# FFUF Fast Web Fuzzer Reference

FFUF (Fuzz Faster U Fool) is a high-speed web fuzzer written in Go. It discovers hidden directory structures, virtual hosts, unlinked API parameters, and sensitive configuration files through controlled wordlist matching.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/ffuf` (+ `https://www.skills.sh/trailofbits/skills-curated/ffuf-web-fuzzing`)
- Kali Linux Official: `https://www.kali.org/tools/ffuf/`

## When to Use
- Route & Directory Fuzzing: discover hidden directories, administration routes, and legacy files (`/admin`, `/.git`, `/api/v1`).
- Parameter Discovery: identify undocumented GET/POST query parameters on web API endpoints.
- Virtual Host Fuzzing: probe internal subdomains and Host header routing on local servers.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `ffuf`, `/root/go/bin/ffuf`, `/usr/local/go/bin/ffuf`
- Target Scoping: Default `http://127.0.0.1:8080/FUZZ`
- Safety Class: `active_recon`
- Timeout: 30000ms
- Evidence Outputs: `/tmp/akatsuki_ffuf.json`
- Cleanup Steps: Remove `/tmp/akatsuki_ffuf.*`, terminate lingering `ffuf` processes

## Command Patterns
```bash
# 1. Directory fuzzing with standard wordlist and JSON output
ffuf -u http://127.0.0.1:8080/FUZZ -w /usr/share/wordlists/dirb/common.txt -of json -o /tmp/akatsuki_ffuf.json -t 10

# 2. Filter responses by status code (200, 204, 301, 302, 307)
ffuf -u http://127.0.0.1:3000/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302 -of json -o /tmp/akatsuki_ffuf.json

# 3. Parameter fuzzing on an API endpoint
ffuf -u "http://127.0.0.1:8080/api/items?FUZZ=1" -w /usr/share/wordlists/seclists/Discovery/Web-Content/burp-parameter-names.txt -of json -o /tmp/akatsuki_ffuf.json
```

## Fail-Closed Notes
- Aggressive denial-of-service rates (>100 req/sec) are throttled via `-t` thread parameters.
- Missing authorization or external hosts abort before execution.
