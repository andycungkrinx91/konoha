# Infrastructure Workflows

> Read when: executing end-to-end infrastructure delivery, phased implementation plans, or multi-domain tasks.

## Contents

- Terraform module creation
- Cloud deployment (new environment)
- Kubernetes + Helm delivery
- CI/CD pipeline hardening
- Cloud security review
- Shell automation
- Production readiness
- Incident hotfix
- Database performance review
- MySQL production readiness
- PostgreSQL optimization
- Qdrant performance tuning
- SQLite suitability review
- QA release readiness
- Bug report to fix verification
- Secure code review workflow
- MongoDB production readiness
- MongoDB security hardening
- Senior security architecture review
- AI application pentest
- LLM/RAG security review
- Vulnerability finding to remediation
- Python automation workflow
- Python CLI tooling workflow
- Python infra validation workflow
- Python script security review workflow
- Python + Terraform/Helm/Kubernetes helper workflow
- Python CI utility workflow
- Skill merge workflow

## Workflow 1: Terraform Module Creation

1. **Define scope** — identify resources, inputs, outputs, provider.
2. **Scaffold** — create `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`.
3. **Implement** — write resources with validation, tagging, encryption defaults.
4. **Validate** — `terraform fmt`, `terraform validate`, `tflint`.
5. **Security scan** — `checkov` or `tfsec` before merge.
6. **Test** — `terraform plan` against dev, verify outputs.
7. **Document** — README with inputs/outputs table, usage example.
8. **Publish** — tag version, add to module registry (leave git operations to the user).

## Workflow 2: Cloud Deployment (New Environment)

1. **Plan** — choose cloud, region, services (read provider-specific Terraform ref).
2. **Bootstrap** — create state backend (S3/GCS/Azure Storage), enable locking.
3. **Network** — VPC/VNet, subnets, firewall/SG, NAT gateway.
4. **Compute** — EKS/GKE/AKS or ECS/Cloud Run/Container Apps.
5. **Data** — RDS/Cloud SQL/Azure SQL with encryption, private endpoints, backups.
6. **Secrets** — Secrets Manager/Secret Manager/Key Vault.
7. **IAM** — service accounts with least privilege, workload identity.
8. **Observability** — logging, monitoring, alerting.
9. **CI/CD** — pipeline with security gates (read `ci-cd-security.md`).
10. **Security review** — run `cloud-security-review.md` checklist.

## Workflow 3: Kubernetes + Helm Delivery

1. **Scaffold chart** — `helm create` or manual (read `helm-chart-scaffolding.md`).
2. **Design values.yaml** — image, replicas, resources, probes, securityContext.
3. **Templates** — deployment, service, ingress, configmap, serviceaccount.
4. **Security** — non-root, read-only FS, drop caps, network policies.
5. **Multi-env** — `values-dev.yaml`, `values-staging.yaml`, `values-prod.yaml`.
6. **Validate** — `helm lint`, `helm template --dry-run`.
7. **Deploy** — Helm install/upgrade or GitOps (ArgoCD/Flux).
8. **Verify** — pod status, probes, logs, metrics.

## Workflow 4: CI/CD Pipeline Hardening

1. **Audit current pipeline** — identify gaps vs `ci-cd-security.md` checklist.
2. **Add security gates** — SAST, SCA, secret scanning, container scanning.
3. **Enable OIDC** — replace static cloud credentials.
4. **Pin actions** — SHA or major version.
5. **Restrict permissions** — explicit `permissions:` block.
6. **Add deployment gates** — environment protection, approvals.
7. **Sign artifacts** — Cosign, SBOM generation.
8. **Test** — verify gates block vulnerable code/images.

## Workflow 5: Cloud Security Review

1. **Scope** — accounts, regions, services to review.
2. **Run automated scan** — Prowler (AWS), ScoutSuite (multi-cloud).
3. **Manual review** — check `cloud-security-review.md` domains.
4. **Document findings** — severity, location, issue, fix, verification.
5. **Prioritize** — critical/high first, with clear remediation steps.
6. **Track** — assign owners, set deadlines, follow up.

## Workflow 6: Shell Automation

1. **Define task** — what's being automated, input/output, frequency.
2. **Write script** — follow `shell-scripting.md` template (strict mode, trap, args).
3. **Add dry-run** — preview mode for destructive operations.
4. **Test** — verify on staging or with test data.
5. **Document** — usage, dependencies, safety assumptions.
6. **Deploy** — cron, systemd timer, or CI/CD step.

## Workflow 7: Production Readiness

1. **Infrastructure** — IaC for all resources, no manual console changes.
2. **Security** — full `cloud-security-review.md` pass.
3. **Monitoring** — golden signals (latency, traffic, errors, saturation).
4. **Alerting** — burn-rate alerts with runbook links.
5. **Incident response** — severity levels, escalation paths, postmortem process.
6. **Backups** — automated, tested restore procedure.
7. **CI/CD** — security gates, deployment approvals, rollback plan.
8. **Documentation** — architecture diagram, runbooks, on-call rotation.

## Workflow 8: Incident Hotfix

1. **Assess** — severity, blast radius, user impact.
2. **Mitigate** — rollback, scale, or disable feature flag.
3. **Verify** — metrics normal for 30 min.
4. **Hotfix** — minimal code change, security scan, fast-track review.
5. **Deploy** — through CI/CD (skip non-essential gates if SEV1).
6. **Postmortem** — schedule within 48h, blameless, action items tracked.

## Workflow 9: Database Performance Review (Any Engine)

1. **Capture baseline** — p95/p99 latency, throughput, error rate, top slow queries.
2. **Profile workload** — read/write ratio, query shapes, hot tables/collections.
3. **Inspect plans** — verify indexes are used and scans are intentional.
4. **Prioritize fixes** — highest latency + highest frequency first.
5. **Apply safely** — stage/index changes with rollback and migration plan.
6. **Re-measure** — compare before/after and document impact.

## Workflow 10: MySQL Production Readiness

1. **Engine/config** — confirm InnoDB default, utf8mb4, safe sql_mode.
2. **Schema/index review** — validate PK/FK/constraints and composite indexes.
3. **Query review** — run `EXPLAIN FORMAT=JSON`, remove anti-patterns.
4. **Reliability** — verify backups, restore drill, replication lag alerts.
5. **Security** — least-privilege users, TLS, prepared statements, audit logging.
6. **Operate** — enable slow query log and schedule ANALYZE/maintenance.

## Workflow 11: PostgreSQL Optimization

1. **Observe** — enable and review `pg_stat_statements` for top query cost.
2. **Analyze** — use `EXPLAIN (ANALYZE, BUFFERS)` for slow statements.
3. **Tune schema/indexes** — add right index types (btree/GIN/GiST/partial/expression).
4. **Manage bloat/stats** — verify autovacuum, run VACUUM/ANALYZE as needed.
5. **Concurrency** — inspect lock waits, transaction length, and pool sizing.
6. **Ship safely** — use reversible migrations and verify rollback path.

## Workflow 12: Qdrant Performance Tuning

1. **Define SLO** — set latency/throughput targets by query type.
2. **Validate model fit** — confirm vector dimensions, distance metric, payload filters.
3. **Tune index/build** — set HNSW (`m`, `ef_construct`, `hnsw_ef`) and indexing thresholds.
4. **Index payload first** — add filter indexes before heavy filtered ANN traffic.
5. **Scale I/O** — batch upserts and use limited parallel streams.
6. **Stability** — monitor optimizer status, memory, snapshots, and replica health.

## Workflow 13: SQLite Suitability Review

1. **Fit check** — confirm embedded/local-first workload and write concurrency needs.
2. **Safety PRAGMAs** — enable `foreign_keys`, WAL, and explicit synchronous policy.
3. **Schema/indexes** — design compact schema and indexes for real access paths.
4. **Concurrency test** — validate single-writer behavior under expected bursts.
5. **Backup/recovery** — implement file backup + restore validation.
6. **Escalation rule** — define when to move to client/server database.

## Workflow 14: QA Release Readiness

1. **Scope + risk** — define release scope, critical paths, and risk ranking.
2. **Plan coverage** — smoke, regression, API/UI, performance, exploratory.
3. **Gate criteria** — pass/fail thresholds, blocker definitions, sign-off owners.
4. **Defect review** — verify severity accuracy and unresolved risk acceptance.
5. **Go/No-Go** — run readiness checklist and decision log.
6. **Post-release checks** — monitor key metrics and fast rollback triggers.

## Workflow 15: Bug Report to Fix Verification

1. **Reproduce** — validate bug with clear steps, environment, and expected vs actual.
2. **Isolate** — identify scope, affected components, and regression risk.
3. **Fix review** — verify targeted change, tests added/updated, no side effects.
4. **Retest** — run original repro + adjacent scenarios + negative tests.
5. **Close criteria** — confirm acceptance criteria met and evidence attached.
6. **Regression guard** — add or update automated test to prevent recurrence.

## Workflow 16: Secure Code Review Workflow

1. **Scope** — identify trust boundaries, auth flows, and external inputs.
2. **Triage** — scan for Critical/High classes first (authz bypass, injection, secret exposure).
3. **Validate** — reproduce with safe test payloads and identify root cause.
4. **Remediate** — implement least-privilege checks, validation/encoding, and safer defaults.
5. **Verify** — add/update tests and confirm no sensitive data leaks to logs/errors.
6. **Report** — severity, exploitability, impact, fix, owner, due date.

## Workflow 17: MongoDB Production Readiness

1. **Model fit** — confirm embed vs reference choices align with query shapes.
2. **Index pass** — verify compound/partial/TTL/text/geospatial index coverage.
3. **Query pass** — validate `lean/select/cursor` usage and `explain("executionStats")` for hot paths.
4. **Reliability** — test backup/restore, replica health, and failover behavior.
5. **Security** — enforce RBAC, TLS, private networking, and secret-manager credentials.
6. **Operate** — define alerts for slow queries, replication lag, disk growth, and connection pressure.

## Workflow 18: MongoDB Security Hardening

1. **Access control** — disable anonymous access; map app roles to minimal DB actions.
2. **Network control** — restrict ingress to private networks and approved clients only.
3. **Transport/data protection** — require TLS in transit and encryption at rest.
4. **Injection defenses** — use typed validation and operator allowlists for dynamic filters.
5. **Observability** — enable audit/security logs and alert on auth failures/spikes.
6. **Recovery posture** — ensure immutable backups and documented restore drill.

## Workflow 19: Senior Security Architecture Review

1. **Threat model** — run STRIDE by component and trust boundary.
2. **Attack surface map** — APIs, admin paths, CI/CD, cloud control planes, data stores.
3. **Control review** — IAM least privilege, segmentation, secrets lifecycle, logging/audit.
4. **Risk rank** — score by likelihood × impact; prioritize P1/P2 remediation.
5. **Plan** — assign owners, deadlines, compensating controls, and validation criteria.
6. **Executive summary** — top risks, business impact, timeline, and residual risk.

## Workflow 20: AI Application Pentest (Authorized)

1. **Scope + authorization** — confirm explicit permission, in-scope systems, and constraints.
2. **Prompt abuse tests** — run safe prompt-injection/jailbreak checks for policy bypass.
3. **Tool abuse tests** — verify tool/function authorization and parameter validation.
4. **Data leakage tests** — assess model outputs for sensitive prompt/context disclosure.
5. **Abuse controls** — test rate limits, quotas, and anomaly logging.
6. **Remediation report** — severity, reproducible safe payload, mitigation, retest result.

## Workflow 21: LLM/RAG Security Review

1. **Ingestion trust** — validate source authenticity and poisoning resistance.
2. **Retrieval safety** — enforce document-level ACLs and tenant isolation.
3. **Context handling** — classify/redact sensitive context before model invocation.
4. **Output guardrails** — apply schema validation, allowlists, and policy checks.
5. **Telemetry** — log prompt/tool/document lineage for incident response.
6. **Regression suite** — keep reusable defensive payload tests for future releases.

## Workflow 22: Vulnerability Finding to Remediation

1. **Record** — standardized finding entry (severity, evidence, affected assets).
2. **Contain** — immediate mitigations for Critical/High issues.
3. **Fix** — root-cause remediation plus defense-in-depth control.
4. **Validate** — retest exploit path and adjacent abuse paths.
5. **Close** — document residual risk and update secure coding/architecture standards.
6. **Learn** — add checklist item, detection rule, or test to prevent recurrence.

## Workflow 23: Python Automation Workflow

1. **Scope** — define inputs, outputs, side effects, and failure mode.
2. **Safety** — add dry-run for modifications and validate paths/resources before changes.
3. **Implement** — use typed functions, context managers, specific exceptions, safe logging.
4. **Validate** — add pytest coverage for success, failure, invalid input, and dry-run.
5. **Operate** — document invocation, dependencies, environment variables, and rollback notes.

## Workflow 24: Python CLI Tooling Workflow

1. **Interface** — choose `argparse` for dependency-light scripts or Typer/Click for richer CLIs.
2. **Inputs** — validate paths, enums, config files, and environment variables.
3. **Output** — provide human-readable logs and machine-readable JSON when useful for CI.
4. **Exit codes** — return `0` for pass/no-op and non-zero for actionable failures.
5. **Docs** — include sample commands and install instructions.

## Workflow 25: Python Infra Validation Workflow

1. **Collect** — read Terraform output/plan JSON, Kubernetes status, cloud API state, or CI artifacts.
2. **Check** — compare actual state to explicit policy/expected values.
3. **Report** — summarize failures with resource IDs and remediation hints, redacting secrets.
4. **Fail safely** — avoid mutating infrastructure unless explicitly requested.
5. **Gate** — integrate as a CI step with deterministic exit codes.

## Workflow 26: Python Script Security Review Workflow

1. **Review inputs** — files, env vars, CLI args, API responses, and subprocess outputs.
2. **Check secrets** — no hardcoded credentials or unsafe logging.
3. **Check subprocess** — argument lists, explicit `cwd`, no unsafe `shell=True`, timeouts.
4. **Check filesystem** — path validation, dry-run/backup for writes/deletes.
5. **Check network** — TLS defaults, timeouts, retries for idempotent calls, safe error handling.

## Workflow 27: Python + Terraform/Helm/Kubernetes Helper Workflow

1. **Route first** — use `python-expert.md`; add Terraform/Helm/Kubernetes reference only for domain semantics.
2. **Prefer APIs** — use JSON outputs or official APIs when practical.
3. **Shell safely** — pass command lists, set timeout/cwd, capture output, and redact logs.
4. **Avoid hidden mutation** — do not wrap destructive infra commands without confirmation and dry-run.
5. **Verify** — include sample invocation and CI-safe validation command.

## Workflow 28: Python CI Utility Workflow

1. **Inputs** — define expected files/artifacts and fail clearly if missing.
2. **Determinism** — produce stable output paths and sorted report content.
3. **Security** — redact env vars, tokens, and secret-like values in logs/artifacts.
4. **Dependencies** — document `uv`/`pip` install commands or vendor-free stdlib approach.
5. **Gate** — exit non-zero on policy violations and upload reports for debugging.

## Workflow 29: Skill Merge Workflow

1. **Route first** — load `skill-creator.md` only; add DevSecOps domain references only if their content must be inspected or edited.
2. **Back up** — copy the target skill before edits and keep source skill folders untouched.
3. **Inspect** — compare source and target `SKILL.md`, routing, references, scripts, and assets.
4. **Merge additively** — preserve existing routes and references; add a focused reference when guidance does not clearly fit an existing file.
5. **Keep token-safe** — leave `SKILL.md` compact and put detailed Skill creation or merge guidance in references.
6. **Validate/package** — check frontmatter, routing, old-route preservation, source folder preservation, and package size or available package scripts.

## Phased Output Format

When generating implementation plans, use:

```
## Phase N: [Name]

### Goal
[One sentence — what works after this phase]

### Tasks
1. [Task with file path or command]
2. [Task with file path or command]

### Files
- `path/to/file` — [purpose]

### Validation
- [ ] [How to verify this phase]

### Risks
- [What could go wrong, mitigation]

### Dependencies
- Requires Phase N-1
- External: [API key, DNS, etc.]
```

## Multi-Cloud Routing

When a task involves multiple clouds:
1. Use the provider-specific Terraform reference for each cloud.
2. Keep shared concepts (module structure, state, variables) consistent.
3. Use `infrastructure-workflows.md` for orchestration sequencing.
4. Use `cloud-security-review.md` for cross-cloud security posture.
