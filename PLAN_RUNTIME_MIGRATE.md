# PLAN_RUNTIME_MIGRATE.md
## Konoha — Single-Runtime Migration Plan (Python → Pure Node.js/JavaScript)

**Status:** Draft for execution
**Target outcome:** Konoha runs on **one scripting runtime only (Node.js/JavaScript)**. Python 3 is fully removed as a hard dependency (no `python3`, no `py -3`, no pip packages, no Python subprocess spawning anywhere in the install, migrate, index, search, savings, or MCP-serving paths).
**Non-negotiable constraint:** **Zero regression.** Every CLI command, every MCP tool (all 38), every subagent behavior, every TUI screen/animation, every benchmark/telemetry number, every cross-client integration (Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex), and every documented workflow must behave identically after migration. This is a **runtime/implementation migration**, not a feature, UX, or architecture redesign.

---

## 0. Why this migration (context for the executing agent)

Konoha currently ships as a **dual-runtime** project:
- **Node.js** owns: `bin/cli.js` (CLI, TUI, progress bar, spinner), client managers (`agent_manager.js`, `cursor_manager.js`, `codex_manager.js`, `opencode_manager.js`, `antigravity_manager.js`, `mcp_clients_manager.js`), `deploy_utils.js`, `skill_manager.js`, `agent_contract.js`, `search_policy.js`, `prompt_hook.js`, `platform_utils.js`, `file_tools_router.js`, `file_tools_mcp.js`, `file_tools_launcher.js/.sh`, `bin/lib/yaml_utils.js`.
- **Python 3** owns: `src/server.py` (core MCP tool logic — build specs, workflow/Kage review gate, persona memory, project context, web search, subagent delegation contracts), `src/migrate.py` (skill indexing/optimization/chunking), `src/vector_search.py` (ONNX embedding + reranking + `sqlite-vector` hybrid search), `src/db.py` + `src/db_agents.py` + `src/db_bridges.py` + `src/db_savings.py` + `src/db_stats.py` (SQLite access layer), `src/persona_memory.py`, `src/file_tools/_common.py` and individual file-tool worker scripts, `src/tools_savings_logger.py`, and a large share of `tests/test_*.py`.

This split forces Konoha to detect, spawn, and marshal JSON across a Python subprocess (`spawnPythonSync`/`spawnPython` in `platform_utils.js`) for nearly every non-trivial operation. This is the direct cause of a large share of the bugs already logged in `CHANGELOG.md` (Windows `py -3` launcher `ENOENT`, stdin/argv JSON quoting corruption, `PYTHONIOENCODING` issues, `spawnSync python3 ETIMEDOUT` during embedding backfill, cross-platform path prefix bugs unique to the Python/Node boundary, etc.). Collapsing to one runtime removes an entire class of cross-language marshaling bugs, removes the Python 3.8+ system requirement, and — per the project's own findings in beta.5/beta.6 ("Fast-Path In-Process Agent Loading", replacing a child-process call with direct in-process parsing cut latency from ~1.2s to <0.5ms) — is expected to materially improve CLI and MCP latency by eliminating process-spawn overhead entirely.

---

## 1. Guiding principles (apply to every phase)

1. **Feature parity is the acceptance bar, not a nice-to-have.** Every tool name, tool input schema, tool output shape, CLI flag, CLI output string/table/progress format, and file path under `~/.konoha/`, `~/.gemini/`, `~/.cursor/`, `~/.claude/`, `~/.config/opencode/`, `~/.commandcode/`, `~/.codex/` must remain byte-for-byte compatible unless explicitly called out as an intentional, approved change.
2. **Behavior first, implementation second.** Port logic 1:1 before optimizing. Do not "improve" business logic (thresholds, regex patterns, table formats, gate conditions) while porting — that is a separate, later, explicitly-scoped task.
3. **No native compilation required by default.** Prefer WASM/pure-JS or prebuilt-binary npm packages with first-class Windows/macOS/Linux (x64 + arm64) support, matching Konoha's existing "lazy first-run download, graceful fallback" philosophy already used for `sqlite-vector`.
4. **One schema, one owner.** The SQLite schema currently owned by `src/db.py` becomes owned by a single new `src/db.js`. No duplicate schema definitions, no duplicate YAML parsers (the project already has two YAML parsers — `bin/lib/yaml_utils.js` and a Python one in `db_agents.py` — this migration deletes the Python one and consolidates on the JS one).
5. **Test before cut, not after.** Every phase ends with the **old Python path and new JS path producing identical output** on the same inputs before the Python path is deleted. Do not delete a Python file until its JS replacement has passed a parity test.
6. **Cross-platform is the point of this migration.** Every new module must be validated (or at minimum reasoned about explicitly) on Linux, macOS, and Windows (native + WSL2), matching the existing `tests/test_cross_platform.py` intent.
7. **Commit per phase.** Each phase below should land as its own commit/PR with its own `CHANGELOG.md` entry, so a regression can be bisected to a single phase.

---

## 2. Phase 0 — Mandatory audit (do this before writing any code)

This document is written from the public `README.md` / `CHANGELOG.md` history and may not reflect the exact current file layout. **Before executing any phase below, produce an audit report** (`docs/RUNTIME_MIGRATE_AUDIT.md`) that answers:

- [ ] Enumerate every `.py` file under `src/`, `bin/`, `scripts/`, and `tests/`. For each, list: purpose, public functions/entry points, which Node module(s) call it, and via which mechanism (`spawnPythonSync`, `spawnPython`, direct `spawnSync`, MCP stdio subprocess registration in a client config).
- [ ] Confirm, per client (Antigravity `mcp_config.json`, Cursor `mcp.json`, Claude Code `.claude.json`, OpenCode `opencode.json`, Command Code `mcp.json`, Codex `config.toml`), **which process is actually registered as the `konoha` MCP server today**: is it `node file_tools_mcp.js` (Node) or `python3 server.py` (Python), or both registered as separate MCP servers under different names? This determines whether Phase 5 (server.py) is a transport-layer change or a pure logic port.
- [ ] Confirm exact current Python dependency footprint: stdlib-only, or does `src/vector_search.py` require pip packages (`onnxruntime`, `numpy`, `tokenizers`) at runtime? README claims "no external pip packages required" for the base server but also describes ONNX inference — resolve this discrepancy before Phase 3.
- [ ] Confirm exact current SQLite schema by dumping `PRAGMA table_info` for every table in a live `~/.konoha/skills.db`, and diff against the tables named in `docs/ARCHITECTURE.md` (`skills`, `skills_fts`, `skill_chunks`, `tool_calls`, `active_sessions`, `agents`, `bridges`, `projects`, `persona_memories`, `persona_memories_fts`).
- [ ] Confirm exact list of the 38 registered MCP tools (names + JSON schemas) as currently served, by calling `list_skills`/tool-list introspection or reading `src/mcp_tool_manifest.json` and `~/.konoha/mcp_tool_manifest.json`.
- [ ] Confirm which `tests/test_*.py` files exist today and what each asserts, so Phase 8 can produce a Node test with equivalent assertions (not just equivalent file names).
- [ ] Confirm current Node engine minimum (`package.json` `engines`) — the plan below assumes Node ≥ 18 but recommends specific package choices that work at that floor; note any place a higher floor (e.g., Node ≥ 20/22) would materially simplify the port, and flag it as a **decision point**, not an unapproved change.

Do not proceed past Phase 0 until this audit file exists and is internally consistent with this plan. Where the audit contradicts an assumption in this plan, **update this plan file first**, then proceed.

---

## 3. Target architecture (single runtime)

```
bin/cli.js                     (unchanged entry point, TUI, progress bar, spinner)
src/
  db.js                        ← replaces db.py            (better-sqlite3, WAL, FTS5, schema owner)
  db_agents.js                 ← replaces db_agents.py
  db_bridges.js                ← replaces db_bridges.py
  db_savings.js                ← replaces db_savings.py
  db_stats.js                  ← replaces db_stats.py       (or folded into db.js if audit shows near-duplication)
  persona_memory.js            ← replaces persona_memory.py
  migrate.js                   ← replaces migrate.py
  vector_search.js             ← replaces vector_search.py  (transformers.js / onnxruntime-node)
  tools_savings_logger.js      ← replaces tools_savings_logger.py
  server.js                    ← replaces server.py         (38-tool MCP logic, JSON-RPC over stdio)
  file_tools/
    common.js                  ← replaces file_tools/_common.py
    read_file_head.js, read_file_range.js, file_info.js,
    token_efficient_grep.js, get_file_structure.js,
    find_files_clean.js        ← replace individual Python workers; now in-process functions,
                                  no child_process spawn at all (bigger win than Python removal alone)
  file_tools_router.js         (unchanged transport shell, but now calls JS functions directly
                                 instead of spawning a Python worker via stdin JSON piping)
  file_tools_mcp.js            (unchanged, or merges with server.js if Phase 0 shows they should
                                 be one MCP process — decide in audit)
  platform_utils.js            (Python-detection functions — detectPython, spawnPythonSync,
                                 spawnPython, normalizeCommand for `py -3` — DELETED at end of Phase 7)
  agent_manager.js, cursor_manager.js, codex_manager.js, opencode_manager.js,
  antigravity_manager.js, mcp_clients_manager.js, deploy_utils.js, skill_manager.js,
  agent_contract.js, search_policy.js, prompt_hook.js, bin/lib/yaml_utils.js  (unchanged, except
                                 removing any remaining call sites that shell out to Python)
tests/
  test_*.js                    ← all Python tests ported to node:test, 1:1 assertion parity
```

Nothing under `bin/cli.js`'s user-facing surface, no MCP tool name/schema, no client config shape, and no `~/.konoha/skills.db` table/column changes. This is purely: **Python file → JS file, same behavior, in-process instead of subprocess.**

---

## 4. Dependency replacement matrix

| Python responsibility | Python mechanism | Node.js replacement | Notes |
|---|---|---|---|
| SQLite connection + WAL/FTS5 + schema DDL | `sqlite3` stdlib | **`better-sqlite3`** | Synchronous API mirrors Python's `sqlite3` closely (easiest 1:1 port). Ships FTS5-enabled SQLite amalgamation with prebuilt binaries for Windows/macOS/Linux x64+arm64 — no compiler required on the install target in the common case. |
| `sqlite-vector` loadable extension | `conn.enable_load_extension()` + manual per-platform binary download | `better-sqlite3`'s `.loadExtension()` | **Reuse the exact same prebuilt binaries and the exact same lazy-download-per-platform logic already in `vector_search.py`** — only the loader call changes language. Do not re-architect the download/cache logic. |
| IBM Granite 97M multilingual ONNX embedder | Raw ONNX runtime invocation + `tokenizers` | **`@huggingface/transformers`** (transformers.js) with the `onnx-community/granite-embedding-97m-multilingual-r2-ONNX` model id (same model, same weights) | Transformers.js bundles WASM ONNX Runtime + tokenizer, so it needs **no native compilation at all**, matching the "efficient, cross-platform" goal better than a native ONNX binding would. Keep the existing lazy first-run download-to-`~/.konoha/` cache behavior; just change what gets cached (transformers.js's own cache dir, redirected into `~/.konoha/`). |
| Alibaba GTE multilingual cross-encoder reranker | Same as above | Same `@huggingface/transformers` pipeline, `onnx-community/gte-multilingual-reranker-base` | Preserve sigmoid scoring exactly as implemented in `vector_search.py`. |
| Reciprocal Rank Fusion math | Pure Python arithmetic | Pure JS arithmetic, same `RRF(d) = Σ 1/(60+rank)` formula | Direct line-for-line port, no library needed. |
| YAML parsing for agents | Python YAML parser in `db_agents.py` **+** `bin/lib/yaml_utils.js` (duplicated) | **`bin/lib/yaml_utils.js` only** | Delete the Python parser. This also fixes the historical "empty scalar YAML" bug class at its root by having exactly one parser to fix instead of two. |
| Python subprocess detection (`py -3`, `python3`) | `platform_utils.js: detectPython/spawnPythonSync/spawnPython/normalizeCommand` | **Deleted entirely** | No replacement needed — there is nothing left to spawn. |
| Regex-based content optimization (`optimize_content`) | Python `re` module | Node `RegExp` | 1:1 port; same YAML-frontmatter-strip, HTML-comment-strip (respecting the Svelte-directive exception already fixed in `migrate.py`), heading normalization, blank-line collapsing rules. |
| Markdown heading-aware chunking (`chunk_document`) | Python string ops | JS string ops | 1:1 port, same 2,000-char cap / 100-char overlap constants. |
| Transcript/session mtime caching | Python `os.path.getmtime` + JSON cache file | Node `fs.statSync(...).mtimeMs` + same JSON cache file at `~/.konoha/transcript_cache.json` | Keep the exact same cache file so no migration/reset is needed for existing installs. |
| Python test suite | `pytest`-style `test_*.py` | **`node:test`** (built-in, zero new dependency) with `node:assert` | Chosen over Jest/Vitest specifically to avoid adding a new dependency, consistent with the project's stated minimal-dependency stance. |

**Package additions to `package.json` (production dependencies):** `better-sqlite3`, `@huggingface/transformers`. That's it — everything else above is stdlib Node (`fs`, `path`, `crypto`, `child_process` only where still legitimately needed for non-Python things like `git`-free semble/`uvx` invocation, which is out of scope for this migration).

**Package removals:** any `requirements.txt` / pip bootstrap step in `bin/cli.js` (`cmdInit`, `cmdDoctor`), and the "Python 3 ≥ 3.8" line everywhere it appears in docs.

---

## 5. Migration phases

Execute strictly in order. Each phase has explicit **done criteria** — do not start the next phase until the current one's done criteria are met and committed.

### Phase 1 — SQLite/DB layer (`db.py` family → `db.js` family)
- Port `src/db.py` → `src/db.js`: same `DB_PATH`, same four `PRAGMA` statements, same `setup_schema()` DDL verbatim (table names, column names, types, indexes, triggers, FTS5 virtual tables and their sync triggers must match exactly).
- Port `db_agents.py`, `db_bridges.py`, `db_savings.py`, `db_stats.py`, `persona_memory.py` → their `.js` equivalents, function-for-function (same function names where reasonably possible, to ease cross-referencing during review).
- **Done criteria:** Run both the Python and JS DB layers against a **copy** of a real `skills.db`, execute every CRUD/query path (agents CRUD, bridges CRUD, savings queries, project/persona memory CRUD, skills FTS query), and diff outputs. Byte-identical results required. Only then may Phase 1's Python files be marked "superseded, do not delete yet" (deletion happens in Phase 11).

### Phase 2 — Skill migration/indexing engine (`migrate.py` → `migrate.js`)
- Port `optimize_content`, `chunk_document`, the `--skip-embeddings` / `--skills-only` / `--require-skill` / `KONOHA_MIGRATE_TIME_BUDGET` flag behavior, the dependent-rows-first FK-safe deletion logic in `_migrate_skill`, and the three-tier progressive fallback chain (full → `--skip-embeddings` → `--skills-only`).
- **Done criteria:** Running `konoha migrate` and `konoha migrate --force` against a real skills tree produces the same row counts, same skipped-reference counts, and the same printed CLI summary (byte-for-byte or intentionally-noted format-preserving diff) as the Python version.

### Phase 3 — Hybrid vector search (`vector_search.py` → `vector_search.js`)
- Implement the embedder + reranker pipeline via `@huggingface/transformers` as described in §4.
- Port the 4-tier deduplication exactly: SHA-256 chunk-hash dedup, in-memory `_EMBED_CACHE` (keep the 4,096-entry cap), DB-level blob reuse in `index_single_skill_chunks`, and candidate dedup in `scan_nearest_chunks`.
- Preserve the `KONOHA_SEMANTIC_SEARCH=1` opt-in flag and the FTS5/NumPy-fallback→**JS-fallback** graceful degradation path (if `sqlite-vector` extension load fails, fall back to in-process cosine similarity in plain JS instead of NumPy — same behavior, same log level for the fallback message, per the existing "debug level, not noisy" rule).
- **Done criteria:** Re-run the existing 40-query English/Indonesian cross-lingual benchmark. Recall@5 and MRR@5 must be within noise of the documented baselines (Overall 97.5% Recall@5 / 0.885 MRR@5; do not regress below the FTS5-only baseline of 0.769 MRR either). Record the new numbers in `docs/BENCHMARK.md` under a new dated entry — do not overwrite historical entries.

### Phase 4 — File tools workers (Python workers → in-process JS functions)
- Port `file_tools/_common.py` (`dev_root` allow-list, `assert_within_allowed`, `SKIP_DIR_NAMES`, Windows extended-prefix stripping `\\?\`, `//?/`, `\??\`) and each worker script into `src/file_tools/*.js`.
- Change `file_tools_router.js` from "spawn Python via stdin JSON piping" to **direct in-process function calls**. This removes not just Python but the entire child-process round-trip for these hot-path tools (`read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`) — expect this to be the single biggest latency win in the whole migration.
- **Done criteria:** All bounded-tool guarantees still hold exactly: `read_file_head` max 200 lines, `read_file_range` max 500-line span, `token_efficient_grep` max 20 matches (cap 50), same `SKIP_DIR_NAMES` skip list (`.git`, `node_modules`, `dist`, lockfiles, `go-dist`, `vendor`, `references`, `.turbo`, `.cache`, `site-packages`, `third_party`). Path-sandbox rejection tests (absolute traversal, Windows drive-letter edge cases from beta.5) must pass identically.

### Phase 5 — Core MCP server logic (`server.py` → `server.js`)
- Port everything server.py currently owns: skill discovery (`find_skill`/`find_skills`, `get_skill`, `list_skills`, `optimize_report`), the build-spec tools (`build_from_text`, `build_from_source`, `build_with_image_design`), `web_search`, the subagent delegation tools (`sannin`, `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`), the workflow/Kage review gate (`_workflow_review_approved`, `run_mcp_workflow`, the `ai_slop_clean`/`ai_slop_findings` hard gate), `_assess_validation_evidence`, `detect_active_client`/`detect_active_agent` (including the `ANTIGRAVITY_CONVERSATION_ID` session-isolation logic and the Cursor-vs-Antigravity ranking-by-mtime logic), `auto_migrate_project_skills`, project/persona memory tools, and every constant (`PREVIEW_LIMIT`, `COMPACT_PREVIEW_LIMIT`, `MAX_CONTENT_SIZE`, `SESSION_TURNS`, `SESSION_IDLE_RESET_SECONDS = 1800`, truncation boundaries at 1200/600 chars via `_truncate_at_boundary`).
- Resolve, per the Phase 0 audit finding, whether this becomes its own MCP stdio process (`node src/server.js`) or is merged into `file_tools_mcp.js` as one unified process exposing all 38 tools. **Prefer merging into one process** if the audit shows they were already meant to be one logical server — one Node process instead of a Node process + a Python process is a direct simplification win and reduces MCP client config surface area.
- **Done criteria:** Every one of the 38 tools, called with the same arguments, returns the same JSON shape and the same values (modulo timestamps/ids) as the current implementation. The Kage zero-AI-slop pre-gate still hard-blocks on `ai_slop_findings != 0`. Auto-compaction still activates at `turn >= 2` and still preserves the primary skill SOP preview.

### Phase 6 — Telemetry / savings logger (`tools_savings_logger.py` → `.js`)
- Port `log_tool_call` baseline-crediting logic (build tools + subagent delegations credited against the 550KB baseline; directory baselines for `find_files_clean` (250KB) and `token_efficient_grep` (150KB)) and the removed 60-second throttle behavior.
- **Done criteria:** `konoha savings` output (Today/7-day/All-time tables, combined percentage box, call-type breakdown bars) is pixel-for-pixel identical in format to current output, and the underlying numbers match when replayed against the same transcript fixtures.

### Phase 7 — CLI wiring cleanup
- Remove every call site of `spawnPythonSync`/`spawnPython`/`detectPython`/`normalizeCommand`(Python variant) from `bin/cli.js`, `src/agent_manager.js`, `src/codex_manager.js`, and anywhere else the audit finds them.
- Remove the Python-launcher-detection step from `konoha doctor` and `konoha init`, and remove any `pip`/`requirements.txt` bootstrap step.
- Delete now-dead Python-specific fields from `platform_utils.js` (`detectPython`, `spawnPythonSync`, `spawnPython`) once nothing calls them.
- **Done criteria:** `grep -ri "python\|spawnPython\|py -3" bin/ src/` (excluding this plan file, `CHANGELOG.md`, and historical docs) returns zero hits in active code paths.

### Phase 8 — Test suite port
- For every `tests/test_*.py` identified in the Phase 0 audit, write an equivalent `tests/test_*.js` using `node:test`, preserving the same test names/descriptions and the same pass/fail assertions (do not weaken coverage; if a Python test used a Python-only mocking trick, find the Node equivalent, don't drop the assertion).
- Explicitly re-verify the suites called out by name in `CHANGELOG.md`: `test_database_migration`, `test_auto_compaction`, `test_taste_skill_jonin`, `test_structured_delegation`, `test_scratch_path`, `test_anti_slop_gate` (8/8), `test_embedding_deduplication`, `test_cross_platform`, `test_cursor_attribution` (8/8), `test_bridge_gateway`, `test_web_search`, `test_agent_attribution` (7/7), `test_project_skills_auto_migrate`, `test_python_spawn_cross_platform` (**delete this one — it becomes meaningless with no Python to spawn; replace with nothing or a short "no python subprocess exists" guard test**).
- Update `node tests/run_all.js` to run one homogeneous Node test pass instead of the current mixed Python+Node runner.
- **Done criteria:** Full suite passes with 100% pass rate on Linux, macOS, and Windows CI (or local runs across all three if CI isn't available), matching or exceeding the previously reported "52 complete test suites" / "63 passed, 0 failed" milestones.

### Phase 9 — Docs & client config cleanup
- Remove the "Python 3 ≥ 3.8" requirement line from `README.md`, `docs/SETUP-IDE.md`, `docs/SETUP-CLI.md`, `docs/SETUP-CURSOR.md`, `docs/SETUP-MCP-CLIENTS.md`, `docs/TROUBLESHOOTING.md`, and `docs/ARCHITECTURE.md` (this file).
- Update any per-client MCP registration code (`agent_manager.js`, `cursor_manager.js`, `codex_manager.js`, `opencode_manager.js`, `antigravity_manager.js`, `mcp_clients_manager.js`) that currently writes a `python3 .../server.py` command into a client's `mcp_config.json`/`mcp.json`/`.claude.json`/`opencode.json`/`config.toml`, so it instead writes the single Node entry point for all six clients.
- Update `konoha doctor`'s diagnostic list to drop Python-related checks and add "Node runtime version" / "single-runtime integrity" checks instead.
- Add a new dated entry to `docs/SecurityCompliance/` reflecting the reduced attack surface (no Python interpreter, no pip supply chain) as a positive compliance delta.
- **Done criteria:** Fresh install on a machine **with no Python installed at all** succeeds end-to-end (`konoha init` → `konoha test` → `konoha status` → `konoha migrate` → `konoha savings`) on Linux, macOS, and Windows.

### Phase 10 — Cross-platform validation & parity sign-off
- Run the full `konoha test` self-test suite and the full Node test suite on: Linux (glibc), macOS (Apple Silicon + Intel if available), Windows (native PowerShell + Git Bash + WSL2).
- Re-record the benchmark numbers in `docs/BENCHMARK.md` (startup payload size, per-query token savings, and now also **process-spawn latency removed** as a new, honestly-labeled metric — measured, not estimated, consistent with the project's existing "not measured by this suite" honesty standard for anything not actually benchmarked).
- Produce a parity report (`docs/RUNTIME_MIGRATE_PARITY_REPORT.md`) listing every tool/command tested and pass/fail, for sign-off before Phase 11.

### Phase 11 — Cutover & Python removal
- Only after Phase 10 sign-off: delete `src/server.py`, `src/migrate.py` (Python), `src/vector_search.py` (Python), `src/db.py`/`db_agents.py`/`db_bridges.py`/`db_savings.py`/`db_stats.py` (Python), `src/persona_memory.py` (Python), `src/file_tools/*.py`, `src/tools_savings_logger.py` (Python), all `tests/test_*.py`, and any `requirements.txt`/`setup.py`/pip-related files.
- Remove `"Python 3 ≥ 3.8"` and `--python`-related CLI flags/help text entirely.
- Bump version and write the `CHANGELOG.md` entry (see §7 for the required template).
- **Done criteria:** Repository contains zero `.py` files. `konoha doctor` reports a clean, single-runtime install.

---

## 6. Feature-parity checklist (must all remain true post-migration)

- [ ] All 16 commands shown in `demo.gif` behave identically.
- [ ] `konoha init`, `migrate`, `test`, `status`, `version`, `upgrade`, `bridge status/list/create/delete/enable/disable`, `savings`, `doctor`, `uninstall`, `skill <list|search|add|remove|embed|unembed>`, `agent <list|create|skill|delete|status>`, `project <context|list|add|memory>`, `data <view|prune|vacuum|export>`, `help` — every flag and every printed line of output unchanged.
- [ ] All 38 MCP tools present with identical names, schemas, and behavior across all 6 clients.
- [ ] 7 Naruto-ranked subagents (`genin`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`, `kage`, `sannin`) — identical skill-resolution (exact → fuzzy Levenshtein ≤3 → prompt-driven autoload top-3) and identical guardrails (no git execution, `.env`/`.tfvars`/`secrets.yaml` read-only, locked subagent roster, circuit breaker at depth > 7 / 5 per version in use).
- [ ] TUI: `KonohaProgressBar` 7-stage rendering, braille spinner (90ms, `KONOHA_SPINNERS=0` opt-out), Unicode/CJK/emoji-aware column widths, ANSI-safe truncation — pixel-identical.
- [ ] Hybrid semantic search: `KONOHA_SEMANTIC_SEARCH=1` opt-in, FTS5-default zero-config behavior, RRF fusion, graceful fallback chain — identical.
- [ ] `build_from_text` / `build_from_source` / `build_with_image_design` — identical output specs, identical framework support (Next.js 16, Nuxt 3, SvelteKit 2, Angular v19+), identical design invariants (far-left logo, zero mobile hamburger, floating bottom-left theme FAB, archetype-adaptive mobile dock, 4-slide hero carousel, admin left sidebar).
- [ ] Zero-AI-slop gate (`aislop_scan`/`aislop_fix`/`aislop_why`) role boundaries and hard pre-gate — unchanged (this MCP server is external/npm-based and is **out of scope** for this migration; do not touch it).
- [ ] `semble` MCP integration (external, `uvx`-based) — unchanged and **out of scope**; this migration only touches Konoha's own Python code, not third-party MCP servers it talks to.
- [ ] Konoha Bridge Router on port `19999`, model-prefix routing, header-stripping security boundary — unchanged (already pure JS today; verify no incidental Python coupling exists before assuming this).
- [ ] RTK (Rust Token Killer) integration — unchanged (external binary, out of scope).
- [ ] Cross-client deployment targets (`~/.gemini/`, `~/.cursor/`, `~/.claude/`, `~/.config/opencode/`, `~/.commandcode/`, `~/.codex/`) — identical file trees, identical file contents (minus the MCP command line now pointing at Node instead of Python where applicable).
- [ ] `docs/BENCHMARK.md` historical entries preserved verbatim; only new entries appended.

---

## 7. Required `CHANGELOG.md` entry template (fill in at Phase 11)

```markdown
## [vX.Y.Z] - <date>

### Major: Single-Runtime Migration — Python Fully Removed
- **Zero Python Dependency**: Konoha now runs entirely on Node.js. Removed the Python 3 ≥ 3.8
  requirement, all `spawnSync python3` / `py -3` subprocess calls, and every `.py` source file.
- **In-Process File Tools**: `read_file_head`, `read_file_range`, `file_info`,
  `token_efficient_grep`, `get_file_structure`, and `find_files_clean` now execute in-process
  in Node instead of spawning a Python worker via stdin JSON piping, eliminating an entire class
  of cross-platform quoting/encoding bugs and removing process-spawn latency from every call.
- **Ported Modules**: `db.py` family → `db.js` family (`better-sqlite3`, same WAL/FTS5 schema),
  `migrate.py` → `migrate.js`, `vector_search.py` → `vector_search.js`
  (`@huggingface/transformers`, same Granite embedder + GTE reranker models, same RRF fusion),
  `persona_memory.py` → `persona_memory.js`, `tools_savings_logger.py` → `.js`,
  `server.py` (38 MCP tools) → `server.js`.
- **Consolidated YAML Parsing**: Removed the duplicate Python YAML parser in favor of the single
  existing `bin/lib/yaml_utils.js`, closing the historical empty-scalar-parsing bug class at its
  root.
- **Zero Feature Regression**: All 38 MCP tools, 16 CLI commands, 7 subagents, TUI rendering,
  hybrid semantic search benchmarks, and all 6 client integrations verified byte/behavior-
  identical pre- and post-migration. See `docs/RUNTIME_MIGRATE_PARITY_REPORT.md`.
- **Requirements**: Dropped "Python 3 ≥ 3.8" from all setup docs. Requirements are now Node.js
  ≥ 18 only.
```

---

## 8. Risk register

| Risk | Mitigation |
|---|---|
| `better-sqlite3` prebuilt binary unavailable for an exotic platform/arch | Ship the same "lazy download + graceful fallback" pattern already used for `sqlite-vector`; document manual build-from-source fallback in `TROUBLESHOOTING.md`. |
| ONNX-via-WASM (`@huggingface/transformers`) is slower than native Python ONNX runtime on large embedding backfills | Benchmark in Phase 3 against the existing 40-second time-budget constant; if WASM misses the budget on reference hardware, allow `onnxruntime-node` as an **optional accelerated backend** behind a flag, keeping WASM as the zero-dependency default. |
| Hidden Python-only edge-case behavior not visible from `CHANGELOG.md`/`README.md` alone | Phase 0 audit is mandatory precisely to surface this; do not skip it. |
| Client MCP configs already point at a working Python process for some users, and rewriting them mid-upgrade could break an in-flight session | `konoha upgrade` should regenerate all client configs atomically (as it already does today for other config changes) and only after the new Node server passes its own self-test (`konoha test`) — reuse the existing self-healing/doctor pattern rather than inventing a new one. |
| Semver/versioning expectations | Treat this as a **major internal architecture change**; recommend a minor-or-major version bump (team's call) with an explicit "no user-facing behavior change" note in the changelog, consistent with how prior breaking-adjacent changes (e.g., port 11434→19999) were documented. |

---

## 9. Rollback plan

Because Python files are only deleted in Phase 11, every prior phase is independently revertible via `git revert` of that phase's commit without touching later phases' unrelated code, **except** Phase 11 itself, which should only ever be executed after the Phase 10 parity sign-off exists in the repo as a committed file. If a regression is found after Phase 11, restore the specific deleted `.py` file(s) and the corresponding `spawnPython*` call site from git history rather than re-deriving them.

---

## 10. Execution instructions for the agent running this plan

1. Read this entire file before touching any code.
2. Execute Phase 0 and commit `docs/RUNTIME_MIGRATE_AUDIT.md`. If any assumption in §3–§6 is contradicted by the audit, edit this plan file to match reality, commit that edit with a clear message, and continue.
3. Execute Phases 1 → 10 strictly in order. Do not parallelize across phases even if it looks safe — later phases assume earlier phases' "done criteria" are already true. Within a phase, parallelizing independent files is fine.
4. After each phase, run the full existing test suite (mixed Python+Node until Phase 8 completes) plus that phase's specific parity check, and only commit if green.
5. Do not perform Phase 11 without a committed `docs/RUNTIME_MIGRATE_PARITY_REPORT.md` showing 100% pass across the checklist in §6.
6. Do not modify any business logic, threshold, gate condition, table format, or CLI copy while porting — flag anything that looks like a bug in the *existing* Python implementation in a `NOTE:` comment instead of silently "fixing" it during the port; fixes are a separate follow-up PR.
7. Write the final `CHANGELOG.md` entry using the template in §7, and update `README.md`'s requirements section and badges (drop the Python badge, if one exists) as the very last commit of the migration.

---

## 11. TypeScript adoption (amendment to §3–§5)

If the target language for the new files in §3 is **TypeScript** rather than plain JavaScript, the plan above still applies unchanged — read every `.js` path in §3–§8 as `.ts` source that compiles to `.js` output. This does **not** conflict with the "single runtime" goal: TypeScript is a build-time layer only, the shipped/executed artifact is still plain Node.js JavaScript.

Concrete adjustments if TS is adopted:

- **Build step**: add `typescript` + `tsup` (or `esbuild` directly) as dev dependencies only. Prefer `tsup` for its zero-config CJS+ESM dual output, matching Node ≥18 consumers without forcing an ESM-only breaking change.
- **Scope of typing**: type the *new* `src/*.ts` modules from §3 (db layer, migrate, vector search, file tools, server, savings logger) plus, opportunistically, the existing `bin/cli.js`/`src/*.js` files **if** Phase 0's audit shows appetite for it — but this is optional polish, not required for zero-regression. Do not let "let's type everything" scope-creep block the actual runtime migration; land the Python removal first, then convert remaining `.js` → `.ts` file-by-file as a separate, later cleanup PR.
- **Distribution**: `package.json` `"files"`/`"bin"` must point at compiled `dist/*.js`, not `src/*.ts`, so `pnpm add --global github:andycungkrinx91/konoha` still works without requiring consumers to compile anything themselves. Add a `prepare` or `prepack` script running the build, and commit `dist/` or build-on-install — pick whichever matches the existing install philosophy (the current project favors zero-manual-steps, so build-on-`postinstall`/`prepare` is the closer fit).
- **MCP tool schemas as types**: this is the one genuine upside worth prioritizing early — define the 38 tool input/output shapes as TypeScript interfaces/Zod schemas once, and have both `server.ts` (tool implementation) and any new frontend (§12) import the *same* type definitions, so the API contract can never silently drift between backend and UI.
- **Done criteria (in addition to §5's per-phase criteria)**: `tsc --noEmit` passes with no errors, and the compiled `dist/` output is what every CLI command and MCP client actually runs — never `ts-node` or on-the-fly transpilation in the shipped product (that would add a runtime dependency and startup cost, working against the efficiency goal of this whole migration).

---

## 12. Optional post-migration add-on: local Web Configuration UI

This is explicitly **out of scope for the zero-regression runtime migration in Phases 0–11** and should not be started until Phase 11 is complete and signed off. It is captured here because it is only practical *after* this migration (today, the config/business logic is split across Python + Node, which would mean a UI talking to two different backends; after migration there is exactly one JS/TS backend to expose).

### Why this is now feasible
Once `db.js`/`db.ts`, `db_agents`, `db_bridges`, `db_savings`, and `server.ts` are all in-process Node/TypeScript modules (not Python subprocesses), a local web UI can call the exact same functions the CLI calls — no new business logic, no duplicate source of truth, no IPC to a Python process.

### Proposed shape
- **New command**: `konoha web` (aliases: `konoha ui`, `konoha config`), which starts a small local HTTP server (Fastify or plain `node:http` — avoid Express to keep the dependency-light philosophy) bound to `127.0.0.1` only by default, on an auto-picked free port (same pattern already used for the Bridge Router on `19999`), and opens the user's default browser to it.
- **Frontend stack (decided): Svelte 5 (Runes) + Vite**, built once at publish time into a static SPA and served as static assets from the same Node process — no separate frontend server, no SSR, no deploy step for end users. Chosen deliberately over React/Preact for this use case:
  - No virtual DOM — Svelte compiles to direct DOM updates, so the config UI (bridge toggles, live savings numbers, doctor repair status) feels instant rather than "app-like laggy," which matters for a tool whose whole pitch is efficiency.
  - Much smaller shipped bundle (no React/Preact runtime to ship at all), consistent with the project's zero-bloat philosophy — the UI itself shouldn't undercut the "we saved you 98% of tokens" pitch by shipping a heavy JS bundle.
  - Konoha's Jonin subagent already has first-class SvelteKit expertise (`svelte-ui-expert`, `svelte-code-expert` skills, Svelte 5 Runes conventions, a11y verification pipeline) — reuse that exact skill/knowledge instead of introducing a second, unrelated frontend convention into the project.
  - Note: this is a **plain Svelte + Vite SPA**, not SvelteKit — no routing/SSR framework needed for a single-page local config tool; pulling in SvelteKit here would add file-based routing and server-rendering machinery this UI doesn't need. Reserve SvelteKit for what Jonin already uses it for (generated end-user websites), and keep this internal tool as lightweight `vite build --template svelte-ts` output.
- **Scope of the UI (v1)** — pure CRUD/visibility over what already exists, nothing new conceptually:
  - Bridge management (equivalent of `konoha bridge create/list/enable/disable/delete`) — this is the single highest-value screen for non-technical users, since today it's an interactive terminal wizard.
  - Agent/subagent roster + skill embedding (`konoha agent list/skill/create/delete`) with a checkbox-style UI over `konoha agent skill <name>`'s existing `[x]`/`[ ]` model.
  - Skills browser/search (`konoha skill list/search/add/remove`) — a searchable table over `find_skill`/`list_skills`.
  - Savings dashboard (`konoha savings`) rendered as real charts instead of ASCII bars — this is the most natural "browser makes this nicer" win.
  - Doctor/status view (`konoha doctor`, `konoha status`) with one-click "repair" buttons that call the exact same repair functions the CLI already calls.
  - Per-client install status (which of the 6 clients are configured) with toggle switches instead of terminal prompts.
- **Explicitly not in v1**: no remote/multi-user access, no auth system beyond "bound to localhost," no editing of raw skill Markdown content in a rich editor (that's a much bigger scope — start with structured config only, not a full skill IDE), no mobile-responsive requirement (this is a local desktop dev tool).
- **Security posture**: bind to `127.0.0.1` by default; if a `--host 0.0.0.0` escape hatch is offered for remote/container use cases, it must require an explicit `--token <value>` and print a loud warning, since this UI can read/write bridge API keys and agent configs.
- **Contract safety**: the frontend must consume the **same TypeScript types/schemas** defined in §11 for the 38 MCP tools and DB models — generate a typed API client from those, don't hand-write a parallel schema that can drift.

### Suggested sequencing
Treat this as **Phase 13+** of a *separate* follow-up plan document (`PLAN_WEB_UI.md`) once §0–§12 here are fully shipped and stable for at least one release cycle, so the migration's own correctness isn't entangled with a new feature's QA. Ask for that document specifically when you're ready to start it — it will need its own scoping pass (exact screens, exact port/security defaults, exact framework pick) rather than being bolted onto this migration plan.
