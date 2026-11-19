# Security Compliance Report — Socket Alert Remediation & Subagent Spawn Correctness (v2.2.23)

**Product:** Konoha (`konoha-mcp`) — Multi-Agent MCP Orchestrator & Token-Saving Skills-DB Engine  
**Version:** 2.2.23  
**Report Date:** 2026-11-17  
**Scope:** Root-cause remediation of every Socket.dev alert raised against `konoha-mcp@2.2.22`; removal of all dynamic-execution sinks from the published artifact; dependency pinning and postinstall denial; correction of the eleven defects that prevented subagent spawning from working; cross-platform launch of `.cmd` harness shims.  
**Prepared by:** Kage (Village Leader, Security & Architecture Reviewer) & Akatsuki (Red-Team & Blue-Team Security Specialist)

> **Verification status.** Every claim below is tied to a command or test that was run on
> this host. Three acceptance criteria could **not** be executed here and are marked
> unverified rather than certified: the Socket.dev score itself (§9), the Windows and
> macOS CI legs (§10), and the Kage review gate (§11). Nothing unavailable is claimed as
> passed.

---

## 1. Executive Summary

| Metric | Result | Evidence |
|---|---|---|
| Socket alerts root-caused | ✅ 12 / 12 | §3 alert ledger |
| `lodash` removed from the tarball | ✅ REMOVED | `patches/xlsx-populate@1.21.0.patch`, `tests/test_dependency_posture.js` |
| Dynamic execution in shipped code | ✅ 0 sinks | `tests/test_no_dynamic_execution.js` |
| Browser bundles in bundled deps | ✅ DELETED | `patches/{jszip,pptxgenjs,xlsx-populate}` |
| Release install determinism | ✅ FROZEN | `.github/workflows/publish.yml:54` |
| Exact pins for bundled deps | ✅ 6 / 6 | `tests/test_dependency_posture.js` |
| `NOTICE` attribution | ✅ 19 / 19 | `tests/test_package_tarball_files.js` |
| Spreadsheet formula injection | ✅ REMEDIATED | `tests/test_document_engine_security.js` |
| Presentation image boundary | ✅ REMEDIATED | `tests/test_document_engine_security.js` |
| Subagent spawn defects | ✅ 11 / 11 FIXED | `tests/test_spawn_harness_contracts.js` (16 checks), `tests/test_deploy_safety.js`, `tests/test_omp_manager.js` |
| Windows `.cmd` harness launch | ✅ ROUTED VIA COMSPEC | `tests/test_spawn_harness_contracts.js` check 13 |
| Project config isolation from sandboxed runs | ✅ GUARDED | `tests/test_omp_manager.js` |
| Source lint | ✅ 0 errors / 0 warnings | `node scripts/lint.js` — 892 files |
| Version consistency | ✅ 18 / 18 files at `v2.2.23` | `node scripts/bump_version.js --check` |
| Full automated suite (Linux) | ✅ GREEN | `node tests/run_all.js` — see §8 |
| Socket.dev score | ⚠️ UNVERIFIED | No API access from this host |
| Windows / macOS CI legs | ⚠️ UNVERIFIED | Not runnable from this Linux host |
| Kage review gate | ⚠️ UNAVAILABLE | `konoha.*` / `sannin` MCP tools not mounted this session |

---

## 2. Threat Model

The alerts against `2.2.22` were not one problem. They fell into three classes, and each
required a different kind of fix:

| Class | Example | Correct remedy |
|---|---|---|
| Capability a scanner flags but the product needs | `envVars`, `networkAccess` | Document it, keep the suppression, narrow its scope |
| Capability reached only through a dependency | `lodash`'s `template()` → `Function` | Remove the dependency, or remove the path into it |
| Capability shipped but never loadable | `pptxgen.bundle.js`, `dist/jszip.js` | Delete the file from the artifact |

The distinction matters because the cheap response to every one of these is to widen a
suppression. Two suppressions that hid real defects were therefore removed instead:
`usesEval` is no longer suppressed, and `pnpm-lock.yaml` / `patches/**` are no longer
ignored, so a future dependency or patch change is audited rather than grandfathered.

---

## 3. Alert Ledger — Root Cause per Alert

| Alert | Root cause | Fix | Classification |
|---|---|---|---|
| `usesEval` | `new Function()` in three generated hook payloads; `Function` inside `lodash.template`, the `jszip` Browserify `setImmediate` polyfill, and the `pptxgenjs` webpack bundle | Hook payloads emit a function expression; `lodash` removed; three browser bundles deleted | **Fixed** |
| `usesEval` (transitive) | `xlsx-populate` → `lodash@4.18.1` | `patches/xlsx-populate@1.21.0.patch` swaps 19 `require("lodash")` sites for a 27-helper shim | **Fixed** |
| `dynamicCodeExecution` | Same three hook payloads | Same rewrite; `tests/test_no_dynamic_execution.js` also executes the generated hooks to prove deny/block/allow survived | **Fixed** |
| `installScripts` | `onnxruntime-node` postinstall downloads CUDA EP binaries from NuGet with no checksum | `pnpm-workspace.yaml#allowBuilds: onnxruntime-node: false`; the JS binding ships prebuilt, so inference is unaffected | **Mitigated** (build denied, not removed) |
| `unmaintained` / `newAuthor` | Package rotation, not a defect | Provenance enforced in CI; suppression retained | **False Positive** |
| `networkAccess` | MCP servers reach configured providers and local Ollama/ONNX by contract | Suppression retained, scoped to `issueRules` | **False Positive** |
| `envVars` | Provider API keys are read from the environment by contract | Suppression retained, scoped to `issueRules` | **False Positive** |
| `urlStrings` | Endpoint literals are user-facing configuration | Suppression retained, scoped to `issueRules` | **False Positive** |
| `gptSecurity` / `gptAnomaly` | LLM prompt-injection heuristics on a local agent tool | Suppression retained, scoped to `issueRules` | **False Positive** |
| `licenseChange` / attribution | `NOTICE` named 3 of the 19 packages the tarball redistributes | `NOTICE` rewritten with every package, its license, and its copyright; `jszip` recorded as redistributed under MIT rather than GPL-3.0-or-later | **Fixed** |
| Supply-chain quality | `--no-frozen-lockfile` on publish; floating versions for patched/bundled deps | `--frozen-lockfile`; `docx`, `hash-wasm`, `playwright`, `pptxgenjs`, `xlsx-populate` pinned exactly | **Fixed** |
| Formula injection (not a Socket alert, found during review) | `sanitizeFormula()` missed `=DDE(...)`, `REGISTER(`, and the `=cmd|' /C calc'!A0` link form | Blocklist extended; any unquoted `|` treated as a DDE link | **Fixed** |

No alert was closed by editing a suppression to hide it. `socket.yml` shrinks in this
release, not grows.

---

## 4. Dynamic Execution — Removed at the Source

The three generated hook payloads (`src/mcp_clients/command_code.js`,
`src/mcp_clients/claude_code_hooks.js`, `src/pi_blocker_template.js`) each wrapped their
guardrail checker in `new Function(source)()`. They now emit the checker as a function
expression with its source embedded verbatim, which also removed the `JSON.stringify`
that forced the wrapper in the first place. Behaviour is unchanged: the generated hooks
still refuse native reads and `rm -rf /`, and unmanaged sessions still pass through.

`tests/test_no_dynamic_execution.js` scans every runtime file for `eval(`,
`new Function(`, `Function('…')`, `require('vm')`, and `runIn(New)Context(`, asserts the
payloads contain no constructor call, and then **runs** the generated hooks to prove the
deny/block/allow/unmanaged matrix survived the rewrite. A grep alone would not have
caught a behavioural regression here.

A packed-artifact scan of `konoha-mcp-2.2.23.tgz` finds 2,059 entries with 205 bundled
`.js` files and zero `new Function(` / `eval(` occurrences.

---

## 5. Dependency Posture

**`lodash` is gone.** It entered only through `xlsx-populate@1.21.0`, and 1,051 of the
3,128 files in the `2.2.22` tarball were `node_modules/lodash`. Konoha never called it.
The patch swaps all 19 `require("lodash")` sites for `lib/lodash-lite.js`, a 27-helper
shim with lodash-4-faithful semantics (object-shorthand iteratees, `sortBy` identity
default plus iteratee-list flattening, `remove` mutation, `includes` SameValueZero,
cycle-safe `cloneDeep`). A 146-case parity harness against real `lodash@4.18.1` matched
on every case before the shim was accepted, and `tests/test_xlsx_populate_lodash_lite.js`
keeps it honest, including sparse-array iteration.

**Browser bundles deleted.** Three bundled packages shipped build outputs that Konoha
never loads, each carrying a `setImmediate` polyfill built on the `Function` constructor:
`xlsx-populate/browser/` (13.9 MiB, 52 `Function(` occurrences),
`jszip/dist/` (Browserify), and `pptxgenjs/dist/pptxgen.bundle.js` (450 KiB plus a 462 KiB
source map). All three are deleted by pnpm patches, and the `browser` manifest fields are
removed so nothing can resolve them.

**Postinstall denied.** `onnxruntime-node`'s postinstall fetches CUDA EP binaries from
NuGet without checksum verification. `allowBuilds` denies it; the JS binding ships
prebuilt, so ONNX inference is unaffected.

**Attribution complete.** `bundleDependencies` pulls the whole transitive closure of
`cfb`, `pptxgenjs`, and `xlsx-populate`, so the tarball redistributes 19 packages under
Apache-2.0, MIT, ISC, and BlueOak-1.0.0. `NOTICE` now names each with its license and
copyright, records `jszip`'s MIT option, and states that each ships its own unmodified
license file.

---

## 6. Document Engine Boundaries

Two engine boundaries were tightened while auditing the bundle changes.

**Spreadsheet formula injection.** `sanitizeFormula()` blocked `WEBSERVICE`, `ENCODEURL`,
`HYPERLINK`, `CALL`, `REGISTER.ID`, `DDEREFERENCE`, and `SQL.REQUEST`, but
`=DDE("cmd";"/c calc";"…")` passed through, `REGISTER(` slipped past a rule written as
`REGISTER.`, and `=cmd|' /C calc'!A0` contains none of those names at all. All three are
now rejected; `Sheet2!A1` references and text containing a quoted pipe still pass.

**Presentation image boundary.** `pptxgenjs` resolves `{ path }` with `fs.readFileSync`
and `{ path: 'http…' }` with an HTTPS GET. Konoha only ever passed internally rendered
cover artwork, so exposure was theoretical — but the engine now routes every image
through `addInlineImage()`, which requires an in-memory buffer with PNG magic bytes and
emits a base64 data URI. No path or URL string can reach `addImage`, and the file has
exactly one `addImage` call site.

---

## 7. Subagent Spawn Correctness

This is not a Socket alert, but it is a security-relevant correctness defect: the
fail-closed spawn gate was rejecting legitimate delegations for reasons unrelated to the
caller, and the Windows path could not launch five of the eight harnesses at all.

| Defect | Root cause | Fix |
|---|---|---|
| Every OMP session resolved to `pi` | OMP exports PI's variable names verbatim (`PI_SESSION_FILE`, `PI_SESSION_ID`, `PI_CODING_AGENT_DIR`, `PI_GIT_GUARD`) and defines no `OMP_*` marker, so the PI branch claimed it | Detect by state directory (`~/.omp/` vs `~/.pi/`), checked before the PI branch |
| A reported MCP client name could resolve OMP to Pi | `resolveClientFromInfo()` tested `includes('pi')` before `includes('omp')` | Order flipped; the more specific harness wins |
| `omp` invocation rejected | `omp -p --agent <name>` exits 2 (`unknown flag: --agent`) | Identity travels as `--append-system-prompt` |
| `omp` spawn directive rejected | The emitted `task` item lacked `solutionSpace`, which OMP requires, and carried `cwd`, which OMP silently drops (`"+": "delete"`) | Item carries `solutionSpace`; the worktree rides in the task text |
| `cli`/`universal` + `--execute` could never launch | The gate asked whether the *client* had a native subagent tool; `cli` has none | Gate asks whether the *harness binary* exists; `PATH` probed in a fixed order |
| Advertised CLI fallback spawned nothing | It omitted `--task` and `--execute` | Real launch, POSIX-quoted task text, `--cwd` when a worktree exists |
| Backtick truncated the directive | The call sits in a markdown inline code span, which has no escape | Backticks stripped at the single source |
| Windows `.cmd` shims could not be spawned | Node refuses to spawn a `.cmd`/`.bat` without a shell (EINVAL since CVE-2024-27980) | `.cmd`/`.bat` launched via `ComSpec /d /s /c` with `windowsVerbatimArguments`; `.exe` spawned directly |
| A cancelled Windows spawn orphaned the harness | The held handle is `cmd.exe`, and Windows has no tree-reaching signal | `taskkill /pid <pid> /T`, `/F` only on the escalation pass |
| Deployed agent files froze at the version that first wrote them | `isKonohaOwnedAgentFile()` accepted only the `generated_by: konoha` frontmatter marker, while Konoha 2.2.x agent files identify themselves by the managed contract block in the body. The deploy read its own older output as user-authored and parked every update as `.konoha-proposed`, so `@genin` kept `Write`/`Edit`/`Bash` grants from 2.2.18 | The contract block is recognised as ownership; a superseded `.konoha-proposed` is removed by the overwrite it was waiting for |
| Delegated agents had no Konoha tools at all | A suite run with a temporary `HOME` auto-detected the repository as a project and rewrote its `.omp/mcp.json` to point at the sandbox's launcher, which no longer exists. Every later OMP child in that checkout failed to start the Konoha MCP server (`exited with code 1 before responding`) | A sandboxed home (compared against `os.userInfo()`, not the overridable `HOME`) never writes project config |

**Windows.** npm/pnpm install these CLIs as `.cmd` shims, and Node refuses to spawn a
`.cmd`/`.bat` without a shell (EINVAL since the CVE-2024-27980 fix), so `claude`,
`cursor-agent`, `opencode`, `command-code`, and `pi` were unreachable on Windows. The
binary is now resolved to its absolute `PATH` location (`PATHEXT`-aware, execute-bit
checked on POSIX), and a `.cmd`/`.bat` is launched through `ComSpec /d /s /c` with
`windowsVerbatimArguments`. `cmd.exe` treats a newline as a command separator, so on that
one route the task's newlines collapse to spaces rather than truncating the command; every
other platform passes the task text verbatim.

Because the process held is now `cmd.exe` rather than the harness, cancellation uses
`taskkill /pid <pid> /T` (with `/F` only on the escalation pass) so the harness cannot
outlive its launcher. On POSIX the existing signals already reach the child and are
unchanged.

`tests/test_spawn_harness_contracts.js` covers all of the above in 16 checks. Each guard
was broken deliberately to confirm the suite reports it: the Windows route, the exec-bit
filter, the `taskkill /T` flag, and the `omp`-before-`pi` ordering each produce a failure
when reverted.

---

## 8. Test Evidence

| Suite | Result |
|---|---|
| `node tests/run_all.js` | 322 passed, 0 failed (863.8 s) — see §8.1 |
| `node scripts/lint.js` | 892 files, 0 errors, 0 warnings; 414 blue skill files carry no privileged patterns |
| `node scripts/bump_version.js --check` | 18 / 18 files at `v2.2.23` |
| `node tests/test_spawn_harness_contracts.js` | 16 / 16 |
| `node tests/test_subagent_spawning_p0.js` | 9 / 9 |
| `node tests/test_command_routing_and_spawning.js` | PASS |
| `node tests/test_deploy_safety.js` | PASS — legacy contract-managed agent files upgrade in place; a superseded `.konoha-proposed` is removed |
| `node tests/test_omp_manager.js` | PASS — a temporary-home run leaves the project `.omp/mcp.json` byte-identical |
| `node tests/test_konoha_2_2_18_master.js` | PASS, including a real 8-specialist dispatch on `client=omp` |
| `node tests/test_dependency_posture.js` | PASS |
| `node tests/test_no_dynamic_execution.js` | PASS |
| `node tests/test_xlsx_populate_lodash_lite.js` | PASS |
| `node tests/test_document_engine_security.js` | PASS |
| `node tests/test_manual_book.js` | PASS (16 chapters, PDF rebuilt) |

### 8.1 Full suite

`node tests/run_all.js` reports **322 passed, 0 failed** in 863.8 s on this Linux host, after
every change in this commit. A clean clone produced with
`git archive HEAD | tar -x -C /tmp/clean-clone` also passes the guardrail, skill-parity, and
gitignore suites, confirming the tracked `.agents/` tree travels with the branch.

### 8.2 Live end-to-end spawn

Beyond the contract tests, a real delegation was executed against the repaired tree:

```
spawnSubagent({ agent: 'genin', client: 'omp', task: '…' })
→ ok: true, exit_code: 0, read_only_enforced: true, 20.6 s
```

The child's stderr contains no `MCP server "konoha" failed to connect`, and its stdout carries
`task_context_received: true` plus the merged-back instruction block — the two properties that
were missing when every agent silently degraded to "no spawn, no Konoha tools".

---

## 9. Unverified — Socket.dev Score

Socket.dev's API is not reachable from this host, so the score for `2.2.23` is **not**
self-certified here. The reported `2.2.22` baseline was Supply Chain 83, Vulnerability
100, Quality 100, Maintenance 96, License 90. The local proxy is
`tests/test_dependency_audit.js`, which reports 0 advisories for the root and `apps/web`
workspaces, plus
the packed-artifact scan in §4. Both are necessary but neither is the vendor's score.

> **2026-11-19:** the local proxy is now the mandatory gate, and Socket.dev scanning is opt-in
> (`pnpm audit:socket` with `SOCKET_CLI_API_TOKEN`). Nothing in the mandatory path needs an
> account, so the unreachable API above no longer blocks a release.

---

## 10. Unverified — Cross-Platform CI

`cross-platform.yml` runs the suite on `ubuntu-latest` (8 shards), `macos-latest` (5
shards), and `windows-latest` (16 shards) with `fail-fast: false` and a 90-minute cap.
Shards are partitioned dynamically, so the new suite is picked up on all three operating
systems without a matrix edit.

Those legs cannot be executed from this Linux host. The Windows-specific code paths are
covered by a `process.platform`-pinned probe (check 13) and by unit checks on the kill
invocation (check 16), which is simulation, not a native Windows run. This is recorded as
**unverified**, not as passed.

---

## 11. Unavailable Gates

| Gate | Reason |
|---|---|
| Socket.dev score for `2.2.23` | No API access from this host |
| Windows / macOS CI legs | Not runnable from this Linux host |
| Kage review (`confidence ≥ 98`, `ai_slop_findings = 0`) | `konoha.*` / `sannin` MCP tools not mounted in this session |

None is claimed as passed.

---

## 12. Remediation Ledger

| Phase | Commit | Change |
|---|---|---|
| 1 | `8b1eda88` | `lodash` removed via patch; hook payloads lose `new Function`; browser bundles deleted; exact pins; frozen-lockfile publish; `NOTICE` completed; formula and image boundaries closed; `.agents/` tracked |
| 2 | `c772c291` | Skill mirror and plugin byte guards; `run_all.js` stops leaking harness identity; port-blocklist flake fixed |
| 3 | `c5605700` | Skills API writes and deletes inside the served project |
| 4 | `fix(spawn)` | Subagent spawn correctness: OMP identity, `omp` argv, `omp` `task` schema, harness-binary gating, CLI fallback, backtick truncation, Windows `.cmd` route and process-tree kill. Plus the two defects that survived those fixes: contract-managed agent files frozen at the version that first wrote them (`src/agent_file_safety.js`), and a sandboxed test run rewriting the project's `.omp/mcp.json` so delegated agents started without Konoha (`src/omp_manager.js`) |

All commits are local on `security/fix-socket-alerts`, authored by
`andycungkrinx91 <andy.silva270114@gmail.com>`. No push, merge, or publish occurred.
