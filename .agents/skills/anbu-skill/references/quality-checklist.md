# Quality Checklist

> Read before finalizing large outputs: Terraform modules, Helm charts, shell scripts, security reviews, or infrastructure plans.

## Contents

- Correctness
- Security
- Least Privilege
- Idempotency & Reversibility
- Destructive Command Risk
- Secret Exposure Risk
- Terraform State Safety
- Kubernetes Workload Safety
- CI/CD Safety
- Cost Risk
- Observability
- Maintainability
- Python Automation Review
- Security Code Review
- MongoDB Review
- Senior Security Review
- AI Pentest / LLM Security Review
- MySQL Review
- PostgreSQL Review
- Qdrant Review
- SQLite Review
- QA / Release Readiness Review
- Skill Merge / Package Review
- Copy-Paste Readiness
- Token Efficiency

## Correctness

- [ ] Code is syntactically valid (`terraform validate`, `helm lint`, `bash -n`)
- [ ] All referenced resources, modules, and files exist
- [ ] Logic handles edge cases (empty inputs, missing vars, error states)
- [ ] Variable validation blocks catch invalid input
- [ ] Outputs defined for downstream consumption

## Security

- [ ] No hardcoded secrets, passwords, or API keys
- [ ] IAM follows least privilege (wildcards strictly banned)
- [ ] Encryption enabled (at rest and in transit)
- [ ] Network access minimized (no 0.0.0.0/0 on non-public ports)
- [ ] Secrets stored in external vault; `.env` files strictly banned in production
- [ ] Container security: distroless/scratch only, non-root, read-only FS, drop ALL caps
- [ ] RBAC namespace-scoped, not cluster-admin for apps
- [ ] CI/CD: OIDC exclusively, no static credentials, gates block on failure

## Least Privilege

- [ ] IAM roles/policies grant only required actions
- [ ] Service accounts are per-workload, not shared
- [ ] Network rules allow only required traffic
- [ ] K8s RBAC is namespace-scoped with minimal verbs
- [ ] CI/CD permissions block is explicit

## Idempotency & Reversibility

- [ ] Terraform: `plan` shows expected changes, no surprises
- [ ] Scripts support `--dry-run` for destructive operations
- [ ] Helm: `upgrade --install` is idempotent
- [ ] Database migrations are backward-compatible
- [ ] Rollback procedure documented

## Destructive Command Risk

- [ ] No unguarded `rm -rf`, `terraform destroy`, `kubectl delete`
- [ ] Confirmation prompts for destructive operations
- [ ] Backups taken before state-changing commands
- [ ] `deletion_protection` on production databases
- [ ] `lifecycle { prevent_destroy = true }` on critical resources

## Secret Exposure Risk

- [ ] No secrets in Terraform state shown in outputs (use `sensitive = true`)
- [ ] No secrets echoed in CI/CD logs
- [ ] No secrets in Dockerfiles or container images
- [ ] `.env` files in `.gitignore`
- [ ] Pre-commit hooks for secret detection

## Terraform State Safety

- [ ] Remote state with encryption and locking
- [ ] State not in version control
- [ ] Sensitive outputs marked `sensitive = true`
- [ ] State access restricted to authorized principals
- [ ] Import used for existing resources (not recreate)

## Kubernetes Workload Safety

- [ ] Resource requests and limits set
- [ ] Liveness and readiness probes defined
- [ ] SecurityContext enforced (non-root, read-only, drop caps)
- [ ] No `:latest` tags
- [ ] Network policies applied
- [ ] PodDisruptionBudget for critical workloads

## CI/CD Safety

- [ ] Actions and runners strictly pinned to SHA hashes (no `@v4` or `@latest`)
- [ ] Security gates block deploy on failure
- [ ] Production requires manual approval
- [ ] SLSA Level 3+ enforced (SBOM generated, Cosign signed)
- [ ] OIDC used exclusively for cloud auth (static credentials banned)

## Cost Risk

- [ ] No unbounded autoscaling (max limits set)
- [ ] Right-sized instances for environment (smaller for dev)
- [ ] Lifecycle policies on storage (archive/delete old data)
- [ ] Spot/preemptible instances where appropriate
- [ ] Cost tags on all resources

## Observability

- [ ] Logging enabled for all services
- [ ] Metrics exported (golden signals)
- [ ] Alerts with runbook links
- [ ] Dashboard for key SLIs
- [ ] Audit logging for security events

## Maintainability

- [ ] Code follows existing project conventions
- [ ] Modules are focused (one concern each)
- [ ] Variables have descriptions
- [ ] Outputs documented
- [ ] Environment separation (dev/staging/prod)
- [ ] README with usage examples

## Python Automation Review

- [ ] Script is idempotent where possible and repeated runs are safe
- [ ] Destructive actions require dry-run, confirmation, backup, or explicit approval
- [ ] Paths are validated before deleting, overwriting, moving, or changing permissions
- [ ] Secrets are not hardcoded, printed, logged, or embedded in examples
- [ ] Subprocess calls use argument lists, not unsafe shell strings
- [ ] Network calls have timeouts and retries where appropriate
- [ ] Errors are handled with specific exceptions and clear exit codes/messages
- [ ] Logs include useful context but redact tokens, secrets, and sensitive payloads
- [ ] Config and environment variable handling is explicit and documented
- [ ] Tests or sample invocation are included (`pytest`, dry-run, invalid input cases)
- [ ] File paths and commands are copy-paste-ready
- [ ] Dependency installation is documented (`uv`, `venv`, `pip`, or project standard)

## Security Code Review

- [ ] Authentication logic verifies identity correctly (no weak fallback/bypass)
- [ ] Authorization enforced server-side for every sensitive object/action (IDOR/BOLA checked)
- [ ] Input validation and normalization implemented before business logic
- [ ] Injection risks addressed (SQL/NoSQL/command/template) with parameterization and allowlists
- [ ] Output encoding/sanitization applied where XSS or content injection is possible
- [ ] Secret exposure checked (source, configs, logs, stack traces, CI artifacts)
- [ ] Sensitive logging reduced/redacted (tokens, passwords, PII, full payloads)
- [ ] Dependency/supply-chain risk reviewed (pinned versions, known CVEs, risky transitive deps)
- [ ] Abuse controls present (rate limit, lockout/throttling, anti-automation as needed)
- [ ] Framework-specific protections verified (CSRF/CORS/session/cookie flags where relevant)

## MongoDB Review

- [ ] Collection/document model matches access patterns (embed vs reference rationale documented)
- [ ] Indexes reviewed for hot paths (compound/unique/partial/TTL/text/geospatial as needed)
- [ ] Query safety/performance validated (`select`, `lean`, cursor/batch patterns, `explain("executionStats")`)
- [ ] NoSQL injection prevented (typed validation and operator allowlist for dynamic filters)
- [ ] Authentication + RBAC enforce least privilege for app/runtime/admin users
- [ ] Network exposure minimized (private endpoints, IP allowlists, no public admin interfaces)
- [ ] TLS in transit and encryption/secret management standards are enforced
- [ ] Backup/restore tested with clear RPO/RTO and monitoring/alerting coverage
- [ ] Replication/sharding decisions align with scale and resilience needs
- [ ] Production monitoring covers connections, slow queries, lag, disk, and failover health

## Senior Security Review

- [ ] Threat model complete (assets, trust boundaries, attacker goals, STRIDE coverage)
- [ ] Attack surface inventory includes APIs, admin/control plane, CI/CD, data stores, third-party integrations
- [ ] IAM least-privilege validated with role separation and break-glass controls
- [ ] Secrets management lifecycle reviewed (creation, rotation, revocation, auditability)
- [ ] Network boundaries/segmentation enforce least exposure across tiers
- [ ] Logging/auditing supports detection, forensics, and compliance obligations
- [ ] Risks prioritized by likelihood × impact with explicit remediation ownership
- [ ] Defense-in-depth controls documented (preventive + detective + corrective)
- [ ] Incident response readiness includes P1-P4 severity mapping and escalation path

## AI Pentest / LLM Security Review

- [ ] Prompt injection tested defensively with bounded payloads and clear expected-safe behavior
- [ ] Indirect prompt injection tested through external content/chunks/tools
- [ ] Tool/function call permissions enforce authz and parameter constraints
- [ ] RAG retrieval enforces tenant/document-level access controls; poisoning risks evaluated
- [ ] Sensitive data leakage checked in outputs, logs, traces, and memory/context windows
- [ ] Output validation/guardrails enforce schema and policy before high-risk actions
- [ ] Abuse protections validated (rate limit, quotas, anomaly detection, safe fallbacks)
- [ ] Findings include reproducible safe test case + remediation + retest status

## MySQL Review

- [ ] MySQL is an appropriate fit (OLTP, transactional, relational integrity requirements)
- [ ] InnoDB is default with utf8mb4 and strict SQL mode
- [ ] Schema types are intentional (`DECIMAL` for money, optional `BINARY(16)` UUID strategy)
- [ ] PK/FK/constraints exist and match access patterns
- [ ] Indexes reviewed (composite/covering/fulltext where needed)
- [ ] Slow queries analyzed with `EXPLAIN FORMAT=JSON`
- [ ] Anti-patterns removed (`SELECT *`, functions on indexed columns, implicit conversions, leading wildcard)
- [ ] Transactions/isolation/deadlock handling and connection pooling validated
- [ ] Backup/restore test, replication lag monitoring, least privilege, TLS, prepared statements, audit logging configured
- [ ] Maintenance is scheduled (`ANALYZE`, slow query logging, and periodic index/statistics review)

## PostgreSQL Review

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` used for critical queries
- [ ] `pg_stat_statements` enabled and reviewed for top cost/latency queries
- [ ] Correct index types used (btree, GIN/GiST for JSONB/FTS/ranges, partial/composite/expression/covering)
- [ ] VACUUM/ANALYZE/autovacuum and table statistics are healthy
- [ ] Locking and transaction duration reviewed; pooler (`pgbouncer`) sizing validated
- [ ] Partitioning/materialized views considered for heavy workloads
- [ ] Migrations are safe with rollback path and monitoring in place
- [ ] Pagination and aggregation patterns use efficient query shapes (e.g., cursor pagination, selective partial indexes)

## Qdrant Review

- [ ] Latency vs throughput SLO and query mix are explicit
- [ ] Collection/vector dimensions and distance metric are validated
- [ ] HNSW tuned (`m`, `ef_construct`, `hnsw_ef`) for target workload
- [ ] `indexing_threshold` and payload indexes are configured before heavy filtered search
- [ ] Upserts are batched (64-256) with controlled parallel streams (2-4)
- [ ] Shards/replicas and quantization choices match scale/cost goals
- [ ] On-disk vs RAM strategy documented, including RSS vs page-cache expectations
- [ ] Snapshot/backup restore tested, optimizer status monitored, `indexed_only`/`prevent_unoptimized` used when consistency is required

## SQLite Review

- [ ] SQLite is suitable (embedded/local-first/cache/desktop) and not overused for high-concurrency server writes
- [ ] PRAGMAs set intentionally (`foreign_keys=ON`, WAL, `synchronous`, `temp_store`)
- [ ] Schema and indexes match read/write patterns, including FTS5 if needed
- [ ] Migrations/versioning/rollback strategy defined (including copy-table pattern)
- [ ] Parameterized queries are used; dynamic sort/filter uses whitelist mapping
- [ ] Transaction boundaries are explicit and single-writer concurrency limits are handled
- [ ] Backup and file-permission security controls are documented (plus encryption considerations)
- [ ] Performance caveats and escalation criteria to client/server DB are defined

## QA / Release Readiness Review

- [ ] QA strategy and risk-based test plan exist for release scope
- [ ] Acceptance criteria are validated for clarity and INVEST quality
- [ ] Test cases follow a consistent template (preconditions, steps, expected results, data)
- [ ] Coverage includes equivalence, boundary, decision table, and state-transition techniques where applicable
- [ ] Smoke/regression/exploratory/API/UI/performance testing scope is explicit
- [ ] Security testing handoff and responsibilities are defined
- [ ] CI gates and test pyramid are aligned to release risk
- [ ] Bug reports are high quality (repro, env, severity, evidence) and fix verification workflow is complete
- [ ] Go/no-go decision includes unresolved defects, mitigation, and rollback readiness

## Skill Merge / Package Review

- [ ] Skill frontmatter contains valid `name` and `description` only
- [ ] `SKILL.md` remains compact and router-based
- [ ] New and existing references are routed clearly
- [ ] No existing target references were removed or renamed
- [ ] No source skill folders were deleted
- [ ] Package size stays under 25MB
- [ ] Validation/package checks were run or absence of scripts was documented

## Copy-Paste Readiness

- [ ] File paths specified for all code
- [ ] Commands include necessary flags and context
- [ ] No placeholder values (or clearly marked as `CHANGE_ME`)
- [ ] Assumptions stated upfront
- [ ] Non-obvious decisions explained briefly

## Token Efficiency

- [ ] Answer is practical and actionable
- [ ] No vague advice or generic best practices
- [ ] Only relevant guidance included
- [ ] Phased steps for complex tasks
- [ ] Rollback procedure included where applicable
