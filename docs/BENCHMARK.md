# 📊 Token Savings & Optimization Benchmark Report

This report documents a **historical workspace snapshot** from `konoha savings` (captured **2026-08-04** for the v2.0.0 release). Metrics combine **konoha** and **semble** usage; they are not universal performance guarantees.

> Reproduce locally: `konoha savings` (requires `konoha init` and active MCP usage history).

---

## 🏆 Combined Optimization Impact

The historical workspace snapshot below reports combined retrieval reductions of **83% to 98% per query** under that workspace’s recorded Konoha and Semble usage. It is not a universal benchmark.

### 📈 Historical Savings Snapshot (v2.0.0 — 2026-08-04)

| Period | Total Calls | Cumulative Saved | Token Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 332 | ~111.81 MB (~29.3M tokens) | **99%** |
| **Last 7 Days** | 609 | ~190.90 MB (~50.0M tokens) | **99%** |
| **All Time** | 1,301 | ~290.47 MB (~76.1M tokens) | **98%** |

---

## 1. ⚡ Skills-DB (konoha) Savings

Without `konoha`, orchestrators load full `SKILL.md` trees (~550 KB baseline) at session start. With FTS5 on-demand retrieval, each query returns ~1-2 KB relevant chunks (`find_skill`), avoiding loading the full 550 KB skill catalog into context.

- **Formula**: `Tokens Saved = (Library Baseline - Returned Query Chunks) / 4` (evaluated per interaction turn on skill discovery).
- **Full Skill Load (`get_skill`)**: Once a specific skill is requested, the full skill is returned (`Tokens Saved = 0`).

---

## 2. 🔍 Semble (Semantic Code Search) Savings

`semble` replaces direct file dumps with focused semantic search and line-range previews.

| Period | Search Queries | Cumulative Tokens Saved | Average Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 255 | **~11.7M tokens** | 99% |
| **Last 7 Days** | 408 | **~17.3M tokens** | 99% |
| **All Time** | 1,100 | **~43.4M tokens** | 97% |

*Source: `uvx --from semble[mcp]@latest semble savings`*

---

## 3. ⚙️ konoha MCP (Token-Efficient File Tools) Savings

The `konoha` MCP server complements semble with hard-capped, bounded file operations:

| Tool | Cap | Baseline Applied | Exact Token Savings Formula |
|------|-----|------------------|-----------------------------|
| `read_file_head` | ≤200 lines | Actual target file size | `max(0, Target File Size - Returned Window) / 4` |
| `read_file_range` | ≤500 lines | Actual target file size | `max(0, Target File Size - Returned Window) / 4` |
| `file_info` | Metadata only | Actual target file size | `max(0, Target File Size - Metadata JSON) / 4` |
| `token_efficient_grep` | ≤20 matches (max 50) | Target file size | `max(0, Target File Size - Matched Lines) / 4` |
| `get_file_structure` | Signatures only | Target file size | `max(0, Target File Size - Outline Size) / 4` |
| `find_files_clean` | Filtered tree | Directory tree | Skips `node_modules`, `.git`, build artifacts |

**Verification & Accuracy**: Every bounded file tool computes savings against the *actual target file's size on disk*, ensuring 100% mathematically truthful metrics with zero artificial multipliers.

---

## 4. 🦀 RTK (Rust Token Killer) Savings

If `rtk` is installed on PATH, agents prefix all shell commands with `rtk` to reduce token consumption from noisy command output:

| Tool | Typical Output | RTK Reduction |
|------|---------------|---------------|
| `rtk git status` | verbose git log | ~70-90% token reduction |
| `rtk ls src/` | full directory listing | ~80-90% token reduction |
| `rtk grep "pattern" src/` | full file dumps | ~85-95% token reduction |
| `rtk docker ps` | wide table output | ~75-90% token reduction |

RTK rules are auto-deployed to every detected supported client (`~/.gemini/antigravity-cli/rules/rtk.md`, `~/.gemini/antigravity-ide/rules/rtk.md`, `~/.cursor/rules/rtk.mdc`, `~/.claude/rules/rtk.md`, `~/.config/opencode/rules/rtk.md`, and `~/.commandcode/rules/rtk.md`) when `rtk` is installed. OpenCode receives a rule file only; it has no supported RTK hook. If `rtk` is unavailable, Konoha warns and leaves the client configuration usable.

---

## 📉 Resource and measurement limits

The repository measures Konoha and Semble retrieval savings through `konoha savings`; it does not contain a controlled latency or provider-cost benchmark harness. Latency, context-window stability, and API cost vary with the client, model, network, prompt, and provider pricing. Do not interpret the historical token/byte snapshot above as a guaranteed percentage for another environment.

---

## 🧪 Release QA Gates (v2.0.0)

Before public release, verify:

| Check | Command | Expected |
|-------|---------|----------|
| MCP integration | `konoha test` | All tests pass |
| Antigravity attribution | `python3 tests/test_agent_attribution.py` | 7/7 PASS |
| Cursor attribution | `python3 tests/test_cursor_attribution.py` | 8/8 PASS |
| Environment health | `konoha doctor --yes` | All checks passed |
| Claude Code MCP (if CLI installed) | `konoha status` | `~/.claude.json` → konoha, semble |
| Cross-client contract | `node tests/test_cross_client_contract.js` | all supported clients and official agents pass |
| Cursor skill source | `node tests/test_no_filesystem_mirrors.js` | no Konoha-managed `.cursor/skills/` mirror |
| Skills indexed | `konoha status` | report the installed count; do not assume a fixed total |

---

## 🔍 Detailed Before vs After Comparison

### Before Implementation (The Problem)

1. **Extreme Token Consumption (Super-Bloated Baseline)**:
   * Every time a session starts in Antigravity IDE or CLI, the agent receives instructions to load the full skill files (e.g., `SKILL.md` for `anbu-skill`, `jonin-skill`, `chunin-skill`, `kage-skill`, etc.).
   * This loads **~72 KB** of router instructions.
   * When the agent needs to find a specific rule or practice, it traverses the router and loads the corresponding reference files and script guides. In a complete setup, this includes **~88 reference files** (~478 KB) and **~23 auxiliary scripts** (~547 KB).
   * This results in a massive **~1.1 MB payload** (over **800,000 tokens**) being pulled directly into the conversation history at startup or during early prompts.
   * **Consequences**: Fast context bloating, skyrocketing API usage costs, high response latency, and frequent "context window limit exceeded" errors.

2. **Configuration Fragmentation**:
   * Antigravity IDE (GUI) and Antigravity CLI (`agy`) use different file paths and environment variables.
   * Replicating skill paths and configuration values across team members' environments (or another developer's fresh machine) requires manual copying, editing config files like `mcp_config.json`, and correcting paths.

3. **Complex Router Overhead**:
   * The agent has to manually parse a router markdown table, map the query to a reference file, and then call a file read tool. This takes multiple tool-call roundtrips.

---

### After Implementation (The Solution)

1. **High-Performance SQLite FTS5 Engine**:
   * The entire knowledge base (skills, references, and scripts) is indexed into a local SQLite database using Full-Text Search (FTS5).
   * Agents no longer load entire folders or files from disk. Instead, the agent instructions configure a streamlined team of 6 Naruto-ranked subagents (`genin` as scout, `chunin` as research gatherer, `jonin` as frontend builder, `anbu` as DevOps specialist, `tokubetsu-jonin` as scribe, and `kage` as architectural strategist) to search on-demand.
   * Agents call `find_skill("keyword")` when they need info. SQLite FTS5 runs a BM25 relevance ranking and returns a precise **~4 KB preview chunk**.
   * **Result**: Context payload is reduced from **~1.1 MB per session** to just **~4 KB - 12 KB per query** (representing an **83% to 98% reduction in token consumption**).

2. **Cross-Platform Support**:
   * Works on Linux, macOS, and Windows (native and WSL).
   * Auto-detects Python (`python3` on Linux/macOS, `python` on Windows), Node.js paths, and config directories.
   * nvm compatible — works with any Node.js version (v18+).

2. **Unified, Automated Configuration**:
   * A single, lightweight CLI tool `konoha` installs the server, migrates the files, and registers it.
   * Installs to a standardized path:
     * MCP Config: `~/.gemini/config/mcp_config.json` (registers the server across all Antigravity tools)
     * Executables & DB: `~/.konoha/`
     * Global Prompt Instructions: `~/.gemini/GEMINI.md`
   * Fully cross-platform: auto-detects paths and Python configurations on Windows, macOS, and Linux.

3. **Instantaneous On-Demand Retrieval**:
   * Finding reference documentation is a single-step MCP tool call:
     * **Before**: Load `SKILL.md` (1 roundtrip) -> Parse router (1 roundtrip) -> Read reference file (1 roundtrip).
     * **After**: Call `find_skill("search terms")` (1 roundtrip) -> Done.

#### 📊 Summary Table

| Aspect | Before Implementation | After Implementation |
|:---|:---|:---|
| **Data Retrieval** | Scans and loads raw markdown files directly | Calls `find_skill("keyword")` to search database |
| **Startup Context Payload** | **~1.1 MB** (all `SKILL.md` files & references) | **~0 KB** (lazy loaded on demand) |
| **Single-Query Payload** | Large chunks or entire files (50KB+) | Small, precise matches (4KB chunks) |
| **Token Savings** | 0% (Baseline) | **83% - 98% reduction** |
| **Cost & Context Bloat** | High context footprint, high API bills | Minimal footprint, highly cost-effective |
| **Multi-Tool Config** | Hand-crafted and fragile configuration | Unified via `konoha init` + per-client MCP JSON |
| **Onboarding** | Copy files and manually configure IDE/CLI | Run `pnpm dlx github:andycungkrinx91/konoha init` (cross-platform) |
