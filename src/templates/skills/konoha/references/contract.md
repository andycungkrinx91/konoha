# Konoha Contract — Canonical Repository Rules (26)

Approved by the user 2026-11-10. This file is the source of truth for
`konoha.get_skill('konoha/contract')`. It lives at
`src/templates/skills/konoha/references/contract.md` and is indexed into SQLite
by `konoha migrate` (FTS5 + RAG retrieval). The file is the source of truth;
the index is the cache. If `get_skill` returns anything different, re-run
`konoha migrate` and report it.

Assembled from three verified sources: the 11 rules in the user's 17-section
template (Section 14, "in particular"), the 7 rules in the `AGENTS.md`
runtime contract block, and the 20 Cardinal Maintenance Invariants in
`src/templates/skills/konoha/SKILL.md` — with 6 documented merges (aislop
gate, 700-line limit, Konoha mandatory, code intelligence mandatory, RTK mandatory,
Zero-AI-Slop & Kage Gate). The count is 26 because that is how many distinct
verifiable rules exist. No rule here is invented.

## Rules

1. Default password remains `konohagakure`.
2. `PLAN.md` must follow the original audit-first creation requirement and must not be committed.
3. `.omp/plans` must not be committed.
4. Official Konoha skills must match the actual codebase.
5. Manual documentation, diagrams, and asset review is mandatory.
6. Cross-platform compatibility across all 3 local CI test environments must be verified: (1) Linux (`pnpm test:sandbox [-- --shard=I/8]` Debian + `pnpm ci:act` / `pnpm ci:act:shard` Ubuntu `act`), (2) Windows (`docker/windows-vm/oem/run-ci.cmd [-Shard I/N]` / `retest.cmd` via `dockur/windows`), and (3) macOS (`KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox [-- --shard=I/8]` + `macos-latest` CI).
7. Aislop gate: shipped code must pass `rtk npx aislop scan --changes` with score 100/100 Healthy, 0 errors, 0 warnings.
8. Maximum 700 lines per file/script (`.js`, `.py`, `.svelte`; enforced by `scripts/lint.js`).
9. Local Socket CLI checks are mandatory after dependency changes.
10. SecurityCompliance must match actual implementation.
11. Local commit author: `andycungkrinx91 <andy.silva270114@gmail.com>`.
12. Konoha is mandatory: use bounded file tools and Konoha skill lookup (`find_skill`, `get_skill`); no raw `cat`/`grep`.
13. `code_search` is mandatory for repository code search (`code_search`, `code_symbol`, with absolute repo root).
14. RTK is mandatory for shell commands: always prefix with `rtk <command>`.
15. Resume safety: restore the Konoha / `code_search` / RTK workflow on session resume.
16. HITL Gates: Gate 1 (`pending_plan_approval`) and Gate 2 (`pending_human_signoff`) render the picker on EVERY client and submit the human's reply verbatim via `sannin({ task_dir, choice, refinement })`. The gate payload's `picker` block names the control: `transport: native_tool` → call `picker.tool` with `picker.call` (OMP `ask`, [CC] `AskUserQuestion`); `transport: web_picker` → surface `picker.url`, an HTML form that posts the verdict itself over a per-gate signed link. Printing a numbered list for the human to retype is the text fallback, never the picker. Fail closed, never bypass.
17. @advisor review: delivery needs @advisor approval.
18. Zero-AI-Slop & Kage Gate: 100/100 score and ≥98% confidence gate before delivery, with `ai_slop_clean: true` and zero security findings.
19. Global-only, append-only client configs: never write `.omp`, `.codex`, `.cursor`, `.claude`, `.agents`, or `.gitignore` rules (such as `/PLAN.md`) into user project directories; all client configs live under the user home with automatic date-stamped backups and syntax-aware append-only merging. Konoha never deletes external `agents/` or `conversations/` directories.
20. Ownership-aware skill sync: all 17 canonical skills (plus their references and `SOUL.md`) are synchronized from `src/templates/skills` across the ten global skill directories of the eight supported clients; fresh installs skip pre-existing user files, upgrades apply targeted line diff-and-patch while preserving user customizations, and a file recorded as `created_by_konoha` with no user keys is replaced wholesale.
21. Scoped execution: hooks and tool blockers activate only inside Konoha-managed contexts (`/konoha <prompt>` or `/<subagent-name> <prompt>`). External skills are indexed in-place into the SQLite Project Knowledge RAG with strict project isolation.
22. Extension isolation: the obsolete `andycungkrinx91.konoha-bridge-master-universal` extension directory is eliminated; all IDEs use direct MCP configuration.
23. Draw.io zero-collision rule: never introduce overlapping cells or bounding-box collisions in Draw.io diagram pages (`tests/test_diagram_sync.js`).
24. Single-source version synchronization: keep all 18 managed repository targets strictly synchronized via `scripts/bump_version.js`.
25. Release governance: on branch `master`, all discovered tests pass before release commits. The gate is `pnpm test:sandbox` (install, lint, full suite, and fresh-install smoke inside `konoha-sandbox:local`), so a green run does not depend on the developer's host `HOME`. It runs on Docker by default and on Apple's `container` via `KONOHA_SANDBOX_RUNTIME=container`; an engine that is missing or stopped exits non-zero instead of falling back.
26. Token savings telemetry preservation: never modify or disrupt the token savings telemetry flow logic (`src/tools_savings_logger.js`); baseline bytes are dynamically computed from the actual `SUM(byte_size)` of retrieved skill candidates in SQLite FTS5.

## Message Format

Every human and agent message uses `konoha/task-format`: `**Feedback` / `**Task` /
`**Rules` inbound, `**Result` / `**Evidence` / `**Blockers` / `**Next` outbound.

## Note

A numbered rendering of the live runtime contract (e.g. N rules from
`buildAgentContract()` / `getClientContract()`, count derived at render time)
is a different artifact from this 26-rule canonical list. Never substitute its
count for the 26.
