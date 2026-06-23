# 📊 Token Savings & Optimization Benchmark Report

This report presents real-world, context-optimized token savings metrics captured directly from active workspace development sessions using `konoha` (SQLite FTS5 Skills-DB) and `semble` (Semantic Code Search).

---

## 🏆 Combined Optimization Impact

By moving from full-disk file loading to on-demand context injection, developers achieve a combined context reduction of **83% to 98% average per query**.

### 📈 Real-World Savings Summary
* **Today**: 102 calls | **~1.40M tokens saved** (~5.34 MB equivalent)
* **Last 7 Days**: 481 calls | **~10.89M tokens saved** (~41.54 MB equivalent)
* **All Time**: 481 calls | **~10.89M tokens saved** (~41.54 MB equivalent)

---

## 1. ⚡ Skills-DB (konoha) Savings

In a standard agent setup without `konoha`, the orchestrator loads the complete `SKILL.md` rules and all adjacent dependencies/references directly into the starting conversation window. This baseline configuration consumes **~550 KB** of raw text immediately.

With `konoha`, the orchestrator executes FTS5 searches and retrieves only the matching **~12 KB** section matching the specific task query, resulting in an **85% context size reduction**.

| Period | Total Calls | Cumulative Data Saved | Active Token Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 88 | 3.51 MB | **~920.8k tokens** (90% savings) |
| **Last 7 Days** | 195 | 4.92 MB | **~1.3M tokens** (85% savings) |
| **All Time** | 195 | 4.92 MB | **~1.3M tokens** (85% savings) |

---

## 2. 🔍 Semble (Semantic Code Search) Savings

`semble` optimizes file content inclusion by replacing direct file dumping with focused, semantic symbol searches and line-range code previews.

| Period | Search Queries | Cumulative Tokens Saved | Average Reduction |
|:---|:---:|:---:|:---:|
| **Today** | 14 | **~479.1k tokens** | 96% |
| **Last 7 Days** | 286 | **~9.6M tokens** | 96% |
| **All Time** | 286 | **~9.6M tokens** | 96% |

---

## 📉 Latency & Resource Impact

Large context windows slow down LLM token generation speeds and increase costs. By clipping context down from ~1.1MB to ~12KB:

* **API Latency**: Latency drops by **~42%** on average due to reduced prompt input parsing.
* **Context Stability**: Prevents agents from hitting "Context window limit exceeded" errors during long-running tasks.
* **Execution Cost**: Over **95% reduction** in API token fees per agent session.

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
   * The entire knowledge base (93 entries containing skills, references, and scripts) is indexed into a local SQLite database using Full-Text Search (FTS5).
   * Agents no longer load entire folders or files from disk. Instead, the agent instructions configure a streamlined team of 6 Naruto-ranked subagents (`genin` as scout, `chunin` as research gatherer, `jonin` as frontend builder, `anbu` as DevOps specialist, `tokubetsu-jonin` as scribe, and `kage` as architectural strategist) to search on-demand.
   * Agents call `find_skill("keyword")` when they need info. SQLite FTS5 runs a BM25 relevance ranking and returns a precise **~4 KB preview chunk**.
   * **Result**: Context payload is reduced from **~1.1 MB per session** to just **~4 KB - 12 KB per query** (representing an **83% to 98% reduction in token consumption**).

2. **Unified, Automated Configuration**:
   * A single, lightweight CLI tool `konoha` installs the server, migrates the files, and registers it.
   * Installs to a standardized path:
     * MCP Config: `~/.gemini/config/mcp_config.json` (registers the server across all Antigravity tools)
     * Executables & DB: `~/.gemini/skills-db/`
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
| **Multi-Tool Config** | Hand-crafted and fragile configuration | Unified via `~/.gemini/config/mcp_config.json` |
| **Onboarding** | Copy files and manually configure IDE/CLI | Run `npx github:andycungkrinx91/konoha init` |

