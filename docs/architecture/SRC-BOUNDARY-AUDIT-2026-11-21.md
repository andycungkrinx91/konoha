# src/ Dependency Boundary Audit and Modularization Plan

**Issue:** [#25](https://github.com/andycungkrinx91/konoha/issues/25) — audit and proposal only. No file has been moved by this document.
**Measured at:** `2.2.25`, branch `fix/bug-sanin-lisence`.
**Tooling:** `node scripts/audit_src_boundaries.js` (source-derived graph, read-only). Every number below comes from that run, not from an earlier snapshot.

The issue asked for the audit to refresh the current tree rather than reuse the PR #24 counts. It has: the inventory below is the working branch, and it differs from the historical snapshot.

---

## 1. Current inventory

| Measure | Value |
|---|---|
| Files under `src/` | 2,785 |
| Under `src/templates/` (vendored skills, assets) | 753 |
| **Runtime `.js` files outside `src/templates/`** | **350** |
| Runtime files directly under `src/` | **108** |
| Resolved relative `require()` edges | 1,327 |
| Unresolved relative requires | 2 (both pre-existing, see §2.4) |
| Files using a computed/dynamic `require()` | 15 |

The PR #24 snapshot reported 350 files outside `src/templates/` and 103 root-level JavaScript files. The 350 matches; the root count is now **108**, so five modules have joined the root since that snapshot.

Domain sizes (runtime JS):

| Domain | Files |
|---|---|
| `(root)` | 108 |
| `mcp/` | 104 |
| `workflow/` | 54 |
| `bridge/` | 30 |
| `code_intel/` | 22 |
| `web/` | 13 |
| `file_tools/` | 7 |
| `telegram/` | 5 |
| `mcp_clients/` | 5 |
| `queue/` | 2 |

---

## 2. Dependency findings

### 2.1 The root is the de facto shared layer

Every domain reaches into `(root)` far more than into any sibling:

| Edge | Count |
|---|---|
| `mcp -> (root)` | 105 |
| `web -> (root)` | 67 |
| `mcp_clients -> (root)` | 46 |
| `workflow -> (root)` | 30 |
| `bridge -> (root)` | 14 |
| `telegram -> (root)` | 10 |
| `code_intel -> (root)` | 9 |

This is the central finding. `(root)` is not a folder of loose scripts; it is an unnamed shared infrastructure layer that seven domains depend on. Any modularization that starts by moving root files will break all seven at once, which is why the migration plan (§5) starts by *naming* this layer, not by relocating its files.

### 2.2 Two domains are mutually coupled

| Edge | Count |
|---|---|
| `mcp -> workflow` | 45 |
| `workflow -> mcp` | 39 |

`mcp/` and `workflow/` each import the other at comparable volume. This is the only bidirectional pair of any size, and it is the one genuine boundary violation: neither can be extracted, tested in isolation, or reasoned about without the other. The 45/39 split means a simple "workflow owns orchestration" or "mcp owns tools" rule does not describe what the code does.

`web -> mcp` (24) and `web -> telegram` (9) are one-directional and therefore acceptable in the short term.

### 2.3 Dependency hubs

In-degree, i.e. how many modules reach into the file:

| Module | In-degree | Assessment |
|---|---|---|
| `src/config_access.js` | 74 | **Legitimate facade.** Zero top-level requires; loads modules through a computed `require(candidate)` plus lazy `require('./crypto_vault')`. It is a deliberate indirection layer, not accidental coupling. |
| `src/db.js` | 66 | **Real infrastructure hub.** Connection lifecycle and PRAGMA ownership. Central by design. |
| `src/config_backup_manager.js` | 34 | Candidate for review: backup/restore is not a primitive every domain needs. |
| `src/mcp/client_detection.js` | 33 | **Misplaced.** Client detection is not an MCP concern; 33 modules depend on it from outside `mcp/`. |
| `src/platform_utils.js` | 28 | Legitimate shared primitive. |
| `src/agent_manager.js` | 27 | Domain logic sitting in the shared layer. |
| `src/mcp/runtime_state.js` | 27 | **Misplaced.** Runtime paths are infrastructure, not MCP. |
| `src/workflow/kage-reviewer/sdlc_manager.js` | 26 | Cross-cutting: task state used by CLI, web, and MCP alike. |
| `src/canonical_agents.js`, `src/agent_file_safety.js`, `src/persona_memory.js` | 25 each | Agent and memory domains, currently unowned at root. |

Three of these (`client_detection`, `runtime_state`, `sdlc_manager`) are the clearest misplacements: each is a cross-cutting concern filed under a domain that does not own it.

### 2.4 Cycles

Five strongly-connected components. They are **not** equally serious, and the difference matters:

| SCC | Nodes | Assessment |
|---|---|---|
| Config/persistence/vector cluster | 32 | Mostly **lazy**: `config_access.js` has zero top-level requires and reaches `crypto_vault` inside functions. The cycle exists in the graph but not in load order. |
| MCP/workflow/agent cluster | 86 | **The real problem.** Spans `mcp/`, `workflow/`, `mcp_clients/`, `web/`, and 30+ root modules. Driven by genuine top-level requires (e.g. `src/mcp/tool_dispatch.js` has 14 top-level requires). |
| `mcp/hitl_picker.js <-> hitl_picker_server.js` | 2 | Small, trivially breakable. |
| `workflow/akatsuki/lab.js <-> lab_db.js` | 2 | Small. |
| `workflow/akatsuki/init.js <-> tool_registry.js` | 2 | Small. |

**Honest caveat:** a static graph cannot distinguish a top-level require from one inside a function, and CommonJS commonly uses the latter *to break* load-order cycles deliberately. The 32-node cluster is largely this pattern and should not be "fixed" — it works. The 86-node cluster contains real top-level edges and is the one worth breaking.

The 2 unresolved relative requires are `src/mcp/langgraph/index.js -> ./nodes/Plan` (a comment, not code) and `src/mcp/skills_search.js -> ./yaml_utils` (a `try/catch` chain that falls back to `../yaml_utils` then `$HOME/.konoha/yaml_utils`). Both are pre-existing false positives, already documented, and must not be "fixed".

### 2.5 Dynamic requires

15 files use computed `require()`. Most are legitimate loaders (`file_tools_launcher.js`, `cursor_bootstrap.js`, `hitl_picker_server.js`). `src/config_access.js` is the load-bearing one: it is the reason 74 modules can depend on config without depending on each other. Any proposal that replaces it with static imports would create a far worse cycle, so it must be treated as an intentional facade.

---

## 3. Runtime and compatibility contract

Moves are unsafe without an adapter where a path is resolved at runtime rather than by `require`. Confirmed path-based consumers:

- `bin/lib/runtime_install.js` mirrors `src/` into `~/.konoha/` and links each flat entry at `~/.konoha/src/<name>`. Modules resolve upward through that mirror, so a file move changes what `../../web/...` means in the installed tree.
- `src/mcp_tool_manifest.json` and `src/agent_contract.js` are consumed by external clients by path.
- `tests/test_runtime_mirror_requires.js` asserts the installed tree resolves no worse than the repo tree; it will catch a move that breaks the mirror.
- `src/templates/` is packaged and synced separately (`tests/test_skill_tree_parity.js`); it is out of scope by the issue's own instruction.

---

## 4. What is *not* a problem

Stated explicitly so the plan does not "fix" working composition roots:

- `src/server.js`, `src/file_tools_launcher.js`, `src/migrate.js`, `src/web_server.js` — entry points, correctly at the root.
- `src/config_access.js` — deliberate lazy facade (§2.3).
- The 32-node config/persistence cycle — lazy by design (§2.4).
- `src/templates/` — vendored packaging, explicitly out of scope.
- The two unresolved requires — known false positives (§2.4).

---

## 5. Proposed target structure and migration

**Principle:** name the shared layer first, break the one real cycle second, and only then consider moving files. No phase below requires moving a file to be useful, which is deliberate — the audit found that the coupling is in *what depends on what*, not in *which folder a file sits in*.

### Phase 0 — name the shared infrastructure layer (no moves)

Document the root as an explicit layer with four parts, and enforce the rule that domain code may depend on it but infrastructure may not depend on domains:

| Layer | Contents (examples) | Rule |
|---|---|---|
| `infra` | `db.js`, `sqlite_driver.js`, `config_access.js`, `platform_utils.js`, `circuit_breaker.js`, `vector_*` | May not require `mcp/`, `workflow/`, `web/`, `telegram/`, `bridge/` |
| `primitives` | `yaml_utils.js`, `url_canonical.js`, `token_sampler.js` | Leaf; no internal deps |
| `domain` | `agent_*`, `persona_memory*`, `memory_brain*`, `skill_*` | May require infra + primitives |
| `entry` | `server.js`, `migrate.js`, `web_server.js`, `file_tools_launcher.js` | May require anything |

**Validation:** an import-direction test over `scripts/audit_src_boundaries.js --json` that fails when an `infra` file requires a `domain` or `entry` file. No file moves, so zero runtime risk.

### Phase 1 — break the 86-node MCP/workflow cluster

Start from the smallest cycles, which are cheap and prove the approach:

1. `mcp/hitl_picker.js <-> hitl_picker_server.js` — extract the shared type/constant into a third module.
2. `workflow/akatsuki/lab.js <-> lab_db.js`, `init.js <-> tool_registry.js` — same shape.

Then attack the bidirectional `mcp <-> workflow` pair by defining the boundary explicitly: `workflow/` owns orchestration and may call `mcp/` tool implementations; `mcp/` must not import `workflow/` directly and instead receives orchestration through an injected interface. The 39 `workflow -> mcp` edges are the ones to invert.

**Validation:** the audit script's cycle count must drop; `tests/test_workflow_*.js`, `tests/test_subagent_tool_contract.js`, and `tests/test_mcp_protocol.js` must stay green.

### Phase 2 — relocate the three clear misplacements (with adapters)

| File | To | Adapter |
|---|---|---|
| `src/mcp/client_detection.js` | `src/infra/` (or root-as-infra) | Keep a re-export at the old path for one release |
| `src/mcp/runtime_state.js` | same | same |
| `src/workflow/kage-reviewer/sdlc_manager.js` | same | same |

Each move keeps a compatibility shim at the original path, because `bin/lib/runtime_install.js` mirrors these paths into `~/.konoha/` and older installs resolve them directly.

**Validation:** `tests/test_runtime_mirror_requires.js` and `tests/test_install_lifecycle_and_db_preservation.js` are the gate; they fail if the installed mirror resolves worse than the repo.

### Phase 3 — split the oversized root modules (optional, by value)

Only where a module mixes two responsibilities that have independent consumers. This phase is explicitly not a prerequisite for anything above.

### Out of scope

`src/templates/`, vendored skills, generated assets, and the CLI/MCP/Web entry points. The issue forbids reorganizing these, and §3 confirms they are packaging concerns.

---

## 6. Recommended first step

Phase 0. It requires no file moves, no adapter, and no runtime risk, and it converts the audit's central finding — that `(root)` is an unnamed shared layer — into an enforceable rule. Everything in Phase 1 becomes safer once "infra may not depend on domain" is a test rather than a convention.

---

## 7. Verification status

- Inventory, edges, cycles, hubs: produced by `node scripts/audit_src_boundaries.js` against this branch.
- Load-order vs. graph-only cycles: distinguished by inspecting top-level vs. nested requires in the sampled files (§2.4); the 86-node SCC was confirmed to contain top-level edges.
- Not verified: runtime behaviour of any proposed move. No move has been made, which is the issue's requirement.
