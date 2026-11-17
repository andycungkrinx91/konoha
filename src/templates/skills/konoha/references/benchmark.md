# 🍃 Konoha Token Economy & Benchmark Standards (v2.2.23)

Technical reference on Konoha's token economy, compact multi-skill digests (`use_skills`), Real-Time Idle `@advisor` budget (`<= 8,192 tokens/turn`), dynamic baseline savings calculations, SQLite FTS5 benchmark metrics, and KV-cache prefix optimization.

---

## 📉 Context Token Economy & Savings Architecture (`v2.2.23`)

Konoha delivers an authentic **83%–98% token reduction** across all 8 supported AI coding clients:
1. **Compact Multi-Skill Digest (`use_skills` <= 6,400 Bytes / <= 1,600 Tokens)**:
   - Direct subagent invocations (e.g. `@genin` or `@anbu` loading 5 skills including `i-have-adhd` and `antislop*`) compile a structured, budget-governed digest (`~5,093 bytes` / `1,274 tokens` on Turn 1, and `~2,818 bytes` / `705 tokens` on repeat turns via session deduplication), down from `48,604 bytes` (`~12.1k tokens`) — an **89.5%–94.2% reduction** while keeping every discipline skill active.
2. **Real-Time Idle `@advisor` Budget (`<= 8,192 Tokens` / Turn)**:
   - Consumes **`0` tokens** when workers are idle or compliant (`status: 'IDLE_OK'`), and enforces a **`<= 8,192 tokens` (`32,768 bytes`)** ceiling when emitting an `INTERRUPT_CORRECTION` directive, with Head+Middle+Tail context preservation (`src/context_budget.js`) so intermediate plan rules, TODOs, and goals are never dropped, plus immediate stale telemetry eviction (`evict_stale_results: true`).
3. **Post-Approval Context Compaction**:
   - Approving Gate 1 (`1. Compact and approve`) automatically prunes pre-approval exploratory dumps and compacts `plan.md` before Phase 2 execution begins.

---

## 🧱 Fixed-Prefix Budget: What Konoha Injects on Every Turn

Every supported harness prepends a fixed block before the first user token. Konoha controls three of its terms — the managed contract block, the OMP workflow addendum, and the MCP tool schemas — and a cache hit only survives while those bytes stay identical between turns.

| Term | Deployed size | Rule |
|---|---|---|
| `~/.omp/agent/AGENTS.md` (OMP user context) | ~5.5 KB | exactly one managed block, exactly one contract version |
| OMP workflow addendum (`buildOmpWorkflowAddendum`) | ~4.1 KB | rules only; command dumps and procedure belong to the skill that owns them |
| Lightweight contract (`buildLightweightContract`) | ~1.0 KB per foreign client file | version bump only; the body does not vary by client |
| Tool schemas (`src/mcp_tool_manifest.json`) | 28,986 B / 6,598 tok | an API contract — prose trimming moves ~1.6k of 6.6k tokens, and the remaining ~5.0k is JSON structure; only tool-count reduction moves it materially |

1. **One managed block, one version.** `buildManagedContract` (`src/agent_contract.js`) removes *every* `KONOHA-CONTRACT-START`…`KONOHA-CONTRACT-END` span before writing the fresh block. Splicing only the first pair left any second block in place forever and made redeploy a permanent no-op; a deployed file once carried 2.2.23 and 2.2.12 side by side, so the agent read two versions of the same rules on every turn.
2. **Only one user-level context file is injected.** OMP keeps one user context file and `native` (`~/.omp/agent/AGENTS.md`) wins it, so `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.config/opencode/AGENTS.md`, and `~/.agents/AGENTS.md` are not part of an OMP prompt. Each serves its own harness; never assume the contract is read twice.
3. **`~/.omp/AGENTS.md` is not a context file.** The native user location is `~/.omp/agent/AGENTS.md`. `~/.omp/AGENTS.md` sits in a dot-directory with no provider mapping, so it is never injected — keeping a copy there is a trap for a future release, not a saving.
4. **Duplicated procedure costs twice.** Framework scaffolding commands and scan-scoping procedure were once in both the addendum and `jonin-skill` / `konoha` references. The skill loads on demand; the addendum is paid every turn. Procedure belongs in the skill.
5. **Byte-stability beats brevity.** A block that changes size or order between turns loses the cache for everything after it. Deploying the same contract twice must be byte-identical — `tests/test_lightweight_contracts.js` asserts the second deploy reports `changed: false`.

### Honest Limit: Konoha Cannot Report Its Own Cache Hit Rate

`tool_calls` carries `input_tokens`, `output_tokens`, and `cached_tokens` (`src/db_schema.js`), but nothing on the MCP path writes them: the only usage objects built live in `src/bridge/gateway_adapters.js` and `src/bridge/handlers/anthropic.js`, and they return those counts to the caller instead of persisting them. Every row's token columns are NULL, so any cache-hit figure attributed to Konoha is inference from payload sizes, never measurement. Fix the writer before quoting a number.

---

## 🧮 Dynamic Token Savings Telemetry (`src/tools_savings_logger.js` & `src/mcp/skills_common.js`)

Konoha computes authentic token savings on every MCP tool call, persisting records into `tool_calls` inside `~/.konoha/konoha.db`:

### 1. Skill Discovery & Multi-Skill Retrieval (`find_skill`, `use_skills`, `get_skill`)
- **`use_skills` Baseline Bytes**: Dynamically queries the exact `SUM(byte_size)` of all requested skills from the `skills` table in `konoha.db` (`_getUseSkillsBaselineBytes` in `src/mcp/skills_common.js`).
- **`find_skill` Baseline Bytes**: Dynamically computed from the actual `SUM(byte_size)` of matching skill candidates in SQLite FTS5.
- **Formula**:
  $$\text{Bytes Saved} = \max(0, \text{Baseline Bytes} - \text{Returned Bytes})$$
  $$\text{Tokens Saved} = \left\lfloor \frac{\text{Bytes Saved}}{4} \right\rfloor$$
- **Invariant**: Baseline calculation logic in `src/tools_savings_logger.js` and `src/db_savings.js` must never be fabricated or hardcoded; `konoha savings` always reports real, verifiable telemetry.

### 2. Bounded File Inspection Tools (`read_file_head`, `read_file_range`, `token_efficient_grep`)
- **Baseline Bytes**: Total byte size of the target file on disk (`fs.statSync(file).size`).
- **Returned Bytes**: The bounded line window or matching snippet returned.
- **Savings Ratio**: Consistently > 98% savings on large codebases.

---

## 🔍 Chunk Store vs Append-Only Log: Why Retrieval Beats Injection

The question is not "FTS5 or JSONL" but *inject everything* vs *retrieve chunks on demand*.
Konoha has exactly one retrieval store (`skill_chunks`: FTS5 + embeddings) and JSONL
appears only as an audit trail (`.konoha/guardrail-audit.jsonl`, client `transcript.jsonl`),
with no relevance signal and no bounded read. Chunked retrieval wins on both axes:

| Property | FTS5 chunk store | JSONL append log |
|---|---|---|
| Cost of one answer | `O(top-k)` — ranked, bounded | `O(file)` — every line read and injected |
| Relevance signal | BM25 + cross-encoder + vector | none (append order only) |
| Failure mode | stale row → reindex | unbounded context growth |
| Measured here | 18,464 rows, avg 484 B, all embedded | no retrieval path exists |

**Measured chunk economics** (`src/code_intel/config.js`): `CHUNK_MAX_LINES=40`,
`CHUNK_MAX_CHARS=1800`, `CHUNK_OVERLAP_LINES=8`, `CHUNK_TOKEN_TARGET=420` — 18,464 rows,
avg 484 B, all embedded. `skill_top_k: 5`, `skill_candidate_k: 25`
(`bin/lib/config_defaults.js:61-62`). A `find_skill` answer measures **301–439 tok**
across five probe queries because it returns ranked metadata rows, not chunk text; the
chunk budget is what `use_skills`/`get_skill` spend. One full skill digest is **1,806 tok**,
so retrieval already wins the moment the task needs to consult more than one skill.

**External evidence** (the accuracy half of the question, not just cost):
- *Context Length Alone Hurts LLM Performance Despite Perfect Retrieval* (EMNLP 2025 Findings 1264): accuracy drops **13.9%–85%** as input length grows even with the gold passage present. Long context is a quality hazard, not only a bill.
- *SELF-ROUTE* (EMNLP 2024 Industry 66, Google DeepMind): long context wins on average quality when resourced, but RAG's cost advantage is decisive; the hybrid route matches long-context quality at far lower cost.
- arXiv 2505.21700: **64–128 tok** chunks are optimal for fact-based QA, **512–1024 tok** for broad contextual understanding — Konoha's 420-token target sits between the two regimes, correct for procedure-heavy skills.
- NVIDIA chunking study: page-level chunks give the best mean end-to-end accuracy (**0.648**) and the lowest variance (**0.107**); both extremes (128, 2048 tok) underperform; **15% overlap** is the sweet spot (Konoha: 8/40 lines = 20%).

**Boundary that used to defeat this**: `get_skill(name, {tokenBudget})` with no `section`
sliced to `rawSections[0]` — the frontmatter plus preamble — and returned ~250 tok for a
1,500-token request. A budget now produces a whole-document digest with head/middle/tail
anchors and lists the top-level sections still available. Covered by
`tests/test_skill_budget_digest.js`.

**Known ceiling**: the 27 Cardinal Maintenance Invariants are a single 7.8 KB `##` section,
so `get_skill({section: 'Cardinal Maintenance Invariants'})` (1,964 tok) costs *more* than
the full digest (1,806 tok). The upgrade path is invariant-level chunking (one `###` or
numbered item per chunk, 400–600 tok, 15% overlap) reusing the existing `skill_chunks`
rows rather than adding an index.

---

## ⚡ SQLite FTS5 Benchmark & Query Performance

| Operation | Workload / Ops | Throughput | Latency (p95) | Mechanism |
|---|---|---|---|---|
| **FTS5 Skill Search (`skills`)** | 500 ops | **> 25,000 queries/sec** | **< 0.04 ms** | In-process relational + BM25 ranking |
| **Persona Memory Recall** | 500 ops | **> 28,000 queries/sec** | **< 0.03 ms** | Indexed flow-bounded key-value recall |
| **Tool Call Logging** | 1,000 ops | **> 32,000 writes/sec** | **< 0.03 ms** | SQLite WAL mode (`PRAGMA synchronous = NORMAL`) |
| **Neural Hybrid RAG** | 100 ops | **> 1,200 queries/sec** | **< 0.82 ms** | FTS5 BM25 + Granite ONNX embeddings |

---

## 📊 Verification & Telemetry Commands

- View live session savings: `rtk node bin/cli.js savings`
- Verify compact `use_skills`: `rtk node tests/test_use_skills_compact.js`
- Verify database performance: `rtk node tests/test_db_consolidation.js`
