---
name: anbu-skill
description: Standard Operating Procedures for backend development, bug fixing workflows, and safe infrastructure operations.
tags:
  - anbu
  - backend
  - bugfix
  - devops
  - database
---

# Anbu: Backend, Bug Fixing & DevOps (SOP)

This skill provides the **Standard Operating Procedures (SOP)** for the Anbu (Black Ops Engineer) when tasked with backend development, infrastructure changes, database migrations, or resolving critical bugs.

> [!IMPORTANT]  
> **Minimal Safe Changes**: Always diagnose the root cause *before* writing code. Never rewrite a system just to fix a single bug. Always validate changes with dry-runs.

## 🛠️ Operational Protocol
- If you need language-specific knowledge (e.g., Go, Python, Laravel), use `find_skill` to load the respective backend/framework reference.
- If you need infrastructure tools (e.g., Terraform, AWS, K8s), use `find_skill` to load DevSecOps modules.

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

## SOP 4: Development Server Run & Browser Preview (Stitch Integration)
*When `@jonin` or the coordinator delegates the server startup and browser preview of a built project.*

1. **Background Server Startup**:
   - Use `run_command` (or equivalent background task management) to run the development server in the background (e.g., `pnpm run dev --host 0.0.0.0` or `pnpm run dev`) from the designated project directory.
2. **Immediate Browser Preview**:
   - Wait for the server to spin up and bind to its port (e.g. `5173` or `3000`).
   - Once the server is running, immediately open the browser using the `agent-browser` tool to the dev server link (e.g., `http://localhost:5173` or `http://localhost:3000`) to load the website preview.
3. **Visual Verification**:
   - Verify styling, layouts, and print the active local access URLs in the final report.

