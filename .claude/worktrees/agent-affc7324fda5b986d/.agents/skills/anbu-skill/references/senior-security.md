# Senior Security Architecture Review Guide

> Read when: user asks for senior security review, architecture risk assessment, threat modeling, cloud/IAM posture review, or remediation prioritization.

## Contents

- Review mindset
- Threat modeling approach
- Attack surface analysis
- Secure architecture review
- Cloud security review
- IAM and least privilege
- Network segmentation
- Secrets management
- Security headers and application controls
- Vulnerability prioritization
- Incident response readiness
- Defense-in-depth review
- Secure SDLC expectations
- Risk rating model
- Remediation planning
- Executive/security summary format

## Review Mindset

Senior security review is risk-led, system-level, and outcome-focused:
- Prioritize business impact and exploitability over checklist volume.
- Look for control failures across layers, not isolated bugs.
- Recommend practical remediation paths with owners and timelines.

## Threat Modeling Approach

Minimum approach:
1. Define assets and crown jewels.
2. Map trust boundaries and data flows.
3. Apply **STRIDE** per component.
4. Score likely scenarios with lightweight **DREAD** signals.
5. Convert to concrete mitigations and validation tests.

## Attack Surface Analysis

Include:
- External interfaces: APIs, web apps, mobile endpoints, auth flows.
- Internal interfaces: service-to-service calls, admin tools, CI/CD.
- Control planes: cloud consoles, IaC pipelines, secret managers.
- Data planes: databases, object stores, queues, model/vector stores.

## Secure Architecture Review

Validate:
- Explicit trust boundaries and zero-trust assumptions.
- Strong identity between services (workload identity, mTLS where required).
- Fail-safe defaults and secure error handling.
- Segregation of duties for admin/change operations.

## Cloud Security Review

Review dimensions:
- Account/subscription/project guardrails.
- Baseline encryption, logging, and audit settings.
- Public exposure paths (LB, buckets, DB endpoints, management APIs).
- Detection and response controls across cloud-native telemetry.

## IAM and Least Privilege

Check for:
- Excessive wildcard permissions.
- Shared high-privilege service principals.
- Missing break-glass governance and approvals.
- Lack of periodic access review and revocation process.

## Network Segmentation

Expect:
- Tiered segmentation (edge/app/data/management).
- Minimal east-west connectivity by default.
- Restrictive egress for sensitive workloads.
- Private endpoints for data/control services where feasible.

## Secrets Management

Verify:
- Centralized secret storage and access logging.
- Automated rotation for high-risk credentials.
- No secrets in code, build artifacts, or plaintext configs.
- Revocation playbooks tested and documented.

## Security Headers and Application Controls

For internet-facing apps, check:
- CSP, HSTS, X-Content-Type-Options, Referrer-Policy.
- Secure cookie settings and CSRF controls for session-based flows.
- Strong authentication and brute-force protections.

## Vulnerability Prioritization

Use a concise matrix:
- **Exploitability**: low/medium/high.
- **Impact**: low/medium/high/critical.
- **Exposure**: internal, partner, public.
- **Control maturity**: preventive/detective gaps.

Prioritize highest combined risk first; map to action windows.

## Incident Response Readiness

Confirm:
- Severity model (**P1-P4**) with clear triggers.
- On-call escalation and communication runbooks.
- Forensic-quality logs and retention.
- Post-incident corrective action tracking.

## Defense-in-Depth Review

Assess layered controls:
- Preventive: authz, segmentation, hardened configs.
- Detective: SIEM alerts, anomaly detection, integrity checks.
- Corrective: rollback, key rotation, containment automation.

## Secure SDLC Expectations

- Threat modeling at design time for material changes.
- Security testing in CI (SAST/SCA/secrets/container/IaC).
- Security acceptance criteria in PR/release gates.
- Regular dependency and platform patch governance.

## Risk Rating Model

Use a practical rating:
- **Critical**: immediate P1 risk; active or trivial exploit path with severe impact.
- **High**: significant impact with realistic exploitability.
- **Medium**: moderate impact and/or harder exploitation.
- **Low**: limited impact or compensating controls substantially reduce risk.

Include residual risk after proposed mitigation.

## Remediation Planning

For each major finding:
- Define immediate containment (24-72h for critical/high).
- Define durable fix and owner.
- Set due date and verification method.
- Track dependencies and potential service impact.
- Define fallback/rollback if remediation introduces instability.

## Executive/Security Summary Format

Use this structure:

1. **Scope**: systems, environments, and assumptions.
2. **Top Risks (3-7)**: severity, business impact, affected assets.
3. **Security Posture Snapshot**: strengths, systemic gaps, trend.
4. **Priority Actions**:
   - 0-30 days (urgent)
   - 31-90 days (stabilize)
   - 90+ days (maturity)
5. **Residual Risk**: what remains and why.
6. **Decision Requests**: approvals/resources needed from leadership.
