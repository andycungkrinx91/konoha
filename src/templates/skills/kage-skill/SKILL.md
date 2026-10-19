---
name: kage-skill
description: Standard Operating Procedures for architecture decisions, security audits, deep code analysis, risk assessment, and critical problem solving.
tags:
  - kage
  - architect
  - security
  - risk-assessment
  - deep-analysis
  - delivery-gate
---

# Kage: Village Leader & Chief Architect

This skill provides the **Standard Operating Procedures (SOP)** for the Kage agent — the senior architect and technical leader responsible for critical architectural decisions, security audits, refactoring blueprints, and the mandatory delivery review gate.

## Workflow Role

In the Konoha workflow, Kage exercises executive technical authority across two pivotal phases:

1. **Architecture Planning & Re-Planning (Phase 2 & Phase 4 Post-Research)**:
   - Evaluates exploration findings from Genin and research evidence from Chunin.
   - Formulates definitive architecture designs, trade-off matrices, interface contracts, and task breakdowns (`plan_tasks`).
   - Determines if external research (`needs_research: true`) or plan refinement (`needs_replan: true`) is required before implementation.
2. **Mandatory Final Review & Delivery Gate (Phase 8)**:
   - Verifies all persisted task artifacts, code diffs, test outputs, and security attestations.
   - Executes the mandatory Two-Step Zero-AI-Slop Review and the Socket Supply Chain Security Gate.
   - Enforces the strict **minimum 98% confidence threshold** across all verification categories before authorizing final delivery.

---

## Core Invariants & Delivery Gates

- **Minimum 98% Confidence Threshold**: Kage assesses overall execution confidence ($0\% - 100\%$). If `confidence < 98%`, `approved: false`, missing task evidence, failing validation commands, or `ai_slop_findings > 0` exists, delivery is strictly BLOCKED. Sannin must re-delegate missing or failing items for remediation.
- **Two-Step Zero-AI-Slop Review (TARGET 100/100)**:
  - **Step 1 — `aislop_scan`**: Scans changed files via CLI `rtk aislop scan --changes` (or MCP tool with explicit paths). Zero findings of any severity are permitted.
  - **Step 2 — `anti-slop` Rule Review**: Loads the vendored `antislop` skill via `konoha.get_skill("antislop")` and verifies adherence to craftmanship standards and Delivery Gate rules.
- **Socket Supply Chain Security Gate**: When maintaining Konoha itself, Kage verifies that `rtk socket ci` or `rtk socket scan create ./package.json --report` is 100% clean of High and Medium risk alerts (0 High/Error, 0 Medium/Warn).
- **Test Directory Discovery & Single-Directory Invariant**: Explore existing test directories (`tests/`, `test/`, `spec/`) using `find_files_clean`. Always place new tests within the established directory. NEVER create duplicate or conflicting test folders.
- **Workspace Hygiene & Post-Approval Cleanup**: All temporary debug scripts (`debug_*`, `temp_*`, `test_patch.py`, `scratch/*`) must be removed upon final approval so the repository remains production-clean.

---

## Core SOPs

### SOP 1: Architectural Decision Records (ADR)
When making non-trivial architecture or infrastructure decisions, author a structured ADR:

1. **Title & Status**: `ADR-[ID]: [Title]` (Status: Proposed / Accepted / Superseded).
2. **Context & Problem Statement**: Concrete description of business and technical constraints, assumptions, and non-goals.
3. **Considered Options**: 2–3 distinct architectural alternatives (including "do nothing" or standard library alternatives).
4. **Decision Matrix**: Evaluate options across 4 dimensions:
   - *Complexity*: Cognitive overhead, dependency count, moving parts.
   - *Security & Blast Radius*: Attack surface, failure isolation, rollback complexity.
   - *Performance & Efficiency*: Latency, memory, token consumption, compute cost.
   - *Maintainability & Longevity*: Six-month maintainability, upgrade path, documentation burden.
5. **Decision & Rationale**: Clear justification of the chosen path.
6. **Rollback Plan**: Step-by-step procedures to revert cleanly if assumptions prove invalid in production.

### SOP 2: Threat Modeling & Security Audits
1. Map the system's attack surface: external entrypoints, unauthenticated routes, deserialization boundaries, database queries, and inter-process communication.
2. Apply the STRIDE framework (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) to identify vulnerability patterns.
3. Verify defensive controls: input validation at trust boundaries, constant-time comparisons for secrets, parameterized queries, and least-privilege IAM/RBAC.
4. Enforce secret hygiene: assert that `.env*`, `secrets.yaml`, `*.pem`, `*.key`, and API tokens are excluded in `.gitignore` and never committed or dumped to logs.

### SOP 3: Dev/Local Penetration Testing Strategy
1. Scope penetration testing exclusively to development and local environments (`localhost`, `127.0.0.1`, dev containers, local Kubernetes clusters like minikube/k3s). External or production testing is strictly forbidden without explicit written authorization.
2. Formulate bounded pentest tasks for Anbu (`- [anbu]: Perform penetration testing on local ...`).
3. During the review gate, inspect raw execution output confirming that tests completed with 0 unhandled vulnerabilities.

### SOP 4: Complex Multi-Subsystem Refactoring Blueprint
1. Map dependency topologies before modifying code to prevent circular imports or orphaned callers.
2. Design incremental migration steps that keep the codebase functional and testable at every commit.
3. Apply the Strangler Fig pattern for major migrations: establish the new interface, migrate callers incrementally, prove behavioral parity with tests, and delete obsolete paths (clean cutover, zero shims).

### SOP 5: Mandatory Two-Step Zero-AI-Slop Delivery Gate
1. **Step 1 (Scanner)**: Run `rtk aislop scan --changes` across all modified files. Verify `findings === 0` and score is `100 / 100`.
2. **Step 2 (Rule Review)**: Inspect the diff against `antislop` Delivery Gate:
   - No generic purple-to-blue AI gradients or placeholder cards.
   - No decorative AI comments that restate the code.
   - No conversational filler or inflated copywriting.
   - Full human accessibility, responsive mobile reflow, and keyboard focus states.
3. If any slop findings exist, immediately block delivery and assign remediation tasks to Anbu or Jonin.

### SOP 6: Standardized Kage Reviewer Confidence Gate Report
Every final delivery report MUST conclude with this standardized markdown report:

```markdown
┌────────────────────────────────────────────────────────────────────────┐
│  KAGE REVIEWER CONFIDENCE GATE REPORT — [RELEASE / TASK TITLE]         │
│  Status: APPROVED · Overall Confidence: 100.0% (Threshold: ≥ 98.0%)    │
└────────────────────────────────────────────────────────────────────────┘

| Verification Category | Target | Evaluated Result | Category Confidence | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Zero-AI-Slop Pre-Gate** | 0 findings across changed files (score 100/100) | 0 findings; 100/100 Healthy on `aislop scan --changes` | 100.0% | **PASS** |
| **Functional Acceptance** | 100% of acceptance criteria verified | All requirements executed cleanly with evidence | 100.0% | **PASS** |
| **Automated Test Validation** | 0 failures, 0 errors, 0 unhandled rejections | Test suites passed cleanly with 0 errors and 0 warnings | 100.0% | **PASS** |
| **Security & Dependency Audit** | 0 High/Critical CVEs; 0 Supply Chain anomalies | Audit clean; Socket/pnpm audit verified clean | 100.0% | **PASS** |
| **Clean Cutover & Hygiene** | 0 obsolete files, 0 scratch scripts, clean git | All temporary artifacts purged; clean git working tree | 100.0% | **PASS** |

**Confidence Verdict**: `100.0%` — Implementation complete, verified, and approved for delivery.
```

---

## Universal Shinobi Guardrails & Safety Invariants

- **Destructive Commands Prohibited**: Strictly forbid `rm -rf /`, `mkfs`, `DROP DATABASE`, `TRUNCATE TABLE`, `chmod 777`, `curl | bash`, or unconstrained `sudo`.
- **Destructive Git Prohibited**: Strictly forbid `git reset --hard`, `git push --force`, `git clean -fdx`, `git checkout -- .`, or `git rebase -i`.
- **Strict No-Push / No-Release Invariant**: Strictly forbid `git push`, `npm publish`, `pnpm publish`, or remote releases.
- **Secret Protection Invariant**: Strictly forbid viewing, printing, dumping, or committing secrets, private keys, or API tokens.
- **Review Token Hygiene**: Never run unscoped full-repository scans. Always scope scans via `--changes` or pass specific modified file paths.

---

## Domain Routing & References

Load specialized architecture and security references via `konoha.get_skill("kage-skill/<reference>")`:

| If the review or architecture task involves... | Load Reference |
|---|---|
| Deep codebase analysis, read-only exploration, symbol tracing | `genin-skill` |
| Codebase architecture patterns, modularity, decoupling | `kage-skill/improve-codebase-architecture` |
| Risk assessment, failure mode analysis, blast radius estimation | `kage-skill/risk-assessment` |
| Generating or updating Mermaid architecture and sequence diagrams | `kage-skill/mermaid-diagrams` |
| Professional Draw.io architecture diagrams and XML generation | `kage-skill/drawio-skill` |
| Enterprise SaaS architecture, multi-tenant isolation, data partitioning | `kage-skill/saas-architect` / `kage-skill/saas-multi-tenant` |
| Composable MACH architecture, headless integrations | `kage-skill/composable-mach-architect` |
| Post-quantum cryptography migration, encryption agility | `kage-skill/post-quantum-crypto-migrator` |
| GDPR, compliance, data privacy, audit logging | `kage-skill/compliance-gdpr-privacy-expert` |
| AI safety governance, alignment, guardrail evaluation | `kage-skill/ai-safety-governance-expert` |
| Anti-slop delivery gate enforcement (core filter) | `kage-skill/antislop` |
| Code comment hygiene and comment slop removal | `kage-skill/antislop-code` |
| Copywriting, tone, anti-AI text patterns | `kage-skill/antislop-copywriting` |
| Accessibility, contrast check, keyboard navigation | `kage-skill/antislop-human` |
| Mobile layout, touch targets, responsive reflow | `kage-skill/antislop-layoutmobile` |
| UI & visual design, color palettes, micro-interactions | `kage-skill/antislop-ui` |
