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
| **Today** | 368 | ~62.62 MB | ~16.42M tokens | **99%** |
| **Last 7 Days** | 2,562 | ~196.41 MB | ~51.49M tokens | **97%** |
| **All Time** | 3,176 | ~235.02 MB | ~61.61M tokens | **97%** |

---

## 1. ⚡ Konoha MCP (Token-Efficient Bounded File Tools) Savings

The table below presents the **complete, unfiltered live database telemetry** across all call types recorded in `~/.konoha/konoha.db`:

| # | Call Type | Calls | Baseline (MB) | Returned (MB) | Saved (MB) | Avg Base (KB) | Avg Ret (KB) | % Saved | Category Characterization |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `read_file_range` | 1873 | 145.22 MB | 4.47 MB | 140.77 MB | 79.39 KB | 2.44 KB | **96.9%** | Core bounded retrieval (83%–98% headline) |
| 2 | `token_efficient_grep` | 564 | 61.81 MB | 0.3 MB | 61.51 MB | 112.22 KB | 0.55 KB | **99.5%** | Aggressive context pruning (> 98% reduction) |
| 3 | `find_skill` | 296 | 4.63 MB | 0.55 MB | 4.09 MB | 16.03 KB | 1.89 KB | **88.2%** | Core bounded retrieval (83%–98% headline) |
| 4 | `read_file_head` | 107 | 1.69 MB | 0.24 MB | 1.46 MB | 16.19 KB | 2.32 KB | **86%** | Core bounded retrieval (83%–98% headline) |
| 5 | `find_files_clean` | 99 | 23.6 MB | 0.08 MB | 23.52 MB | 244.14 KB | 0.82 KB | **99.7%** | Aggressive context pruning (> 98% reduction) |
| 6 | `file_info` | 76 | 1.72 MB | 0.01 MB | 1.7 MB | 23.13 KB | 0.2 KB | **99.2%** | Aggressive context pruning (> 98% reduction) |
| 7 | `docs_ai_detector` | 62 | 0.16 MB | 0.04 MB | 0.12 MB | 2.66 KB | 0.61 KB | **77.1%** | Bounded section delivery & audit (55%–82%) |
| 8 | `get_skill` | 32 | 1.17 MB | 0.32 MB | 0.85 MB | 37.41 KB | 10.08 KB | **73.1%** | Bounded section delivery & audit (55%–82%) |
| 9 | `get_file_structure` | 22 | 0.91 MB | 0.01 MB | 0.9 MB | 42.13 KB | 0.43 KB | **99%** | Aggressive context pruning (> 98% reduction) |
| 10 | `anbu` | 13 | 0.1 MB | 0.1 MB | 0 MB | 7.51 KB | 7.51 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 11 | `sannin` | 11 | 0.02 MB | 0.02 MB | 0 MB | 1.46 KB | 1.46 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 12 | `list_skills` | 6 | 0.2 MB | 0.09 MB | 0.11 MB | 34.18 KB | 15.53 KB | **54.6%** | Aggressive context pruning (> 98% reduction) |
| 13 | `jonin` | 4 | 0.04 MB | 0.04 MB | 0 MB | 8.99 KB | 8.99 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 14 | `tokubetsu_jonin` | 3 | 0.02 MB | 0.02 MB | 0 MB | 7.54 KB | 7.54 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 15 | `get_resolved_task_dir` | 3 | 0 MB | 0 MB | 0 MB | 0.15 KB | 0.15 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 16 | `kage` | 2 | 0.02 MB | 0.02 MB | 0 MB | 7.82 KB | 7.82 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 17 | `build_from_text` | 2 | 0.04 MB | 0.04 MB | 0 MB | 19.09 KB | 19.09 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 18 | `build_from_source` | 2 | 0.04 MB | 0.04 MB | 0 MB | 20.5 KB | 20.5 KB | **0%** | Operational router / spec generator (0% base=ret) |
| 19 | `genin` | 1 | 0.01 MB | 0.01 MB | 0 MB | 6.97 KB | 6.97 KB | **0%** | Operational router / spec generator (0% base=ret) |

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
- **Observed Byte-to-Token Ratio**: **4.001 bytes/token** across live JSON, markdown, and JavaScript source code payloads.
- **Heuristic Divergence**: **±0%** relative to exact `cl100k_base` tokenization.
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
| **Current Project (konoha)** | 5,107 | 13.44M | 6.16M | 9.38M | **69.8%** |
| **Global Machine History** | 14,951 | 18.60M | 9.69M | 11.01M | **59.2%** |

### Command-Specific Empirical Reduction Distribution
- **Test Suites (`pytest`, `go test`)**: **94.7% – 100.0%** reduction (collapses multi-thousand line passes into 1-line status).
- **Process Inspection (`ps aux`, `ps -ef`)**: **97.0% – 97.3%** reduction (filters broad system listings down to active matching targets).
- **Diffs (`diff`)**: **96.1%** reduction (delivers hunk summaries and targeted delta spans).
- **Targeted Grep (`grep`)**: **20.5%** reduction (strips padding, whitespace, and noisy file headers).

---

## 📉 Resource and Measurement Limits

The repository measures retrieval savings through database telemetry (`tool_calls`) and `rtk gain`; it does not contain a controlled latency benchmark harness. Latency, context-window stability, and API cost vary with client model, prompt structure, and provider pricing.

---

## 🧪 Quality Gates

| Check | Command | Expected Result |
|---|---|---|
| Full Test Suite | `rtk node tests/run_all.js` | 100% test suites pass (91+ suites) |
| Zero-AI-Slop Gate | `rtk aislop scan --changes` | 100/100 Healthy, 0 errors, 0 warnings |
| Canonical API Sync | `rtk node scripts/sync_canonical_api.js --check` | Exit 0 (all 35 tools in sync) |
| Benchmark Sync | `rtk node scripts/generate_benchmark.js --check` | Exit 0 (structure & telemetry in sync) |

---

## Appendix — Superseded Historical Snapshot (v2.0.0 — 2026-08-04)

> *Historical Note*: The figures below represent the original manual snapshot captured on 2026-08-04 prior to the implementation of automated live telemetry accounting in `PLAN-BENCHMARK-INTEGRITY.md`. Preserved for archival audit integrity.

| Period | Total Calls | Cumulative Saved | Token Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 332 | ~111.81 MB (~29.3M tokens) | **99%** |
| **Last 7 Days** | 609 | ~190.90 MB (~50.0M tokens) | **99%** |
| **All Time** | 1,301 | ~290.47 MB (~76.1M tokens) | **98%** |
