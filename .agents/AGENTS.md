# Custom Agent Rules for Konoha

- **No `skilladd` Command**: Under no circumstances should `konoha skilladd` or `node bin/cli.js skilladd` be implemented, documented, or used. Only use `konoha skill add` to directly install a skill from a Git repository.
- **Strict No-Push / No-Release / No-Publish Invariant (Git & npm)**: Under NO circumstances should any agent, tool, or command execute `git push`, `git tag`, `git release`, `npm publish`, `pnpm publish`, `yarn publish`, or trigger any remote publishing or release workflows. All changes, tests, audits, and documentation must strictly remain local to this repository.

## Permanent Maintenance Rules

### Rule 1 — No Public Release or Publication
Never push changes to Git remotes, publish packages to public npm registries, create public releases, deploy, or publish artifacts externally unless the repository owner explicitly authorizes a future exception. Local implementation and local verification are allowed. Do not run release or deployment commands as part of ordinary maintenance tasks.

### Rule 2 — Required Local Commit Identity
When a task explicitly calls for committing verified changes locally, use this exact Git author identity:
`andycungkrinx91 <andy.silva270114@gmail.com>`
Verify the effective author identity for the commit. Do not push the commit to a remote. Do not create commits automatically when the task has not authorized committing. Finish implementation and verification first, then commit only when appropriate.

### Rule 3 — PLAN.md First, Never Commit Plans
- Create the root `PLAN.md` before implementation changes for every substantial maintenance task.
- The plan must be execution-ready, architecture-aware, and contain acceptance criteria and verification steps.
- Update the plan as implementation progresses when necessary.
- Never include root `PLAN.md` or files under `.omp/plans/` in a commit.
- The root `.gitignore` must exclude (single consolidated block):
  ```gitignore
  /PLAN.md
  PLAN.md
  /.omp/plans/
  .omp/plans/
  .omp/plans
  .omp/
  ```
- Inspect the existing Git ignore rules and repository status before changing them.
- If either path is already tracked, explicitly untrack it from the Git index (`git rm --cached`) without deleting the local file.
- Do not stage unrelated files.
- Verify the final staged file list before committing.

### Rule 4 — Konoha Skills Must Match the Actual Codebase
Konoha maintenance skills must accurately describe the current source code, architecture, APIs, workflows, file paths, configuration, and tests.
For every relevant skill:
- Inspect its instructions and supporting references.
- Verify every material implementation claim against the actual source.
- Identify stale assumptions, obsolete file paths, unsupported commands, and outdated architecture descriptions.
- Update or remove obsolete instructions according to the existing maintenance conventions.
- Do not create legacy aliases or duplicate subsystems merely to preserve outdated instructions.
- Ensure examples and commands are executable against the current codebase where applicable.
- Verify that referenced tests and tools actually exist.

### Rule 5 — Mandatory Manual Documentation and Asset Audit
For every substantial maintenance task, manually inspect all relevant documentation and assets for consistency with the implementation.
Required audit scope:
- All Markdown documentation under `docs/`.
- Existing project guides and maintenance guides.
- Architecture diagrams and Mermaid diagrams.
- Draw.io diagrams and their editable source files.
- Maintenance skills and their supporting reference files.
- All relevant assets under `assets/`.
- README files, architecture descriptions, configuration examples, and workflow documentation affected by the changes.
- Open and inspect actual files; do not substitute automated scripts for manual review.
- Review decisions:
  - Manually read every file in scope before editing it.
  - Correct only claims that the current implementation made stale.
  - Record what was actually inspected and leave unrelated documents or assets untouched without claiming they were audited.
  - Regenerate skill mirrors only through `node scripts/sync_skills.js` after editing the canonical `.agents/skills/` source.
