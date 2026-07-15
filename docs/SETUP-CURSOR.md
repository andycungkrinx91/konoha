# Cursor IDE & Cursor CLI Setup Guide

Konoha **v1.1.6+** supports **Cursor IDE** and **Cursor CLI** alongside Antigravity. The same `konoha` + `semble` MCP stack and six ninja subagents work in both environments.

## Prerequisites

- **Cursor IDE** or **Cursor CLI** installed
- **Python 3** ≥ 3.8
- **Node.js** ≥ 18
- Agent skills in `~/.agents/skills/` (with `SKILL.md` files) — Konoha mirrors these to `~/.cursor/skills/` for Cursor

## Step 1: Install Konoha (Auto-Setup)

Running any `konoha` command triggers `ensureAutoSetup()`, which self-heals MCP and subagent configuration for all detected clients (Antigravity, Cursor, Claude Code, OpenCode) without prompting.

For a full install:

```bash
npx github:andycungkrinx91/konoha init
```

Konoha will auto-configure Cursor if it is detected (`~/.cursor/` or `cursor` binary on PATH) and skip silently otherwise. The following paths are deployed:

| Path | Purpose |
|------|---------|
| `~/.cursor/mcp.json` | **Backed up** to `mcp.json.back` (first install only), then **replaced** with `konoha` + `semble` only |
| `~/.cursor/skills/` | Agent skills mirrored from `~/.agents/skills/` (same layout as Antigravity) |
| `~/.cursor/hooks.json` | `sessionStart` → `cursor_bootstrap.js` (fail-open) |
| `~/.cursor/cli-config.json` | MCP allowlist for Cursor CLI |
| `.cursor/mcp.json` (project) | Project-scoped MCP config |
| `.cursor/rules/konoha.mdc` | Orchestrator delegation rules |
| `.cursor/skills/` (project) | Project-scoped skills (mirrored from `.agents/skills/` or `~/.agents/skills/`) |

> [!NOTE]
> Your original `~/.cursor/mcp.json` is preserved in `~/.cursor/mcp.json.back`. To restore:
> `cp ~/.cursor/mcp.json.back ~/.cursor/mcp.json`

## Step 2: Verify Installation

```bash
konoha doctor --yes
konoha test
konoha status
```

Confirm the **Cursor IDE/CLI Integrations** section shows **ACTIVE** for MCP, subagents (6/6), hooks, CLI permissions, and **Cursor skills** (mirrored from `~/.agents/skills/`).

## Step 3: Restart Cursor

Close and reopen Cursor (or start a new agent session) so MCP servers reload.

## How Cursor Orchestration Works

1. **Orchestrator** (main agent) reads `.cursor/rules/konoha.mdc`.
2. **Skills first**: Call `konoha.find_skill`.
3. **Code context**: Call `semble.search` / `semble.find_related` for project code — **not** Cursor `Grep`, `Glob`, or `SemanticSearch`.
4. **Delegate** via the **MCP tools** served by `konoha` (e.g., `mcp_jonin`, `mcp_anbu`, etc.) passing the `task_dir` parameter. Direct agent delegation structures are not used.
5. **Skills on disk**: Konoha mirrors `~/.agents/skills/` → `~/.cursor/skills/` (and project `.cursor/skills/` on `konoha init`). Agents still load skill **content** via `konoha` MCP — do not read `SKILL.md` files directly into context.

### Default search / grep / find → semble

When Konoha is installed, **semble MCP is the default** for all codebase discovery on Cursor and Antigravity:

| Avoid | Use instead |
|-------|-------------|
| Cursor `Grep`, `Glob`, `SemanticSearch` | `semble.search` / `semble.find_related` |
| Shell `grep`, `rg`, `find` | `semble.search` with `repo` = absolute project path |
| Antigravity built-in grep/glob | `semble` MCP |

`konoha` remains for skill lookup and file reads — never use it (or semble) for the wrong purpose. If semble MCP is down after retry, `rg` is allowed once as a documented fallback.

### Token-efficient file reads (`konoha`)

After semble locates targets, use **konoha** MCP for precise, capped file operations:

| Tool | Use when |
|------|----------|
| `read_file_head` | Read ≤200 lines from file start (default 80) |
| `read_file_range` | Read ≤500 lines with line numbers |
| `file_info` | File size + line count without loading content |
| `token_efficient_grep` | Regex search capped at 20 matches |
| `get_file_structure` | Class/function signatures without bodies |
| `find_files_clean` | Glob file list (skips `node_modules`, `.git`, lockfiles) |

### Subagent models (Cursor Free)

All official subagents default to **`model: inherit`** (Cursor Auto session model). No manual model selection is required on free-tier Cursor accounts.

## Agent Call Statistics (`konoha agent status`)

When MCP tools omit the `agent` parameter, `detect_active_agent()` resolves identity from:

- **Cursor**: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl` — `Task` `subagent_type`, subagent `[Agent] active` text logs, or `[Konoha] orchestrator active`.
- **Antigravity**: `~/.gemini/antigravity-ide/brain` and `antigravity-cli/brain` — delegated `prompt.md` and recent `PLANNER_RESPONSE` transcripts. If `ANTIGRAVITY_CONVERSATION_ID` is set, scans are strictly isolated to the active session folder (Cursor projects are excluded) to prevent cross-session telemetry pollution.

Recent Cursor sessions are preferred over stale Antigravity brain folders so counters stay accurate in multi-client setups.

### Verification scripts

```bash
python3 src/test_cursor_attribution.py   # Cursor one-by-one attribution
python3 src/test_agent_attribution.py    # Antigravity one-by-one attribution
python3 src/test_claude_attribution.py   # Claude Code one-by-one attribution
```

## Protected Default Subagents

The six official ninja agents in `src/templates/agents.json` **cannot be deleted**:

```bash
konoha agent delete genin
# ✗ Subagent "genin" is a protected default Konoha ninja and cannot be deleted.
```

Custom subagents you create via `konoha agent create` can still be deleted.

## Cursor CLI

Cursor CLI reads `~/.cursor/cli-config.json` for MCP permissions. After `konoha init`, these grants are added:

- `Mcp(semble)`, `Mcp(semble, search)`, `Mcp(semble, find_related)`
- `Mcp(konoha)`, `Mcp(konoha, read_file_head)`, `Mcp(konoha, read_file_range)`, `Mcp(konoha, file_info)`, `Mcp(konoha, token_efficient_grep)`, `Mcp(konoha, get_file_structure)`, `Mcp(konoha, find_files_clean)`, `Mcp(konoha, find_skill)`, `Mcp(konoha, get_skill)`, `Mcp(konoha, list_skills)`, `Mcp(konoha, optimize_report)`, `Mcp(konoha, build_from_source)`, `Mcp(konoha, build_from_text)`

Run `konoha doctor --yes` to repair missing permissions.

## Troubleshooting

### MCP not detected in Cursor

1. Check `~/.cursor/mcp.json` contains `konoha` and `semble`.
2. Run `konoha doctor --yes`.
3. Run `node ~/.konoha/cursor_bootstrap.js` (must exit 0).
4. Restart Cursor.

### Wrong agent in `konoha agent status`

1. Ensure the calling agent parameter is set properly when invoking MCP tools.
2. Pass `agent='genin'` (etc.) explicitly in `find_skill` / `get_skill` when possible.
3. Run `python3 src/test_cursor_attribution.py` to validate attribution.

### Missing or stale `~/.cursor/skills/`

1. Run `konoha doctor --yes` to re-sync from `~/.agents/skills/`.
2. After `konoha skill add` or editing skills, run `konoha migrate`.
3. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) (Cursor skills mirror section).

### Dual-platform / multi-client (Antigravity + Cursor + others)

Konoha supports all configured stacks simultaneously. Agent detection uses transcript activity time — not Antigravity `prompt.md` touch time — so active Cursor sessions are not masked by Antigravity orchestrator prompt updates.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for shared issues (Python, database, FTS5).

## Uninstall Cursor Integration Only

```bash
konoha uninstall
```

Removes Konoha-managed entries from `~/.cursor/` (MCP servers, subagents, bootstrap hook) without deleting your Antigravity configuration.
