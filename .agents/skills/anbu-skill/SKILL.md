---
name: anbu-skill
description: Standard Operating Procedures and router for backend development, bug fixing workflows, and safe infrastructure operations.
tags:
  - anbu
  - backend
  - bugfix
  - devops
  - database
---

# Anbu: Backend, Bug Fixing & DevOps (Router & SOP)

This skill provides the **Standard Operating Procedures (SOP)** and routing logic for the Anbu (Black Ops Engineer) when tasked with backend development, infrastructure changes, database migrations, or resolving critical bugs.

> [!IMPORTANT]  
> **Minimal Safe Changes**: Always diagnose the root cause *before* writing code. Never rewrite a system just to fix a single bug. Always validate changes with dry-runs.

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`skills-db` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns quota tokens. Always use `skills-db` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## Domain Routing

Based on the user's request, load the specific reference file using `skills-db.get_skill("anbu-skill/<reference-name>")` to understand the architecture and conventions. **Never guess the implementation details or read files under .agents/skills/ directly.**

| If the request involves... | Load this reference |
|---|---|
| Golang backend, fundamentals, testing | `anbu-skill/golang-fundamentals`, `anbu-skill/golang-testing` |
| Golang performance, concurrency, security | `anbu-skill/golang-performance`, `anbu-skill/golang-concurrency`, `anbu-skill/golang-security` |
| FastAPI backend, endpoints, validation | `anbu-skill/fastapi-expert`, `anbu-skill/fastapi-code-review` |
| Laravel backend, routing, security | `anbu-skill/laravel-specialist`, `anbu-skill/laravel-security` |
| Python scripting, CLI, automation | `anbu-skill/python-expert` |
| Shell scripting, bash automation | `anbu-skill/shell-scripting` |
| MySQL schema, tuning, performance | `anbu-skill/mysql-best-practices` |
| PostgreSQL queries, performance | `anbu-skill/postgresql-code-review` |
| SQLite schema, embedded DB | `anbu-skill/sqlite-database-expert` |
| MongoDB schemas, NoSQL | `anbu-skill/mongodb` |
| Qdrant vector database tuning | `anbu-skill/qdrant-performance-optimization` |
| CI/CD pipelines, Github Actions, GitLab CI | `anbu-skill/ci-cd-security` |
| Cloud security, IAM posture, reviews | `anbu-skill/cloud-security-review` |
| Container security, DevSecOps architecture | `anbu-skill/devsecops-expert` |
| Helm charts, K8s manifests | `anbu-skill/helm-chart-scaffolding` |
| AWS Terraform modules | `anbu-skill/terraform-aws-modules` |
| Azure Terraform modules | `anbu-skill/terraform-azure` |
| GCP Terraform modules | `anbu-skill/terraform-gcp` |
| Security code review, vulnerability review | `anbu-skill/code-review-security` |
| Senior security architecture review | `anbu-skill/senior-security` |
| AI LLM pentesting, prompt injection | `anbu-skill/shannon-ai-pentester` |
| QA strategy, test planning | `anbu-skill/senior-qa-engineer` |
| Infrastructure workflows | `anbu-skill/infrastructure-workflows` |
| Final review for larger backend/infra outputs | `anbu-skill/quality-checklist` |

### Guardrails
Load guardrail references only when needed using `skills-db.get_skill("anbu-skill/<reference-name>")`:

| Situation | Load |
|---|---|
| Shell commands, file changes, deployment, infra, scripts | `anbu-skill/command-safety` |
| Commands, code, config, YAML/JSON, env files, metadata with character risk | `anbu-skill/character-hygiene` |
| `.env`, credentials, tokens, keys, logs, auth config | `anbu-skill/secret-safety` |
| Large output, router ambiguity, or context risk | `anbu-skill/token-safety` |
| Security-sensitive, destructive, production, or risky task | `anbu-skill/guardrails` |

### Authorized Scripts
Scripts in `scripts/` are defensive tools only. Do not run them without authorization.

| Script | Purpose | Run command |
|---|---|---|
| `scripts/threat_modeler.py` | STRIDE-based threat modeling engine | `python threat_modeler.py <target_dir>` |
| `scripts/security_auditor.py` | Multi-layer security posture auditor | `python security_auditor.py <target_dir>` |
| `scripts/pentest_automator.py` | Authorized static penetration testing tool | `python pentest_automator.py <target_dir> --confirm-authorized` |

---

## SOP 1: The Bug Resolution Workflow
*When tasked with fixing a broken endpoint, logic error, or system crash.*

1. **Reproduce & Isolate**:
   - Trace the error logs using `semble`.
   - Identify the exact file and line number causing the failure.
2. **Formulate Hypothesis**:
   - Determine *why* it failed (e.g., null pointer, race condition, missing DB index).
   - Before fixing, write down the hypothesis.
3. **Implement Minimal Fix**:
   - Write the smallest possible code change that resolves the root cause.
   - Do NOT refactor surrounding code unless it directly contributes to the bug.
4. **Validation & Rollback**:
   - Run local unit tests (if they exist).
   - Define a clear rollback plan: "If this breaks production, we revert commit X".

## SOP 2: Safe Database Migrations
*When tasked with altering schema (adding columns, dropping tables, changing types).*

1. **Non-Destructive First**:
   - Never drop a column that is currently being read by the application.
   - Phase 1: Add new column -> Deploy -> Phase 2: Dual-write -> Deploy -> Phase 3: Drop old column.
2. **Migration Scripts**:
   - Generate the proper migration file for the framework (e.g., Prisma, Eloquent, Alembic, Golang Migrate).
   - Ensure the `down()` or rollback method is perfectly written.
3. **Index Awareness**:
   - If adding a column that will be filtered on, add an index.
   - Warn the user if creating an index on a massive table (requires `CONCURRENTLY` in Postgres).

## SOP 3: Infrastructure / CI-CD Changes
*When modifying Terraform, Dockerfiles, or GitHub Actions.*

1. **Review Blast Radius**:
   - Ask: "Will this restart the database?", "Will this cause downtime?"
2. **Dry-Runs Only**:
   - Always run `terraform plan` before `terraform apply`.
   - Never apply infrastructure changes without the user explicitly approving the plan output.
3. **Secrets Safety**:
   - Never hardcode credentials. Use `${var.secret}` or GitHub Secrets.
   - If you must read `.tfvars` or `.env`, explicitly ask the user for permission first.

## SOP 4: Development Server Run & Browser Preview
*When `@jonin` or the coordinator delegates the server startup and browser preview of a built project.*

1. **Background Server Startup**:
   - You MUST run the development server yourself in the background using your tools (e.g., `ulimit -n 65536 && pnpm run dev --host 0.0.0.0` or `ulimit -n 65536 && pnpm run dev`) from the designated project directory. This prevents `EMFILE: too many open files` errors. NEVER instruct the user to run it.
2. **Immediate Browser Preview**:
   - Wait for the server to spin up and bind to its port (e.g. `5173` or `3000`).
   - Once the server is running, immediately open the browser using the `agent-browser` tool to the dev server link (e.g., `http://localhost:5173` or `http://localhost:3000`) to load the website preview.
3. **Visual Verification**:
   - Verify styling, layouts, and print the active local access URLs in the final report.
