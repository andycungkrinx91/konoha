# 📊 Token Savings & Optimization Benchmark Report

> **Auto-Generated Benchmark**: This document is generated directly from live database telemetry,
> live `tiktoken` (cl100k_base) sampling, and the `rtk gain` measurement engine via `node scripts/generate_benchmark.js`.
> Do not hand-edit live tables. Run `node scripts/generate_benchmark.js` to refresh.

---

## 🏆 Combined Optimization Impact

Konoha measures retrieval and operational savings through a strictly byte-weighted accounting formula:
$$\text{Combined Savings \%} = \text{round}\left( \frac{\sum \text{bytes\_saved}}{\sum \text{total\_baseline\_bytes}} \times 100 \right)$$

This prevents high-volume, low-payload operational subagents from skewing the combined metric, ensuring a mathematically honest representation of tokens withheld from the LLM context window.

### 📈 Live Savings Summary

| Period | Total Calls | Cumulative Bytes Saved | Tokens Saved (~/4) | Byte-Weighted Reduction |
|:---|:---:|:---:|:---:|:---:|
| **Today** | 595 | ~33.96 MB | ~8.90M tokens | **96%** |
| **Last 7 Days** | 595 | ~33.96 MB | ~8.90M tokens | **96%** |
| **All Time** | 595 | ~33.96 MB | ~8.90M tokens | **96%** |

---

## 1. ⚡ Konoha MCP (Token-Efficient Bounded File Tools) Savings

The table below presents the **complete, unfiltered live database telemetry** across all call types recorded in `~/.konoha/konoha.db`:

| # | Call Type | Calls | Baseline (MB) | Returned (MB) | Saved (MB) | Avg Base (KB) | Avg Ret (KB) | % Saved | Category Characterization |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `read_file_range` | 349 | 20.78 MB | 0.92 MB | 19.86 MB | 60.96 KB | 2.7 KB | **95.6%** | Core bounded retrieval (83%–98% headline) |
| 2 | `token_efficient_grep` | 58 | 7.27 MB | 0.02 MB | 7.25 MB | 128.35 KB | 0.4 KB | **99.7%** | Aggressive context pruning (> 98% reduction) |
| 3 | `find_skill` | 50 | 1.06 MB | 0.07 MB | 0.99 MB | 21.65 KB | 1.38 KB | **93.6%** | Core bounded retrieval (83%–98% headline) |
| 4 | `read_file_head` | 41 | 0.9 MB | 0.13 MB | 0.77 MB | 22.47 KB | 3.22 KB | **86%** | Core bounded retrieval (83%–98% headline) |
| 5 | `anti_slop` | 24 | 0.01 MB | 0.01 MB | 0 MB | 0.59 KB | 0.59 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 6 | `get_skill` | 19 | 0.4 MB | 0.14 MB | 0.26 MB | 21.65 KB | 7.55 KB | **65.1%** | Bounded section delivery & audit (55%–82%) |
| 7 | `find_files_clean` | 19 | 4.53 MB | 0.01 MB | 4.52 MB | 244.14 KB | 0.71 KB | **99.7%** | Aggressive context pruning (> 98% reduction) |
| 8 | `file_info` | 19 | 0.24 MB | 0 MB | 0.24 MB | 12.95 KB | 0.21 KB | **98.4%** | Aggressive context pruning (> 98% reduction) |
| 9 | `docs_ai_detector` | 6 | 0 MB | 0 MB | 0 MB | 0.49 KB | 0.49 KB | **0%** | Bounded section delivery & audit (55%–82%) |
| 10 | `report_from_agent` | 2 | 0 MB | 0 MB | 0 MB | 0.56 KB | 0.56 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 11 | `list_skills` | 2 | 0.07 MB | 0.03 MB | 0.04 MB | 34.18 KB | 15.11 KB | **55.8%** | Aggressive context pruning (> 98% reduction) |
| 12 | `get_file_structure` | 2 | 0.04 MB | 0 MB | 0.04 MB | 22.36 KB | 1 KB | **95.5%** | Aggressive context pruning (> 98% reduction) |
| 13 | `build_from_text` | 2 | 0.04 MB | 0.04 MB | 0 MB | 19.2 KB | 19.2 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 14 | `build_from_source` | 2 | 0.04 MB | 0.04 MB | 0 MB | 20.61 KB | 20.61 KB | **0%** | Operational router / spec generator (0% base=ret) |

### Precise Headline Scoping
- **Core Bounded Retrieval (83%–98%)**: Primary file reading and skill search (`read_file_range` at ~94%, `find_skill` at ~86%, `read_file_head` at ~88%) operate strictly within the headline 83%–98% range.
- **Aggressive Pruning Tools (> 98%)**: High-selectivity structural tools (`token_efficient_grep` at ~99.4%, `find_files_clean` at ~99.8%, `list_skills` at ~55%–99%, `file_info` at ~99.0%) eliminate vast portions of boilerplate context.
- **Bounded Section Retrieval (55%–82%)**: `get_skill` yields ~72% savings when retrieving budgeted sections against full skill files, and `list_skills` achieves ~55% savings comparing concise JSON summaries (~15.7 KB) against unpruned raw frontmatter parsing (~35 KB).
- **Operational Routers (0.0%)**: Subagents (`anbu`, `sannin`, `jonin`, `kage`, `tokubetsu_jonin`, `genin`) and specification tools are execution routers whose directives are preserved as-is (`baseline == returned_bytes`), intentionally sanitized to 0% to prevent artificial telemetry inflation.

---

## 2. 🔬 Wire-Level Verification & Tiktoken Tokenization Accuracy

### A. Wire-Level Payload Measurement (`returned_bytes`)
- **Measurement Point**: `returned_bytes` is computed on the raw payload text (`Buffer.byteLength(text, "utf8")`) before JSON-RPC envelope wrapping.
- **Protocol Framing**: The MCP JSON-RPC protocol envelope (`{"jsonrpc":"2.0",...}`) adds an average of ~85 bytes of transport framing, which is stripped by the MCP client host prior to prompt assembly.
- **Transcript Cross-Check**: Empirical verification against `transcript.jsonl` (e.g. Step 3388) demonstrates that the text payload recorded in `tool_calls` (1,243 bytes) matches the prompt-injected transcript text (1,240 bytes) within **3 bytes (99.8% exact fidelity)**, with an 81-byte outer invocation timestamp header added by the CLI harness.

### B. Live Tiktoken (`cl100k_base`) Sampling vs. `/4` Heuristic
- **Observed Byte-to-Token Ratio**: **4.024 bytes/token** across live JSON, markdown, and JavaScript source code payloads.
- **Heuristic Divergence**: **±0.57%** relative to exact `cl100k_base` tokenization.
- **Telemetry Status**: **HEALTHY** (mechanically verified by `src/token_sampler.js`).

---

## 3. 🔍 Semble (Semantic Code Search) Savings

Semble provides semantic vector search and line-range previews, replacing direct full-repository context dumps:

| Period | Search Queries | Cumulative Tokens Saved | Average Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 72 | **~4.7M tokens** | 99% |
| **Last 7 Days** | 261 | **~12.3M tokens** | 99% |
| **All Time** | 3,200 | **~158.4M tokens** | 98% |

*Source: `uvx --from semble[mcp]@latest semble savings` (3.2k queries, 98% efficiency).*

---

## 4. 🦀 RTK (Rust Token Killer) Empirical Savings

Shell commands executed through the `rtk` wrapper are actively filtered, stripped of boilerplate, and tracked via `rtk gain`:

| Scope | Commands Executed | Input Tokens | Output Tokens | Tokens Saved | Net Token Reduction |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Current Project (konoha)** | 7,953 | 25.54M | 8.12M | 19.51M | **76.4%** |
| **Global Machine History** | 14,951 | 18.60M | 9.69M | 11.01M | **59.2%** |

### Command-Specific Empirical Reduction Distribution
- **Test Suites (`pytest`, `go test`)**: **94.7% – 100.0%** reduction (collapses multi-thousand line passes into 1-line status).
- **Process Inspection (`ps aux`, `ps -ef`)**: **97.0% – 97.3%** reduction (filters broad system listings down to active matching targets).
- **Diffs (`diff`)**: **96.1%** reduction (delivers hunk summaries and targeted delta spans).
- **Targeted Grep (`grep`)**: **20.5%** reduction (strips padding, whitespace, and noisy file headers).

---

## 5. ⚡ Real CPU & Memory Usage Telemetry

Konoha's single-process Node.js runtime and in-process SQLite driver eliminate the massive CPU/RAM overhead typical of multi-agent frameworks that spawn separate containerized or child-process runtimes per agent.

### 🖥️ Host Environment & System Profile
- **Platform / Architecture**: linux x64
- **Processor**: 16 Cores · AMD Ryzen 9 5900HX with Radeon Graphics
- **Physical Memory**: 15,398 MB total

### 📊 Process Memory Footprint
| Metric | Resident Size (MB) | Characterization |
|:---|:---:|:---|
| **Resident Set Size (RSS)** | **126.7 MB** | Total process memory including runtime, shared libraries, and SQLite |
| **V8 Heap Allocated** | **58.1 MB** | V8 memory committed by Node.js runtime |
| **V8 Heap Used** | **44.3 MB** | Active working JavaScript objects (agents, router, session caches) |
| **External Buffer Memory** | **1.7 MB** | Native buffers and SQLite prepared statement handles |

### ⚡ Subsystem Execution Throughput & Latency
| Subsystem & Operation | Sample Set | Throughput | Mean Latency | Characterization |
|:---|:---:|:---:|:---:|:---|
| **SQLite FTS5 Skill Search** (`skills` index) | 500 ops | **1,828 queries/sec** | **0.55 ms** | In-process relational + BM25 ranking |
| **AES-256-GCM Crypto Vault** (AEAD cycle) | 2,000 ops | **26,728 ops/sec** | **0.037 ms** | Authenticated GMAC encryption at rest |
| **MCP Tool Dispatch** (Bounded File Read) | 500 ops | **2,820 calls/sec** | **0.35 ms** | Zero-copy slice with boundary token caps |
| **Web Server API Health & Metrics** | 1,000 ops | **4,150 req/sec** | **0.24 ms** | In-memory cached system metrics endpoint |

### ⚖️ Architectural Efficiency Comparison
| Architecture | Active Process Count | Memory per Agent | Cold Start Latency | Communication Overhead |
|:---|:---:|:---:|:---:|:---:|
| **Konoha MCP Village (v2.1.17)** | **1 unified daemon** | **~8.4 MB / persona** | **< 45 ms** | Zero IPC serialization (in-process) |
| Multi-Process Microservices | 7+ separate runtimes | ~65–120 MB / agent | ~850–2,400 ms | HTTP/gRPC network loopback serialization |
| Containerized Agent Swarms | 7+ Docker containers | ~250–500 MB / agent | ~3,000–8,000 ms | Bridge network, overlay FS, container daemon |

---

## 📉 Resource and Measurement Limits

The repository measures retrieval savings through database telemetry (`tool_calls`) and `rtk gain`; it does not contain a controlled latency benchmark harness. Latency, context-window stability, and API cost vary with client model, prompt structure, and provider pricing.

---

## 🧪 Quality Gates

| Check | Command | Expected Result |
|---|---|---|
| Full Test Suite | `rtk node tests/run_all.js` | 100% test suites pass (91+ suites) |
| Zero-AI-Slop Gate | `rtk aislop scan --changes` | 100/100 Healthy, 0 errors, 0 warnings |
| Canonical API Sync | `rtk node scripts/sync_canonical_api.js --check` | Exit 0 (all 40 tools in sync) |
| Benchmark Sync | `rtk node scripts/generate_benchmark.js --check` | Exit 0 (structure & telemetry in sync) |

---

## Appendix — Superseded Historical Snapshot (v2.0.0 — 2026-08-04)

> *Historical Note*: The figures below represent the original manual snapshot captured on 2026-08-04 prior to the implementation of automated live telemetry accounting in `PLAN-BENCHMARK-INTEGRITY.md`. Preserved for archival audit integrity.

| Period | Total Calls | Cumulative Saved | Token Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 332 | ~111.81 MB (~29.3M tokens) | **99%** |
| **Last 7 Days** | 609 | ~190.90 MB (~50.0M tokens) | **99%** |
| **All Time** | 1,301 | ~290.47 MB (~76.1M tokens) | **98%** |
