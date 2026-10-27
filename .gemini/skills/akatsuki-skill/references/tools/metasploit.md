# Metasploit Framework Controlled Verification Reference

Metasploit Framework is the premier penetration testing platform for verifying security vulnerabilities, validating remediation patches, and conducting controlled exploit proof-of-concept tests.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/metasploit` (+ `https://www.skills.sh/agentsecops/secopsagentkit/pentest-metasploit`)
- Kali Linux Official: `https://www.kali.org/tools/metasploit-framework/`

## When to Use
- Controlled Exploit Verification: confirm whether an identified vulnerability is genuinely exploitable or a false positive.
- Auxiliary Scanning & Version Probing: execute Metasploit auxiliary scanner modules (`scanner/http/title`, `scanner/portscan/tcp`).
- Remediation Patch Validation: verify that applying a code or configuration patch successfully blocks previously confirmed exploit paths.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `msfconsole`, `/usr/bin/msfconsole`, `msfcli`
- Target Scoping: Default `127.0.0.1` unless explicit authorized target provided
- Safety Class: `controlled_verification`
- Red-Team Gate: Controlled exploit verification is gated by `allow_controlled_exploit_verification`. Explicit `false` blocks execution; in red mode with standing authorization, auxiliary scanners and controlled checks are permitted.
- Timeout: 60000ms
- Evidence Outputs: `/tmp/akatsuki_msf.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_msf.*`, terminate lingering `msfconsole` and ruby processes

## Command Patterns
```bash
# 1. Execute safe auxiliary scanner module for HTTP version detection
msfconsole -q -x "use auxiliary/scanner/http/title; set RHOSTS 127.0.0.1; set RPORT 8080; run; exit" > /tmp/akatsuki_msf.txt

# 2. Check vulnerability existence without payload delivery (check command)
msfconsole -q -x "use exploit/multi/http/example_cve; set RHOSTS 127.0.0.1; check; exit" > /tmp/akatsuki_msf.txt

# 3. Auxiliary port and service enumeration
msfconsole -q -x "use auxiliary/scanner/portscan/tcp; set RHOSTS 127.0.0.1; set PORTS 80,443,3000,8080; run; exit" > /tmp/akatsuki_msf.txt
```

## Fail-Closed Notes
- In Blue mode (defensive mode), Metasploit execution is completely locked and unavailable.
- Destructive payloads, persistent implants, and ransomware simulations are strictly forbidden.
