# SearchSploit Exploit Database Query Utility Reference

SearchSploit is a command-line search utility for Exploit-DB that enables local offline searching of public exploit code, CVE advisories, and security vulnerability papers without network requests.

## Source
- Skills.sh: `https://www.skills.sh/mukul975/threatswarm/exploit-db`
- Kali Linux Official: `https://www.kali.org/tools/exploitdb/`

## When to Use
- Offline Vulnerability Research: look up public exploits for identified software versions (e.g. OpenSSH, Nginx, Apache).
- CVE & EDB Verification: cross-reference scanner findings with published Proof-of-Concepts.
- Non-Destructive Vulnerability Assessment: evaluate whether a public exploit exists without firing any packets.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: Permitted for read-only queries or inside container sandbox
- Binary Candidates: `searchsploit`
- Target Scoping: Query keyword / software version
- Safety Class: `read_only`
- Timeout: 15000ms
- Evidence Outputs: `/tmp/akatsuki_searchsploit.json`
- Cleanup Steps: Remove `/tmp/akatsuki_searchsploit.*`

## Command Patterns
```bash
# 1. Search exploits by service and exact version with JSON output
searchsploit "Apache 2.4.49" --json > /tmp/akatsuki_searchsploit.json

# 2. Search exploits matching specific CVE identifier
searchsploit --cve 2021-41773 --json > /tmp/akatsuki_searchsploit.json

# 3. Search WordPress plugin vulnerability advisories
searchsploit "WordPress elementor" --json > /tmp/akatsuki_searchsploit.json
```

## Fail-Closed Notes
- SearchSploit only queries local databases and never transmits payloads to targets.
- Downstream exploit compilation or execution is gated by Akatsuki controlled verification permissions.
