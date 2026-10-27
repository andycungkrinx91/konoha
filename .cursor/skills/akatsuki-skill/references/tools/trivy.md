# Aqua Security Trivy Scanner Reference

Trivy is a comprehensive and versatile security scanner from Aqua Security. It scans container images, filesystems, Git repositories, and virtual machine images for known CVE vulnerabilities, sensitive secrets, and misconfigurations.

## Source
- Skills.sh: `https://www.skills.sh/terminalskills/skills/trivy` (+ `https://www.skills.sh/agentsecops/secopsagentkit/sca-trivy`)
- Kali Linux / Aqua Security: `https://www.kali.org/tools/trivy/`

## When to Use
- Container Image Vulnerability Scanning: scan container base images (`node:22-slim`, `debian:12`, `alpine:latest`).
- Filesystem & Dependency Auditing: scan local project filesystems and package lockfiles for known CVEs.
- Secrets & License Compliance: identify leaked secrets, private keys, and non-permissive licenses.

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (or host execution for local dependency lockfile audits in Blue mode)
- Direct Host Execution: Permitted in Blue mode for filesystem audits; container execution for image scans
- Binary Candidates: `trivy`
- Target Scoping: Local filesystem directory or local container image tag
- Safety Class: `read_only`
- Timeout: 45000ms
- Evidence Outputs: `/tmp/akatsuki_trivy.json`
- Cleanup Steps: Remove `/tmp/akatsuki_trivy.*`

## Command Patterns
```bash
# 1. Scan filesystem for high and critical vulnerabilities in JSON format
trivy fs --severity HIGH,CRITICAL --format json -o /tmp/akatsuki_trivy.json .

# 2. Scan container image for OS and language package CVEs
trivy image --severity HIGH,CRITICAL --format json -o /tmp/akatsuki_trivy.json node:22-slim

# 3. Fast vulnerability scan of package lockfiles only
trivy fs --scanners vuln --format json -o /tmp/akatsuki_trivy.json package-lock.json
```

## Fail-Closed Notes
- Delivery is blocked if any unmitigated Critical or High CVE is detected without an approved security waiver.
- Network updates use cached databases in offline environments.
