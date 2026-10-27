# ProjectDiscovery Nuclei Vulnerability Scanner Reference

Nuclei is a community-driven, template-based vulnerability scanner from ProjectDiscovery. It uses YAML templates to send targeted probes across network protocols, web applications, and APIs to detect security misconfigurations, default credentials, CVEs, and exposures.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/nuclei-scanner` (+ `https://www.skills.sh/agentsecops/secopsagentkit/dast-nuclei`)
- Kali Linux Official: `https://www.kali.org/tools/nuclei/`

## When to Use
- Standardized CVE Vulnerability Auditing: scan local endpoints for known public CVE signatures.
- Web Application Misconfiguration Detection: verify secure headers, exposed admin panels, debug bars, and open swagger UIs.
- Passive & Non-Destructive Vulnerability Verification: run verified templates with zero data loss or side effects.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `nuclei`, `/root/go/bin/nuclei`, `/usr/local/go/bin/nuclei`
- Target Scoping: Default `http://127.0.0.1:8080` unless explicit authorized target provided
- Safety Class: `vulnerability_audit`
- Timeout: 45000ms
- Evidence Outputs: `/tmp/akatsuki_nuclei.json`
- Cleanup Steps: Remove `/tmp/akatsuki_nuclei.*`, terminate lingering `nuclei` processes

## Command Patterns
```bash
# 1. Non-destructive vulnerability audit with JSON export
nuclei -u http://127.0.0.1:8080 -severity low,medium,high,critical -json -o /tmp/akatsuki_nuclei.json

# 2. Targeted misconfiguration and exposure audit
nuclei -u http://127.0.0.1:3000 -t exposures/ -t misconfiguration/ -json -o /tmp/akatsuki_nuclei.json

# 3. Fast technology identification and CVE matching
nuclei -u http://127.0.0.1:8080 -tags cve,tech -json -o /tmp/akatsuki_nuclei.json
```

## Fail-Closed Notes
- Destructive and DoS templates (`-tags dos`, `-tags intrusive`) are strictly excluded in standard audits.
- Target scope validation strictly enforces local addresses.
