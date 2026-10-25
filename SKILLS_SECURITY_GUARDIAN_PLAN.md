# Skills Security, Guardian Installation, and Modularization

## Context
Perform a repository-wide security and maintainability implementation. The end state is a dependency-audited, cross-platform skills system with a public-skill installation guardian, accurate bounded tool-file retrieval, reusable Chunin research knowledge, and modular code with no script file above 700 lines. Preserve the existing canonical persistence model, default password `konohagakure`, and release behavior; do not introduce a new database schema.

## Approach

1. **Inventory the repository before changing code.** Inspect `/home/andycungkrinx/experiment/portofolio/data/konoha`: manifests, lockfiles, runtimes, all skill entrypoints, MCP/tool definitions, persistence adapters, tests, docs, diagrams, Draw.io files, assets, `.gitignore`, `.npmignore`, container/release files, and QA instructions. Record exact paths, symbols, and line counts. Locate every Python and JavaScript/TypeScript dependency manifest and determine whether Go already exists. Locate the canonical knowledge/persistence representation and all Chunin consumers; reuse it, with no new schema.

2. **Audit every skill and dependency.** Have `@genin` review every skill entrypoint, import boundary, subprocess/network/file operation, installer path, tool-file reader, and dependency manifest. Resolve installed versions from lockfiles and query authoritative OSV, npm, PyPI/project security notices, GitHub advisories, and vendor release notes. For every vulnerability record package, resolved version, advisory URL/ID, affected/fixed range, reachable path, and remediation. Block release for critical/high findings without a fixed version. Review registry allowlists, lockfile integrity, provenance, install scripts, archive traversal, symlinks, executable permissions, and post-install hooks. Preserve default password `konohagakure` and add a regression check if absent.

3. **Research the migration boundary with `@chunin`.** Use authoritative current sources for TypeScript/Node.js and Go: cross-platform packaging, dependency auditing, process isolation, startup, distribution, maintenance, and MCP compatibility. Prefer TypeScript when it matches the current runtime/npm/MCP contract and is the smallest safe migration; prefer Go only for a self-contained security-sensitive executable boundary where static distribution materially reduces risk. Migrate only bounded, high-value components after interfaces are verified, starting with guardian scanning and performance-critical tool operations. Keep public tool contracts stable, update all callers, and remove obsolete implementations. Pin versions using the existing lockfile mechanism and define the supported runtime/platform matrix from repository evidence.

4. **Implement a fail-closed public skill guardian.** Reuse existing search/install APIs and canonical metadata/knowledge storage. Flow: search; resolve exact source/version; download to isolated temporary staging; verify integrity and archive/path safety; scan source/metadata/dependencies/lifecycle scripts; evaluate; atomically install or block. Never execute untrusted hooks during inspection. Reject traversal, escaping symlinks, unexpected executables, obfuscated payloads, secret access, destructive commands, remote code download, persistence, suspicious network destinations, and scanner errors. Define risk score 0–100; any score above 30 blocks. Hard-fail critical advisory, malicious signature, traversal, or scanner error even at 30 or below. Return structured findings: severity, rule ID, evidence path/line, advisory/source URL, score, decision, remediation. Install atomically only after passing; handle repeats, conflicts, cancellation, and partial failures without live partial skills. Store bounded audit information via existing persistence.

5. **Refine tool-file accuracy.** Review current metadata, outline, bounded-range, and search tools against callers/tests. Reproduce omissions/inaccurate lines. Preserve exact inclusive range semantics, line numbers, truncation indicators, encoding/errors, and deterministic ordering. Use outline/symbol discovery before bounded reads for large files. Add behavior tests for first/last lines, boundary ranges, empty/long files, non-UTF-8 errors, stale metadata, and concurrent changes; tests must prove requested markers and line numbers. Keep client contracts compatible; update every caller for any necessary response/signature change.

6. **Persist complete Chunin research using the canonical model.** Store complete source-linked output with URLs, retrieval date, package/library IDs, versions, claims, and confidence/evidence boundaries. Similarity/reference lookup must consult this existing mechanism first, deduplicate using existing identity rules, and retain complete source material. Do not create a parallel schema.

7. **Refactor oversized scripts into MVC-aligned modules.** Identify every script above 600 lines and every script at/above 700. Split by behavior: model for domain data/validation/persistence, view for formatting/response presentation, controller for orchestration/request lifecycle; keep scan policy in focused services/policies. Reuse existing conventions/utilities and avoid one-implementation abstractions. Keep each script below 700 lines; update imports/exports/tool registrations/tests/manifests/client references and remove dead duplicates. Preserve contracts and `konohagakure`.

8. **Synchronize docs, diagrams, assets, and QA manually.** Review all `docs/`, guides, maintenance skills, diagrams, Draw.io sources, and `assets/` against final code paths and behavior without script-based rewrites. Update `docs/QA-TEST-CHECKLIST.md` with security, guardian, tool-range, knowledge, modularization, cross-platform, and release checks. Ensure WebP workflow/demo/diagram animations and Draw.io diagrams match the final flow; unresolved parity is a release blocker.

9. **Validate isolation and release boundaries.** Build/copy in isolated `/tmp/` without working-tree mutation. Run unit/integration checks and manually exercise: safe allow; score 31 block; critical advisory block regardless of score; malicious/traversal block; scanner failure block; atomic cleanup. Use Playwright and agent-browser for affected web UI. Audit dependencies, supported platforms, package contents, `.gitignore`/`.npmignore`, junk/cache/test exclusion, and release installation. Use `portofolio-git-1:/data/konoha` for container release validation; npm validation outside Docker. Run `npx aislop` only on changed/bounded scope and require zero findings/errors/warnings. Recheck docs/assets/knowledge against final code before commit.

10. **Commit only after all gates pass.** Never commit `PLAN.md` or `.omp/plans`; add `.omp/plans` to `.gitignore` if absent. Remove only generated junk introduced by this work. Commit with author `andycungkrinx91 <andy.silva270114@gmail.com>` and report exact evidence and commit ID.

## Critical files & anchors

- Dependency manifests/lockfiles: exact paths from inventory; define vulnerability scope and updates.
- Skill entrypoints, installer, and tool registration modules: exact paths from `@genin`; define public contracts and guardian insertion.
- Existing persistence/knowledge adapter and Chunin integration: exact paths before changes; no-new-schema boundary.
- File metadata/outline/range reader and tests: exact paths before accuracy changes.
- `docs/QA-TEST-CHECKLIST.md`, ignore files, release/container config, and affected docs/assets/diagrams: final synchronization/release gates.

## Verification

- Dependency audit lists all resolved direct/transitive dependencies with authoritative advisory results and no unresolved critical/high vulnerability or unreviewed install hook.
- Guardian fixtures prove clean allow, score 31 block, critical advisory block at score 30 or lower, traversal/symlink/obfuscation/download/install-hook block, scanner-error block, and no live partial directory after failure.
- Tool fixtures prove known markers and exact inclusive line numbers across boundaries/EOF, plus documented errors for stale metadata/unreadable files.
- Knowledge fixture stores Chunin output canonically and later equivalent lookup returns complete source-linked data without a new schema.
- No script is at or above 700 lines; affected imports/registrations execute.
- Isolated `/tmp/` build/test passes for repository-supported runtimes/platforms; UI flows pass Playwright and agent-browser; package contents exclude junk/secrets.
- Manual docs/assets/diagram review matches final paths/flows; bounded `npx aislop` reports zero findings/errors/warnings.

## Assumptions & contingencies

- Existing canonical knowledge/persistence used by current Chunin similarity behavior is authoritative; if multiple candidates exist, use the one already consumed and do not add a schema.
- If migration would break MCP contracts or lacks measurable benefit, harden the current language and record the evidence instead of forcing TypeScript/Go.
- A vulnerable dependency with no fixed release blocks release; never suppress or claim success.
- An uninspectable asset is a verification blocker, not a claimed synchronization.
- If no supported UI surface exists, validate API/CLI and record UI as not applicable rather than inventing one.
- Until plan approval, all repository discovery/research remains read-only.