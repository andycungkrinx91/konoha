# Nmap Network Scanner Reference

Nmap is an enterprise-grade network exploration, port scanning, and security auditing engine. Within Akatsuki, it serves as the foundational active discovery tool for enumerating listening services, OS versions, and network topology in isolated sandboxes.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/nmap-recon` (+ `https://www.skills.sh/agentsecops/secopsagentkit/recon-nmap`)
- Kali Linux Official: `https://www.kali.org/tools/nmap/`

## When to Use
- Phase 1 & 2 Network Discovery: identify listening TCP/UDP ports, open services, and host responses.
- Service Version Detection: fingerprint daemon banners, SSL/TLS versions, and web server software.
- Pre-Assessment Host Discovery: map active endpoints within the authorized local CIDR scope.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `nmap`
- Target Scoping: Default loopback `127.0.0.1` unless explicit authorized target provided
- Safety Class: `active_recon`
- Timeout: 30000ms (standard) / up to 3600000ms (full audit)
- Evidence Outputs: `/tmp/akatsuki_nmap.xml`, `/tmp/akatsuki_nmap.txt`
- Cleanup Steps: Remove `/tmp/akatsuki_nmap.*`, terminate lingering `nmap` processes

## Command Patterns
```bash
# 1. Quick top-ports TCP syn discovery
nmap -sS -T4 --top-ports 100 -oN /tmp/akatsuki_nmap.txt 127.0.0.1

# 2. Comprehensive service version enumeration & default safe scripts
nmap -sV -sC -T4 -p 80,443,8080,3000,8000 -oX /tmp/akatsuki_nmap.xml 127.0.0.1

# 3. Fast port existence sweep
nmap -T4 -F -oN /tmp/akatsuki_nmap.txt 127.0.0.1

# 4. Low-rate UDP service discovery for DNS/SNMP/NTP
nmap -sU -T4 -p 53,123,161 -oN /tmp/akatsuki_nmap.txt 127.0.0.1
```

## Fail-Closed Notes
- Execution fails closed if container engine (Docker/LXC) is absent or stopped.
- Targets outside authorized local/dev regex are rejected immediately.
- Never execute with raw root privilege outside unprivileged container namespace.
