# Skill Authorization & Lab DB Isolation — Security Compliance Record

Date: 2026-11-09
Component versions: Konoha 2.2.19
Scope: red-skill authorization across all invocation surfaces; physical segregation of the Akatsuki Lab database from the main Konoha store.

## 1. Control objective

Two properties must hold without relying on operator discipline:

1. A red skill's content and execution are reachable only by `@akatsuki`, and only inside the isolated Akatsuki Lab.
2. No provisioning, execution, or teardown path can write the Akatsuki Lab data into the main Konoha database.

Both were previously enforced by scattered checks (`isOffensiveSkill`, workflow-specific gates) and by a `mode` flag on a shared connection. Neither survives a new call site or a path override.

## 2. Single registry

`src/skill_authorization.js` is the only red-skill registry.

| Export | Role |
|--------|------|
| `RED_SKILLS` | Exact-name set (`akatsuki-skill`) |
| `RED_SKILL_PREFIXES` / `RED_SKILL_PATTERN` | Boundary-aware prefix match (`pentest`, `patch-diff-exploit`) |
| `RED_SKILL_TAGS` | `red-team`, `pentest`, `offensive` |
| `classifySkill(name, tags)` | `{ red, mode, requires_lab, reason }` |
| `authorizeSkillAccess({ skillName, tags, agentName })` | Authorization decision |
| `authorizationDeniedResult` | Stable denial payload |
| `getMainDbPath` / `getLabDbDir` / `isLabDbPath` / `assertLabDbPath` | Path boundary |

`src/mcp/skills_common.js#isOffensiveSkill` now delegates to `classifySkill`, so there is no second classification path to drift.

## 3. Authorization surfaces

| Surface | File | Failure mode |
|---------|------|--------------|
| `find_skill` / `list_skills` | `src/mcp/skills_search.js` | Redacted metadata row; content `[REDACTED]` |
| `get_skill` / `_loadSingleSkill` | `src/mcp/skills_retrieval.js` | Denial payload before path resolution |
| MCP dispatch (`use_skill`, `use_skills`) | `src/mcp/tool_dispatch.js` | Denial payload; explicit `args.agent` is authoritative |
| Delegation (`buildSpawnDirective`, parallel) | `src/mcp/lazy_subagent.js` | Denial payload instead of spawn instruction |
| Sannin route | `src/mcp/workflow_sannin.js` | Route blocked, `phase: 'skill_authorization'` |
| Sannin envelope | `src/mcp/sannin_router.js` | Blocked skills withheld from the envelope |
| Red workflow runtime | `src/workflow/akatsuki/workflows.js` | Blocked with `SKILL_AUTHORIZATION_DENIED` after `validateAuthorization` passes |

Identity rule: the caller-supplied `agent`/`agent_name` argument is canonical. Active-agent detection is used only when no identity is supplied. An absent identity is denied for red skills, never resolved to a default agent.

## 4. Lab execution requirement

`runRedTeamWorkflow` gates in order: mode → written authorization → `@akatsuki` identity → lab prerequisites → tool plan.

- Missing container engine returns `Declined: LXC/Docker not installed on this machine.` with `declined: true`, `host_execution_denied: true`, and no host tool invocation. Verified by monkeypatched runner asserting zero non-`which`/`where` spawns.
- Unsupported platform yields no required engine and fails closed.
- No Docker fallback on Linux.
- Lab child processes receive `KONOHA_DB_PATH` pinned to the lab file.

## 5. Database segregation

| Property | Implementation |
|----------|----------------|
| Schema diagram | `docs/DATABASE-ERD.md` |
| Separate file | `~/.konoha/akatsuki-lab/lab.db` (`KONOHA_LAB_DB_ROOT`, `KONOHA_AKATSUKI_LAB_DB`) |
| Separate opener | `openLabDb` → `openRawConnection` (no schema/migration/vector) |
| Main connector refuses lab paths | `getConnection` → `LAB_DB_ISOLATION_VIOLATION` |
| Lab opener refuses non-lab paths | `assertLabDbPath` |
| Separate schema | `lab_runs`, `lab_tool_invocations`, `kali_tools`, `red_skill_audit` only |
| Kali catalog relocated | `kali_tools` removed from `src/db_schema.js`; seeded into the lab DB from bundled JSON |
| Teardown | `purgeLabDb` deletes `lab.db`, `-wal`, `-shm` after confirmed teardown |
| Backup | none for lab; main backup path unchanged |
| Red-skill audit | `red_skill_audit` rows written by `recordRedSkillAudit`. A caller-supplied connection (`options.labConn`) is used as-is; otherwise `auditRedSkill` opens the lab store in existing-file-only mode (`openLabAuditConnection`, no schema setup, no seeding) and closes it. With no provisioned lab there is no row and no file created. The main schema has no such table, and auditing never changes the decision |

No configuration flag grants access across the boundary; the guards are path-based and symmetric.

## 6. Verification

`tests/test_akatsuki_skill_authz_db_isolation.js` — 46 test cases:

- **A** classification: exact name, prefix boundary (`pentest-tools` red, `pentestfoo` not), tags, case/`@` normalization.
- **B** authorization matrix: `@akatsuki` allowed, blue agents and anonymous callers denied, denial payload shape.
- **C** retrieval, search redaction, dispatch, delegation, and route blocking, each asserting no body leakage.
- **D** red workflow identity gate (absent identity denies, evaluated before mode/scope so denials disclose nothing), MCP caller identity resolution from the resolved dispatch identity rather than the tool name, missing-engine decline with zero host tool spawns.
- **E** lab/main DB separation, schema contents, path guard traversal refusal, `KONOHA_DB_PATH` non-inheritance, purge of file and sidecars.
- **F** red-skill audit lives only in the lab DB; the writer refuses to run without an open lab connection; a denial appends a row to a supplied connection and appends nothing when none is supplied; an allowed run audits the identity the gate resolved; `auditRedSkill` reports whether it wrote and never creates the store; lab templates contain no main-store references.
- **G** cross-platform path classification (Windows drive paths, canonical, traversal), existing-file-only open refusing to create under encodings (`?`, `#`, spaces), and unsupported-platform fail-closed.

Regression suites re-run green: `test_akatsuki_lab_isolation`, `test_akatsuki_security_centralization`, `test_akatsuki_init`, `test_akatsuki_mode_and_templates`, `test_akatsuki_skill_references`, `test_akatsuki_tool_registry`.

## 7. Residual risk

- A red skill whose only red signal is a tag must be retrieved through a path that supplies tags. `get_skill` passes `null` tags, so tag-only red skills rely on name/prefix classification or explicit `RED_SKILLS` membership. Current red skills are covered by name or prefix. Any tag-only addition must also be added to `RED_SKILLS`.
- Lab DB contents are retained when teardown cannot be confirmed. This is intentional (post-mortem) and stays inside the lab root.
- Path guards operate on resolved paths. A symlink from inside the lab root to the main DB is rejected by `getConnection` only if the resolved target is the main path; operators must not create such links.
- **Claimed identity is not authenticated identity (accepted).** `_resolveAgentIdentity(args)` (`src/mcp/tool_dispatch.js`) resolves the caller from `args.agent` / `args.agent_name`, falling back to `detectActiveAgent()`. A local MCP client that writes `agent: 'akatsuki'` is indistinguishable from `@akatsuki`; there is no signed token or transport session. This is a property of the whole MCP dispatch layer and applies equally to every other tool (the @genin read-only block, skills gates, delegation, memory), not to Akatsuki alone. Status: accepted transport risk. It is not the last line of defence: a spoofing caller still needs red-team mode enabled and a passing `validateLabPrerequisites`. Mitigation, if required, is global identity signing in the MCP client and server — a separate task, deliberately not solved for one tool.
- Identity is evaluated first in `_verifyRedTeamPrerequisites`, before mode and scope, so a denied caller cannot distinguish a disabled deployment from an enabled one.

## 8. Sign-off

| Item | Status |
|------|--------|
| Single red-skill registry | PASS |
| All invocation surfaces gated | PASS |
| Fail-closed on unknown identity | PASS |
| Identity checked before mode/scope | PASS |
| Claimed identity authenticated | ACCEPTED RISK (transport-wide) |
| Lab-only red execution, no host fallback | PASS |
| Main/lab DB physically separate | PASS |
| Path guards bidirectional | PASS |
| Kali catalog off the main schema | PASS |
| Purge on confirmed teardown | PASS |
| Red-skill audit on both decision paths | PASS (supplied connection or existing-file-only open; never creates the store) |
| Cross-platform isolation (Linux LXC, Windows/macOS Docker, other → fail closed) | PASS (engine selection per platform; path guards tested against Windows paths on every host) |
| Adversarial tests | PASS (46 test cases) |
| Existing Akatsuki suites | PASS (7/7 sequential) |
