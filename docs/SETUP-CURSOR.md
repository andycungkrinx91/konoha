# Cursor IDE & Cursor CLI Setup Guide

Konoha **v2.0.0+** supports **Cursor IDE** and **Cursor CLI** alongside Antigravity and Claude Code. The same `konoha` + `semble` MCP stack and seven ninja subagents work in both environments.

## RTK (Rust Token Killer) — Token-Optimized Shell

If you have [`rtk`](https://github.com/raxodog/rtk) installed on your system (`cargo install rtk`), Konoha will automatically deploy an RTK rule to `~/.cursor/rules/rtk.mdc` on `konoha init`. This rule instructs the agent to prefix all shell commands with `rtk` to minimize token consumption:

```bash
rtk git status
rtk ls src/
rtk grep "pattern" src/
rtk find "*.ts" .
```

Meta commands like `rtk gain` show token savings, and `rtk discover` finds missed RTK opportunities. RTK can cut up to 90% of bash output on common operations. If `rtk` is not installed, Konoha skips this step gracefully.

## Prerequisites

- **Cursor IDE** or **Cursor CLI** installed
- **Python 3** ≥ 3.8
- **Node.js** ≥ 18 (via nvm, Homebrew, or system package)
- Agent skills in `~/.agents/skills/` (with `SKILL.md` files) — Konoha indexes these in SQLite; Cursor uses Konoha MCP and does not receive a Konoha filesystem mirror

### Cross-Platform Notes

| OS | Python Install | Node.js Install | Cursor Setup |
|----|---------------|-----------------|--------------|
| **Linux** | `sudo apt install python3` | `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` | Standard install |
| **macOS** | `brew install python` | `brew install node` | Standard install |
| **Windows (native)** | [python.org/downloads](https://www.python.org/downloads/) — check "Add to PATH" | [nodejs.org](https://nodejs.org/) | Standard install |
| **Windows (WSL)** | Same as Linux | Same as Linux | Run Cursor inside WSL for full integration |

## Step 1: Install Konoha (Auto-Setup)


For a full install:

```bash
pnpm dlx github:andycungkrinx91/konoha init
```

Konoha will auto-configure Cursor if it is detected (`~/.cursor/` or `cursor` binary on PATH) and skip silently otherwise. The following paths are deployed:

| Path | Purpose |
|------|---------|
| `~/.cursor/mcp.yaml` | **Backed up** to `mcp.yaml.back` (first install only), then updated with `konoha` + `semble` |
| `~/.agents/skills/` | Canonical agent skill source indexed and served through Konoha FTS5; no Cursor filesystem mirror |
| `~/.cursor/hooks.json` | `sessionStart` → `cursor_bootstrap.js` (fail-open) |
| `~/.cursor/cli-config.json` | MCP allowlist for Cursor CLI |
| `~/.cursor/rules/rtk.mdc` | **RTK (Rust Token Killer) rule** — deployed automatically when `rtk` binary is on PATH |
| `.cursor/mcp.json` (project) | Project-scoped MCP config |
| `.cursor/rules/konoha.mdc` | Main-agent Konoha + Semble + RTK contract and delegation rules |

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
5. **Skills from MCP**: Konoha keeps `~/.agents/skills/` as the canonical source and indexes it in SQLite. Cursor agents load skill **content** via `konoha` MCP; Konoha does not create `.cursor/skills/` mirrors or symlinks.

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

### Subagent models

All subagents run on `Claude Sonnet 4.6 (Thinking)`. Cursor Free users are unaffected — no manual model selection is required.

## Agent Call Statistics (`konoha agent status`)

When MCP tools omit the `agent` parameter, `detect_active_agent()` resolves identity from:

- **Cursor**: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl` — `Task` `subagent_type`, subagent `[Agent] active` text logs, or `[Konoha] orchestrator active`.
- **Antigravity**: `~/.gemini/antigravity-ide/brain` and `antigravity-cli/brain` — delegated `prompt.md` and recent `PLANNER_RESPONSE` transcripts. If `ANTIGRAVITY_CONVERSATION_ID` is set, scans are strictly isolated to the active session folder (Cursor projects are excluded) to prevent cross-session telemetry pollution.

Recent Cursor sessions are preferred over stale Antigravity brain folders so counters stay accurate in multi-client setups.

### Verification scripts

```bash
python3 tests/test_cursor_attribution.py   # Cursor one-by-one attribution
python3 tests/test_agent_attribution.py    # Antigravity one-by-one attribution
python3 tests/test_claude_attribution.py   # Claude Code one-by-one attribution
```

## Protected Default Subagents

The seven official ninja agents in `src/templates/agents.yaml` **cannot be deleted**:

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
3. Run `python3 tests/test_cursor_attribution.py` to validate attribution.

### Missing skill content in Cursor

1. Run `konoha doctor --yes` to repair MCP and generated rules.
2. After `konoha skill add` or editing skills, run `konoha migrate`.
3. Confirm the agent uses `konoha.find_skill` and `konoha.get_skill`; do not create a `.cursor/skills/` mirror.

### Dual-platform / multi-client (Antigravity + Cursor + others)

Konoha supports all configured stacks simultaneously. Agent detection uses transcript activity time — not Antigravity `prompt.md` touch time — so active Cursor sessions are not masked by Antigravity orchestrator prompt updates.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for shared issues (Python, database, FTS5).

## Uninstall Cursor Integration Only

```bash
konoha uninstall
```

Removes Konoha-managed entries from `~/.cursor/` (MCP servers, subagents, bootstrap hook) without deleting your Antigravity configuration.
