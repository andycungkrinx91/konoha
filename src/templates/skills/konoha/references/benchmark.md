# 🍃 Konoha Token Economy & Benchmark Standards (v2.2.17)

Technical reference on Konoha's token economy, dynamic baseline savings calculations, SQLite FTS5 benchmark metrics, and KV-cache prefix optimization.

---

## 📉 Context Token Economy & Savings Architecture

Konoha delivers an authentic **83%–98% token reduction** across all 8 supported AI coding clients. Instead of dumping full instruction files (e.g. 100 KB+ of raw markdown) into agent prompts at turn start, Konoha serves lightweight pointer contracts (< 1.2 KB) and loads bounded domain references on-demand via SQLite FTS5 RAG.

---

## 🧮 Dynamic Token Savings Telemetry (`src/tools_savings_logger.js`)

Konoha computes authentic token savings on every MCP tool call, persisting records into `tool_calls` inside `~/.konoha/konoha.db`:

### 1. Skill Discovery Tools (`find_skill`, `find_skills`, `list_skills`)
- **Baseline Bytes**: Dynamically computed from the actual `SUM(byte_size)` of all matching skill candidates in the SQLite database before ranking.
- **Returned Bytes**: The compact JSON summary returned to the LLM.
- **Formula**:
  $$\text{Bytes Saved} = \max(0, \text{Baseline Bytes} - \text{Returned Bytes})$$
  $$\text{Tokens Saved} = \left\lfloor \frac{\text{Bytes Saved}}{4} \right\rfloor$$
- **Invariant**: Baseline calculation logic must never be hardcoded or fabricated; it must reflect true candidate volume in SQLite.

### 2. On-Demand Skill Retrieval (`get_skill`)
- **Baseline Bytes**: The byte size of the complete unbudgeted skill or full documentation document.
- **Returned Bytes**: The sliced, bounded section or token-budgeted payload delivered to the client.
- **Savings Ratio**: Typically 55%–82% savings compared to whole-document ingestion.

### 3. Bounded File Inspection Tools (`read_file_head`, `read_file_range`, `token_efficient_grep`)
- **Baseline Bytes**: Total byte size of the target file on disk (`fs.statSync(file).size`).
- **Returned Bytes**: The bounded line window or matching snippet returned.
- **Savings Ratio**: Consistently > 98% savings on large codebases.

---

## ⚡ SQLite FTS5 Benchmark & Query Performance

Benchmarked via `rtk node scripts/generate_benchmark.js` on high-concurrency workloads:

| Operation | Workload / Ops | Throughput | Latency (p95) | Mechanism |
|---|---|---|---|---|
| **FTS5 Skill Search (`skills`)** | 500 ops | **> 25,000 queries/sec** | **< 0.04 ms** | In-process relational + BM25 ranking |
| **Persona Memory Recall** | 500 ops | **> 28,000 queries/sec** | **< 0.03 ms** | Indexed flow-bounded key-value recall |
| **Tool Call Logging** | 1,000 ops | **> 32,000 writes/sec** | **< 0.03 ms** | SQLite WAL mode (`PRAGMA synchronous = NORMAL`) |
| **Neural Hybrid RAG** | 100 ops | **> 1,200 queries/sec** | **< 0.82 ms** | FTS5 BM25 + Granite ONNX embeddings |

---

## 🧠 KV-Cache Prefix Optimization

To maximize frontier LLM prompt caching (Anthropic prompt caching, Google Gemini context caching, OpenAI prompt caching):
1. **Deterministic Prefix Order ($T_1 == T_2 == T_3$)**:
   - System prompt instructions, tool definitions, and contracts are generated deterministically in alphabetical order.
   - Per-turn session metadata and dynamic variables are appended at the *end* of the prompt, ensuring the static prefix remains identical across all conversational turns.
2. **Canonical Tool Sorting**: MCP tools are sorted deterministically before JSON serialization to eliminate random key order cache invalidations.
3. **Achieved Cache Hit Rate**: > 90% prompt cache hit rate on sustained sessions.

---

## 📊 Verification & Telemetry Commands

- View live session savings: `rtk node bin/cli.js savings`
- Re-run benchmark suites: `rtk node scripts/generate_benchmark.js`
- Verify database performance: `rtk node tests/test_db_consolidation.js`
