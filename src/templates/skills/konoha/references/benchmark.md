# 🍃 Konoha Token Economy & Benchmark Standards (v2.2.20)

Technical reference on Konoha's token economy, compact multi-skill digests (`use_skills`), Real-Time Idle `@advisor` budget (`<= 1,000 tokens/turn`), dynamic baseline savings calculations, SQLite FTS5 benchmark metrics, and KV-cache prefix optimization.

---

## 📉 Context Token Economy & Savings Architecture (`v2.2.20`)

Konoha delivers an authentic **83%–98% token reduction** across all 8 supported AI coding clients:
1. **Compact Multi-Skill Digest (`use_skills` <= 6,400 Bytes / <= 1,600 Tokens)**:
   - Direct subagent invocations (e.g. `@genin` or `@anbu` loading 5 skills including `i-have-adhd` and `antislop*`) compile a structured, budget-governed digest (`~5,093 bytes` / `1,274 tokens` on Turn 1, and `~2,818 bytes` / `705 tokens` on repeat turns via session deduplication), down from `48,604 bytes` (`~12.1k tokens`) — an **89.5%–94.2% reduction** while keeping every discipline skill active.
2. **Real-Time Idle `@advisor` Budget (`<= 1,000 Tokens` / Turn)**:
   - Consumes **`0` tokens** when workers are idle or compliant (`status: 'IDLE_OK'`), and enforces a strict **`<= 1,000 tokens` (`4,000 bytes`)** ceiling when emitting an `INTERRUPT_CORRECTION` directive, with immediate stale telemetry eviction (`evict_stale_results: true`).
3. **Post-Approval Context Compaction**:
   - Approving Gate 1 (`1. Compact and approve`) automatically prunes pre-approval exploratory dumps and compacts `plan.md` before Phase 2 execution begins.

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
