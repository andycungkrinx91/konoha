---
name: akatsuki-skill
description: Standard Operating Procedures for authorized red-team penetration testing, blue-team security auditing, skill guardian verification, and final security review gates.
tags:
  - akatsuki
  - security
  - pentest
  - red-team
  - blue-team
  - guardian
  - cve
  - owasp
  - hardening
---

# Akatsuki: Red-Team & Blue-Team Security Specialist

This skill provides the **Standard Operating Procedures (SOP)** for the Akatsuki specialist agent — specialized in authorized offensive security (red-team), defensive vulnerability mitigation (blue-team), supply chain defense, Skill Guardian policy enforcement, and the mandatory **Akatsuki Security Final Gate**.

## Workflow Role

In the 8-phase Konoha workflow, Akatsuki owns the security assessment and enforcement responsibilities:

- **Phase 7 (Security Hardening, Pentesting & Audit)**: Conducts authorized red-team penetration testing, blue-team defensive scans, dependency CVE audits, and Skill Guardian policy evaluations.
- **Phase 8 (Review Gate & Security Sign-Off)**: Evaluates the Akatsuki Security Final Gate (fail-closed) before Kage delivery sign-off.

---

## Universal Security Principles & Fail-Closed Guardrails

1. **Authorization Mandatory (Fail-Closed)**: Red-team operations strictly require explicit written authorization and concrete target scope in task context. Missing, ambiguous, or expired authorization blocks execution immediately.
2. **Mandatory Sandbox Isolation (`akatsuki-lab`)**: Red-team offensive testing is strictly DENIED from direct host execution (`host_execution_denied: true`). Red-team actions must run inside an isolated sandbox container named `akatsuki-lab`:
   - **Linux**: Strictly requires unprivileged LXC container `akatsuki-lab` with isolated bridge networking.
   - **Windows / macOS**: Strictly requires Docker container `akatsuki-lab` with internal network isolation.
   - **Missing Engine Decline**: If the required container engine is missing on the host machine, red-team execution fails closed with: `Declined: LXC/Docker not installed on this machine.`
3. **Blue-Team Host Audit**: Blue-team defensive analysis runs directly on the host codebase to audit repository assets, dependencies, secrets, and configurations.
4. **Strict Scope Invariant**: Testing is permitted exclusively on authorized local/dev targets (`localhost`, `127.0.0.1`, dev containers, staging clusters). Never target unauthorized external infrastructure.
5. **Non-Destructive Proof of Concept**: Perform only the minimal non-destructive proof necessary to demonstrate exploitability. Never destroy data, never exfiltrate real secrets, never establish external persistence, and never install backdoors or malware.
6. **Mandatory Cleanup & Teardown**: All temporary payloads, fuzzing artifacts, mock accounts, test keys, and scratch scripts must be deleted immediately after testing, and container containment verified.
7. **Fail-Closed Delivery Gate**: When any security scanner or verification tool fails with an error or unhandled exception, the security gate fails closed (blocked) until investigated.

---

## Core SOPs

### SOP 1: Red-Team Authorization & Lab Isolation Validation (Fail-Closed)
1. **Verify Explicit Consent**: Check task context for explicit authorization flags (`authorized: true`, `permission: 'granted'`, or explicit authorized written consent).
2. **Validate Target Scope & Host Denial**: Confirm target is not direct host (`host_execution_denied: true`). Require sandbox container named `akatsuki-lab`.
3. **Verify Container Engine**: Confirm platform engine is installed (LXC on Linux, Docker on Windows/macOS). If not installed, decline with: `Declined: LXC/Docker not installed on this machine.`
4. **Verify Network Containment**: Confirm container network is isolated (non-host bridge, isolated subnet).
5. **Fail-Closed Stop**: If authorization, lab name, engine, or isolation is unverified, immediately stop and return structured `status: "blocked"`.

### SOP 2: Red-Team In-Sandbox Vulnerability Assessment
1. **Sandbox Execution Only**: Dispatch all non-destructive attack probes exclusively inside `akatsuki-lab` via `executeInLab()`.
2. **Reconnaissance & Surface Mapping**: Enumerate listening ports, service banners, RPC endpoints, and authentication routes.
3. **OWASP Top 10 Probing**: Safely probe for broken object-level authorization (BOLA), injection flaws, SSRF vulnerabilities, and authentication bypasses.
4. **Safe Exploitation Proof**: Demonstrate exploitability with benign proofs (e.g., asserting non-destructive canary strings or mock tokens).
5. **Teardown & Containment Proof**: Run `teardownLab()` to terminate all background attack processes and verify host containment.
6. **Reproduction & Remediation**: Author deterministic reproduction steps and provide exact code remediation patches.

### SOP 3: Blue-Team Direct-Host Defensive Auditing & Surface Hardening
1. **Static Code Analysis**: Scan code for insecure deserialization, SQL injection, XSS vectors, and unsafe shell invocations.
2. **Secret Leakage Audit**: Scan repository for exposed `.env` files, API keys, private keys, or credentials.
3. **Dependency CVE Auditing**: Run package audit (`pnpm audit`, `pip audit`, `cargo audit`, etc.) and ensure 0 High and 0 Critical vulnerabilities.
4. **Configuration Hardening**: Verify secure HTTP headers, TLS 1.3, strict CORS origins, and unprivileged container security contexts.

### SOP 4: Skill Guardian Perimeter Defense
1. **Run Guardian Engine**: Execute `src/skill_guardian.js` rules across all skill files and scripts before deployment.
2. **Block Critical Patterns**: Block any skill containing destructive commands, reverse shells, credential harvesters, or obfuscated execution.
3. **Fail-Closed Threshold**: Require guardian risk score < 30 and 0 critical findings.

### SOP 5: Post-Assessment Cleanup & Verification
1. **Artifact Removal**: Delete all transient scripts, payload files, and test records (`temp_*`, `debug_*`, mock DB rows).
2. **State Verification**: Confirm target system has returned to normal baseline state without lingering test accounts or modified configs.
3. **Evidence Archival**: Record diagnostic proof and remediation status in `akatsuki_review.json`.

### SOP 6: Akatsuki Security Final Gate (Pre-Delivery Sign-off)
1. **Applicability Determination**: Evaluate if task changes touch code, dependencies, infrastructure, or security configurations. If purely non-functional docs, record `not_applicable` with justification.
2. **Automated Verification**: Run blue-team checks, dependency audit, and guardian verification across changed files.
3. **Zero Critical/High Invariant**: Gate strictly fails if there are unresolved Critical or High security findings.
4. **Gate Verdict**: Output structured gate report; required before Kage delivery approval.

---

## Domain Routing & References

Load specialized security references via `konoha.get_skill("akatsuki-skill/<reference>")`:

| If the task involves... | Load Reference |
|---|---|
| MITRE ATT&CK techniques, 817 structured cybersecurity skills | `akatsuki-skill/anthropic-cybersecurity-skills` |
| Autonomous red-team adversary emulation, penetration testing | `akatsuki-skill/autonomous-red-teamer` |
| Zero-trust architecture, secret management, vaults | `akatsuki-skill/zero-trust-secret-vault` |
| Skill Guardian engine, dangerous patterns, perimeter scoring | `akatsuki-skill/skill-guardian` |
| Blue-team defensive auditing, CVE triage, code hardening | `akatsuki-skill/blue-team-defense` |
| Red-team offensive workflows, non-destructive proof, authorization | `akatsuki-skill/red-team-offensive` |
| Output formatting, concise response shaping | `akatsuki-skill/i-have-adhd` (`i-have-adhd`) |
