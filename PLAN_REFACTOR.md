# PLAN_REFACTOR.md — server.js Module Split (Node.js Runtime)

## 0. Relationship to other plans

- **Depends on `PLAN_RUNTIME_MIGRATE.md`.** This plan only makes sense once `src/server.js` exists as pure Node.js (Phase 3 of the migrate plan). Do not start this plan until the migrate plan's Phase 11 done criteria are met and `src/server.py` is deleted.
- **Does not touch `PLAN_WEB_UI.md` scope.** No MCP tool name, schema, or client-facing behavior changes. This is a pure internal file-organization refactor of a single file that has grown to ~2,000+ lines and mixes eight unrelated responsibilities.
- **Out of scope:** any new feature, any behavior change, any tool rename, any change to `~/.konoha/skills.db` schema, any frontend work.

**Guiding rule, same as the migrate plan: 1:1 move, not rewrite.** Every function keeps its exact name, signature, and logic. This plan only changes *which file* a function lives in and *how state is shared* between files.

---

## 1. Problem statement

`src/server.js` currently mixes:

1. Path/workspace resolution & IDE-install detection
2. Skill CRUD (`find_skill`, `list_skills`, `get_skill`, `optimize_report`)
3. Build spec generation (framework matrix, archetype inference, `build_from_text`/`build_from_source`) — ~600 lines alone
4. Active agent/session/client detection (transcript parsing)
5. Workflow state machine (`run_sannin`, `run_mcp_workflow` and its 7 phases)
6. Web search (SearXNG / DuckDuckGo / Wikipedia fallback chain)
7. Persona memory & agent reporting (`report_from_agent`, `run_mcp_agent`)
8. JSON-RPC protocol handling + stdio transport loop

None of these eight areas need to know about each other's internals. Splitting them is a pure readability/testability win with no user-visible effect — **provided the shared state problem below is solved correctly**, or the split introduces a real bug that doesn't exist today.

---

## 2. The shared-mutable-state hazard — and how this plan makes it structurally impossible

### 2.1 What the hazard is

Today, `WORKSPACE_ROOT` and `ACTIVE_CLIENT` are `let` bindings at module scope in `server.js`. They start `null`/`env`-derived, then get **mutated in place** inside `handleRequest()` when the `initialize` JSON-RPC method fires — and every other function in the file (skill lookup, build spec, workflow, path visibility checks) reads the *current* value of that same `let` at call time.

If this file is split naively, the failure mode is specific and well-known in Node/CommonJS:

```js
// runtime_state.js
let WORKSPACE_ROOT = null;
function setWorkspaceRoot(v) { WORKSPACE_ROOT = v; }
module.exports = { WORKSPACE_ROOT, setWorkspaceRoot }; // ← BUG
```

```js
// skills.js
const { WORKSPACE_ROOT } = require('./runtime_state'); // ← snapshot taken ONCE at require time
```

`WORKSPACE_ROOT` is a primitive (string/null). Destructuring it copies the *value at that instant* — usually `null`, at process startup, before `initialize` ever runs. `skills.js` then carries a stale `null` forever, even after `setWorkspaceRoot()` runs elsewhere. This is a real, common CommonJS bug class, not a theoretical one — and it's exactly the shape of bug that's easy to introduce silently during a "just move the code" refactor because the code *looks* identical, just relocated.

### 2.2 The rule that makes it impossible, not just unlikely

**No module may ever export a mutable primitive by value. State is only ever read through a function call, never through a destructured binding.**

Concretely:

- `runtime_state.js` owns `WORKSPACE_ROOT` and `ACTIVE_CLIENT` as **private, unexported** variables (module closure, not `module.exports.WORKSPACE_ROOT = ...`).
- The only way in or out is `getWorkspaceRoot()`, `setWorkspaceRoot(v)`, `getActiveClient()`, `setActiveClient(v)`.
- **Every call site must call `getWorkspaceRoot()` fresh, every time it needs the value** — never `const ws = getWorkspaceRoot()` cached at module load or stored in an outer closure that outlives a single function call. Caching inside a single function body (one read, used within that same function execution) is fine; caching across calls is not.
- Objects (not primitives) that need mutation-in-place — e.g. a `Map`, or a plain object — are the one exception where destructuring a reference is safe, *because* the reference itself doesn't change even when its contents do. Where possible, this plan prefers primitives-behind-getters anyway, for consistency and to avoid relying on engineers correctly reasoning about reference-vs-value each time.

### 2.3 Enforcement, not just convention

A written rule that isn't checked will erode. Three concrete backstops, all done criteria for Phase 1:

1. **ESLint rule.** Add a custom `no-restricted-syntax` rule (or `eslint-plugin-import`'s `no-mutable-exports`, which already covers most of this) that fails the build on `module.exports.WORKSPACE_ROOT = ...` or any bare `let`/`var` in `module.exports` object literals in `src/mcp/*.js`. CI must fail red if this fires.
2. **Grep gate in CI.** A one-line `grep -rn "require('./runtime_state')" src/mcp | grep -E '\{\s*WORKSPACE_ROOT|ACTIVE_CLIENT'` must return zero matches — i.e., nobody is allowed to destructure those two names out of `runtime_state` at all. Only `getWorkspaceRoot`/`setWorkspaceRoot`/`getActiveClient`/`setActiveClient` may be imported.
3. **A regression test that would have caught the Section 2.1 bug.** `tests/test_runtime_state.js`: import `runtime_state` and a second module (e.g. `skills.js`) that depends on it *before* calling `setWorkspaceRoot()`, then call the setter, then assert the second module's next call sees the new value. This test exists specifically to fail if anyone reintroduces value-destructuring later — it is the automated version of "prove the hazard is dead," not just a smoke test.

**Done criterion for this section:** all three of the above are committed and passing before Phase 1 (see §4) is considered complete. No skill/build/workflow module may be split out until `runtime_state.js` + its lint rule + its regression test exist and pass.

---

## 3. Target module structure

```
src/mcp/
  runtime_state.js       Private WORKSPACE_ROOT / ACTIVE_CLIENT closure + get/set functions only.
                          konohaTmp, uriToPath, isIdeInstallationDir, normCase, isPathVisible
                          (these read state via getters, never via destructured value).

  client_detection.js     detectActiveClient, detectActiveAgent, getActiveSessionId,
                           getKonohaTmpRoot, getSessionKey, getAndIncrementSessionTurn,
                           session-turn Maps (SESSION_TURNS, SESSION_TURN_LAST_ACCESS —
                           these are Maps, safe to export as references per §2.2 exception).

  skills.js                findSkill, listSkills, getSkill, optimizeReport, getAgentSkills,
                           fuzzyResolveSkill, levenshtein, contentHash, smartTruncate,
                           autoMigrateProjectSkills, autoDetectSkills.

  build_spec.js            BUILD_FRAMEWORKS, validateBuildInput, resolveBuildSourceDir,
                           normalizeFrameworkName, buildFromSource, buildFromText,
                           inferBuildArchetype, frameworkSourceSignals, analyzeImageMetadata,
                           loadSkillContentForBuild.

  workflow.js              runSannin, routeByKeywordsWithPrompt, runMcpWorkflow + all
                           workflow* helpers, isPentestTask, isCleanValidation,
                           workflowParseTasks, workflowReviewApproved, VALIDATION_EVIDENCE_PATTERN,
                           cleanupTransientScratchFiles.

  web_search.js             runWebSearch, fetchWithTimeout, querySearxng, queryDuckDuckGo,
                           queryWikipedia, getCandidateInstances, resolveBestInstance.

  memory_reporting.js       reportFromAgent, assessValidationEvidence, getProjectContext,
                           saveProjectContext, queryProjectMemory, runMcpAgent,
                           autoloadSkillsFromPrompt, applyFileEdits, buildSubagentMcpBlock,
                           truncateAtBoundary.

  tool_dispatch.js          _executeToolInternal, executeTool, executeToolSync.
                           Requires all modules above; contains ONLY the toolName routing
                           switch — no business logic of its own.

  protocol.js               handleRequest, main(), stdio readline loop, getServerVersion,
                           MCP_MANIFEST loading, SUPPORTED_PROTOCOL_VERSIONS.
                           Owns the `initialize` handler that calls setWorkspaceRoot()/
                           setActiveClient() — this is the ONLY place those setters
                           are called in normal operation.

src/server.js               Thin barrel: require() every module above, re-export every
                           name currently exported today (both camelCase and the
                           snake_case aliases like find_skill, build_from_text, etc.)
                           so require('./server') call sites elsewhere in the codebase
                           need zero changes.
```

Nothing under `bin/cli.js`'s user-facing surface, no MCP tool name/schema, no client config shape changes. Same non-goals as `PLAN_RUNTIME_MIGRATE.md` §3.

---

## 4. Phases

Execute strictly in order. Each phase has explicit done criteria — do not start the next phase until the current one's are met.

### Phase 1 — `runtime_state.js` + enforcement (the hazard-elimination phase)
- Create `runtime_state.js` with private closure variables, `get`/`set` functions only, plus the path-utility functions that depend on them (`isPathVisible`, `konohaTmp`, `uriToPath`, `isIdeInstallationDir`, `normCase`).
- Add the ESLint rule, the CI grep gate, and `tests/test_runtime_state.js` from §2.3.
- **Done criteria:** lint rule fails on a deliberately-introduced destructuring bug (write the bad code, confirm CI goes red, then revert); `test_runtime_state.js` passes; `test_runtime_state.js` is confirmed to fail if the getter/setter indirection is temporarily removed (prove the test actually tests something).

### Phase 2 — Leaf modules with no cross-dependencies
- Extract `client_detection.js` and `skills.js`. These depend on `runtime_state.js` but not on each other or on build/workflow.
- **Done criteria:** run both old (`server.js` monolith, tagged pre-split) and new module versions against the same live MCP session; `find_skill`, `list_skills`, `get_skill`, `optimize_report`, and client-detection outputs byte-identical for the same inputs.

### Phase 3 — `build_spec.js`
- Extract build-spec generation. Depends on `skills.js` (for `loadSkillContentForBuild`) and `runtime_state.js` (for `resolveBuildSourceDir`'s workspace check).
- **Done criteria:** `build_from_text` and `build_from_source` produce byte-identical JSON spec output (including `directives`, `required_skills`, `embedded_skill_content`) for a fixed set of test inputs across all four frameworks.

### Phase 4 — `workflow.js`
- Extract the 7-phase state machine. Depends on `skills.js`, `runtime_state.js` (for `getResolvedTaskDir`).
- **Done criteria:** replay a recorded multi-turn `status.json` transcript (route → explore → plan → execute → document → review → synthesize) through old and new code; identical `status.json` and identical returned JSON at every phase transition.

### Phase 5 — `web_search.js`
- Extract search. Fully independent — only depends on `runtime_state.js` for the `~/.konoha/searxng` cache path.
- **Done criteria:** same query against same mocked HTTP responses (SearXNG / DuckDuckGo / Wikipedia fixtures) produces identical ranked result JSON.

### Phase 6 — `memory_reporting.js`
- Extract `runMcpAgent`, `reportFromAgent`, and project-context functions. Depends on `skills.js`, `workflow.js` (writes into `status.json`), `client_detection.js` (session key).
- **Done criteria:** `report_from_agent` validation-evidence gating (verified/unverified logic) and `run_mcp_agent` prompt assembly (including auto-compact-at-turn-2 behavior) produce identical output for identical session-turn sequences.

### Phase 7 — `tool_dispatch.js` and `protocol.js`
- Extract the routing switch and the JSON-RPC/stdio layer last, since these `require()` everything above.
- Confirm `protocol.js`'s `initialize` handler is the *only* call site of `setWorkspaceRoot`/`setActiveClient` outside of tests.
- **Done criteria:** full stdio session replay (initialize → tools/list → a representative sequence of tools/call for each tool category) produces identical JSON-RPC responses, byte for byte, old vs. new.

### Phase 8 — Barrel file & cutover
- `src/server.js` becomes the thin re-export barrel described in §3.
- Delete the monolithic implementation (keep it in git history, not as a dead file).
- Run the full existing test suite plus every done-criteria fixture from Phases 1–7 in one pass.
- **Done criteria:** zero diffs across all fixtures; `require('./server')` from every existing call site in the repo (`bin/cli.js`, tests, anywhere else) works unmodified.

---

## 5. Non-goals (explicit)

- No TypeScript conversion here — that's `PLAN_RUNTIME_MIGRATE.md` §11, a separate later phase.
- No change to the build-spec directive text, taste-skill dials, or any tool's returned JSON shape.
- No change to `~/.konoha/skills.db` schema or file layout.
- No frontend work of any kind — see `PLAN_WEB_UI.md`.