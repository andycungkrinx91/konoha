
Konoha registers **konoha** and **semble** for every supported client detected during `konoha init`. Missing optional clients are skipped without failing installation. Existing configs are preserved or backed up according to each client manager.

| Client | Auto-setup with `konoha init` | Runtime config |
|--------|------------------------------|----------------|
| **Antigravity CLI/IDE** | Always | `~/.gemini/config/mcp_config.json` |
| **Cursor** | When detected | `~/.cursor/mcp.yaml` and project `.cursor/mcp.yaml` |
| **Claude Code** | When detected | `~/.claude.json` → `mcpServers` |
| **OpenCode** | When detected | `~/.opencode/config.json` → `mcp` |
| **Command Code** | When detected as `cmd` or `commandcode` | `~/.commandcode/mcp.json` → `mcpServers` |

### RTK (Rust Token Killer) Auto-Deployment

When the `rtk` binary is available on PATH, Konoha also deploys RTK rule files to each client:

| Client | RTK Rule Location |
|--------|-------------------|
| **Antigravity** | `~/.gemini/antigravity-cli/rules/rtk.md` + `~/.gemini/antigravity-ide/rules/rtk.md` |
| **Cursor** | `~/.cursor/rules/rtk.mdc` |
| **Claude Code** | `~/.claude/rules/rtk.md` |
| **OpenCode** | `~/.opencode/rules/rtk.md` |
| **Command Code** | `~/.commandcode/rules/rtk.md` |

These rules instruct the agent to prefix all shell commands with `rtk` to minimize token consumption. If `rtk` is not installed, Konoha skips this step gracefully. Check status with `konoha status`.

> [!IMPORTANT]
> **Cross-Platform Config Paths:**
> - `~/.gemini/` = Linux, macOS, Windows WSL
> - `~/.cursor/` = All platforms (Windows: `%USERPROFILE%\.cursor\`)
> - `~/.claude.json` = All platforms


```bash
pnpm dlx github:andycungkrinx91/konoha init
```

---


Konoha skips their config. After installing the CLI:

```bash
konoha doctor --yes
```

**Manual fallback** (merge into global config, not project files):

| Client | Template | Target |
|--------|----------|--------|
| Claude Code | [templates/claude-code.mcp.yaml](templates/claude-code.mcp.yaml) | `~/.claude.json` → `mcpServers` |

---

## Verify

```bash
konoha status
konoha test
konoha doctor --yes
```

---

## Antigravity / Cursor

- [SETUP-IDE.md](SETUP-IDE.md) · [SETUP-CLI.md](SETUP-CLI.md) · [SETUP-CURSOR.md](SETUP-CURSOR.md)

---

## Claude Code (global)

**Detection**: `claude` in PATH, or `~/.claude/`, or `~/.claude.json`.

**Writes:**
- `~/.claude.json` → `mcpServers` (all projects on this machine).
- `~/.claude/CLAUDE.md` → Global orchestrator instructions.
- `~/.claude/agents/` → Seven ninja subagents (model: inherit for Cursor Free).
- `~/.claude/rules/rtk.md` → RTK rule (if `rtk` binary detected).

**Verify:** `/mcp` in Claude Code session — should show `konoha` and `semble`.

**Model Default:** All Konoha subagents use `Claude Sonnet 4.6 (Thinking)` automatically. No manual configuration required.

---

## Command Code (global)

**Detection**: `cmd` or `commandcode` in PATH, or `~/.commandcode/`, or `~/.commandcode/mcp.json`.

**Writes:**
- `~/.commandcode/mcp.json` → `mcpServers` (all projects on this machine).

**Verify:** Run `cmd mcp list` or type `/mcp` in Command Code session — should show `konoha` and `semble`.

---

## OpenCode IDE (global)

**Detection**: `opencode` binary in PATH, or `~/.opencode/`, or `~/.opencode/config.json`.

**Writes:**
- `~/.opencode/config.json` → `mcp` (all projects on this machine).
- `~/.opencode/rules/rtk.md` when RTK is installed.

**Verify:** Open OpenCode IDE and check MCP configurations — should show `konoha` and `semble`.

---

## Agent workflow (all clients)

1. `konoha` `find_skill` for skills
2. `semble` `search` / `find_related` for code
3. `konoha` for bounded file reads
4. The Konoha Bridge Router runs in-process inside the `konoha` MCP server. The router listens on `19999` and routes to inner OpenAI / Local LLM bridges based on model name prefixes. Local clients do not send API keys to the router.

In the konoha repo: `find_skill("konoha maintenance")` after `konoha migrate`.

**Cursor note:** Skills on disk are mirrored to `~/.cursor/skills/`; agents still load skill **content** via `konoha` — do not read `SKILL.md` files directly into context.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Skipped at init | Install CLI → `konoha doctor --yes` |
| MCP missing | `konoha status` → check global row |
| CLI not installed | Use `docs/templates/` → merge into **global** config |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Adding Multiple Bridges

Konoha Bridge Router supports multiple bridges per provider for failover.

### Add a bridge

```bash
konoha bridge create
# => choose 1 (OpenAI API Key)         => prompts for name, port, target URL, API key
# => choose 2 (OpenAI Compatible)     => prompts for name, port, target URL, API key
# => choose 3 (Antigravity Sidecar)   => passive, requires live Antigravity IDE session
```

### Manage bridges

```bash
konoha bridge list              # List all bridges with provider info
konoha bridge status            # Runtime status (AWAITING SIDECAR for Antigravity if IDE is closed)
konoha bridge enable <name>     # Enable a bridge
konoha bridge disable <name>    # Disable a bridge
konoha bridge delete <name>     # Remove a bridge

# Start the gateway
konoha bridge start
```

### Configure your IDE client to point at the gateway

Set your client's API base URL and key to:

```
API Base URL: http://127.0.0.1:19999/v1
API Key:      any-value   (gateway does not enforce key)
```

### Model names for OAuth bridges

All OAuth user slots share the `openai-` prefix namespace:

```
openai-gpt-4o
openai-o1
openai-gpt-4o-mini
```

For API-key bridges (Ollama, LM Studio, etc.) model names use `<bridge_name>-<model>`:

```
my-ollama-llama3
lm-studio-mistral-7b
```

### Automatic failover

When a bridge returns an error, the gateway automatically routes to the next available bridge (round-robin across providers).

See [LLM-BRIDGE-GATEWAY.md](LLM-BRIDGE-GATEWAY.md) for full architecture details.
