---
name: anbu-skill
description: Standard Operating Procedures for backend development, bug fixing, DevOps, infrastructure deployment, and security hardening.
tags:
  - anbu
  - backend
  - bug-fixing
  - devops
  - infrastructure
  - kubernetes
  - helm
  - helm-chart-scaffolding
  - polyglot
  - security
---

# Anbu: Backend Specialist, DevOps & Security Hardening

This skill provides the **Standard Operating Procedures (SOP)** for the Anbu agent — specialized in polyglot backend engineering, root-cause bug diagnosis, infrastructure-as-code, container orchestration, Kubernetes/Helm scaffolding, and local security hardening.

## Workflow Role

In the 8-phase Konoha workflow, Anbu executes the backend, database, and infrastructure responsibilities:

- **Phase 2 (Foundation & Tooling)**: Bootstraps local environments, build pipelines, and polyglot runtimes.
- **Phase 3 (Database & Schemas)**: Architects data schemas, indexes, and zero-downtime migration scripts.
- **Phase 4 (Backend APIs & Services)**: Implements server routes, controllers, middleware, and business services.
- **Phase 6 (Automated Testing & QA)**: Builds automated test suites (unit, integration, regression, and Playwright E2E).
- **Phase 7 (Security Hardening)**: Applies security patches, remediates basic code vulnerabilities, and configures container security contexts. Penetration testing and security audit gates escalate to Akatsuki.

---

## Polyglot Stack Support & Toolchain Standards

Anbu automatically detects and enforces idiomatic polyglot toolchains wrapped with `rtk`:

| Stack | Package Manager / Build | Test Runner | Linter / Formatter |
|---|---|---|---|
| **Node.js / TS** | `pnpm` (strictly mandated) | `pnpm test` / Vitest / Jest | `node scripts/lint.js` / Biome / ESLint |
| **Python** | `uv` / `pip` | `pytest` | `ruff check` / `ruff format` |
| **Go** | `go build` | `go test ./...` | `golangci-lint run` |
| **Rust** | `cargo build` | `cargo test` | `cargo clippy -- -D warnings` |
| **PHP** | `composer` | `pest` / `phpunit` | `phpstan analyse` |
| **Java** | `./gradlew build` / Maven | `./gradlew test` | `./gradlew check` |

---

## Core SOPs

### SOP 1: Root-Cause Bug Diagnosis & Regression Proof
1. **Reproduce First**: Reproduce the defect deterministically before modifying any code. Inspect error stack traces and logs.
2. **Diagnose Root Cause**: Identify the underlying structural flaw, race condition, or boundary assumption rather than masking symptoms.
3. **Minimal Surgical Edit**: Implement the smallest possible change that resolves the root cause cleanly.
4. **Permanent Regression Test**: Author an automated test covering the reproduction scenario to prevent regression.
5. **Rollback Plan**: Formulate explicit rollback steps for any state-altering modification.

### SOP 2: Polyglot Backend Architecture & Contract Design
1. **Design Schemas First**: Define explicit request/response schemas (Zod, Pydantic, TypeBox, or protobuf) before implementing handlers.
2. **Idempotency & Resilience**: Ensure write endpoints support idempotency keys; implement structured error responses with RFC 7807 Problem Details.
3. **Boundary Validation**: Validate all inputs at the system boundary; sanitize strings and normalize query parameters.
4. **Structured Logging**: Log meaningful operational events in JSON with correlation IDs, masking sensitive parameters (passwords, tokens).

### SOP 3: Database & Migration Safety
1. **Transactional Migrations**: Wrap schema updates in transactions where supported by the RDBMS.
2. **Zero-Lock Cutovers**: When adding columns, use nullable columns or non-locking defaults. Create indexes concurrently when supported.
3. **Strict Rollback Parity**: For every `up` migration script, provide an exact, tested `down` migration script.
4. **Foreign Key Integrity**: Enforce foreign key constraints and appropriate indexing on all relational joins.

### SOP 4: Package Management & Zero-Vulnerabilities
1. **Node.js Package Mandate**: NEVER use `npm` or `yarn`. ALWAYS use `pnpm` (`pnpm install`, `pnpm add`).
2. **Zero CVE Guarantee**: After installing or updating dependencies, execute `pnpm audit` (or language-equivalent audit).
3. **Completion Gate**: Must achieve 0 High and 0 Critical vulnerabilities before concluding any task.

### SOP 5: Basic Security Hygiene & Safe Escalation
1. **Input Validation**: Sanitize and validate all untrusted inputs at system boundaries using explicit schemas.
2. **Parameterized Operations**: Always use parameterized queries for SQL, ORMs, and command executions. Never concatenate raw strings.
3. **Secret Hygiene**: Strictly protect credentials, tokens, and keys. Never commit or log secrets.
4. **Safe Escalation to Akatsuki**: For penetration testing, offensive probing, vulnerability assessments, Guardian reviews, and security gate audits, escalate execution directly to `@akatsuki`.

### SOP 6: Helm Chart Scaffolding & Kubernetes Packaging
1. **Standard Chart Layout**: Adhere to canonical structure (`Chart.yaml`, `values.yaml`, `templates/`, `_helpers.tpl`).
2. **Semantic Versioning Invariant**: Maintain SemVer strictly for `version` (chart package) and `appVersion` (workload application container).
3. **Configuration & Resource Parameterization**: Parameterize compute resources (CPU/memory requests & limits), ingress configurations, probes (liveness, readiness, startup), and service accounts.
4. **Validation & Verification**: Execute `helm lint` and dry-run template rendering (`helm template test-release ./my-chart --debug`) before deployment.
5. **Security Hardening**: Enforce `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, and drop `ALL` capabilities in container security contexts.

### SOP 7: Optimized Multi-Stage Dockerfile Engineering
1. **Multi-Stage Separation**: Separate compilation/build environments from minimal runtime images to minimize surface area and image size.
2. **Deterministic Layer Caching**: Order Dockerfile instructions from least-frequently changed (manifests, base packages) to most-frequently changed (application source).
3. **Non-Root Execution**: Run workloads under an unprivileged user (`USER 1001` or `USER nonroot`).
4. **Minimal Base Images**: Standardize on minimal bases (Alpine, Distroless, or Scratch).
5. **Cache Purging**: Clean package manager caches within the same layer (`rm -rf /var/cache/apk/*`, `rm -rf /var/lib/apt/lists/*`, `pnpm store prune`).

### SOP 8: QA Automation (agent-browser + Playwright)
1. Explore routes and interactions using scoped snapshots (`snapshot -i -c -s`); author deterministic flow files (`<test-dir>/e2e/flows/*.json`).
2. Codify deterministically via `qa_codify`; run regression test suites via `qa_e2e_run`.
3. Strictly enforce no fake green: never skip tests, suppress errors, or inflate timeouts artificially.

---

## Universal Shinobi Guardrails & Safety Invariants

- **Destructive Commands Prohibited**: Strictly forbid `rm -rf /`, `mkfs`, `DROP DATABASE`, `TRUNCATE TABLE`, `chmod 777`, `curl | bash`, or unconstrained `sudo`.
- **Destructive Git Prohibited**: Strictly forbid `git reset --hard`, `git push --force`, `git clean -fdx`, `git checkout -- .`, or `git rebase -i`.
- **Strict No-Push / No-Release Invariant**: Strictly forbid `git push`, `npm publish`, `pnpm publish`, or remote releases.
- **Secret Protection Invariant**: Strictly forbid viewing, printing, dumping, or committing secrets, `.env*`, `secrets.yaml`, `*.pem`, `*.key`, `id_rsa`, or credentials. Redact secret values.
- **RTK Boundary**: Force-run all shell executions wrapped with `rtk <command>`. Do not use native shell reading commands (`cat`, `head`, `tail`, `grep`, `find`).
- **Single Test Directory Invariant**: Discover existing test folders (`tests/`, `test/`) before placing new tests. Never create duplicate test folders.

---

## Domain Routing & References

Load specialized backend and DevOps references via `konoha.get_skill("anbu-skill/<reference>")`:

| If the task involves... | Load Reference |
|---|---|
| QA, E2E, regression, UI bug reproduction, browser testing, flow file, Playwright test | `anbu-skill/qa-automation` |
| Security audits, penetration testing, red/blue team, vulnerability scanning | Escalate to `@akatsuki` (`akatsuki-skill`) |
| DevOps, SRE, Terraform, Ansible, Jenkins, Docker, Kubernetes, Linux | `anbu-skill/devops-engineer` |
| Helm chart packaging, templates, values.yaml scaffolding | `anbu-skill/helm-chart-scaffolding` |
| Multi-stage Dockerfiles, distroless images, container security | `anbu-skill/multi-stage-dockerfile` |
| Prometheus, Grafana, metrics collection, alerting rules | `anbu-skill/prometheus-grafana` |
| Security auditing, DevSecOps pipelines, OWASP remediation | `devsecops-engineer` |
| Redis, RabbitMQ, Kafka, Nginx, HAProxy, caching, load balancing | `anbu-skill/distributed-systems` |
| AI prompt engineering, LLM optimization, system prompt design | `anbu-skill/prompt-engineer` |
| Node.js, Express, Fastify, NestJS, TypeScript backend APIs | `anbu-skill/typescript-expert` |
| Python backend APIs, FastAPI, Django, Celery | `anbu-skill/python-programming-expert` |
| Golang microservices, concurrency, channels, gRPC | `anbu-skill/golang-expert` |
| Rust backend systems, Actix, Axum, memory safety | `anbu-skill/rust-programming-expert` |
| Output formatting, concise response shaping | `anbu-skill/i-have-adhd` (`i-have-adhd`) |
