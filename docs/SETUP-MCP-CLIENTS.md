
Konoha registers **konoha** and **semble** for every supported client detected during `konoha init`. Missing optional clients are skipped without failing installation. Existing configs are preserved or backed up according to each client manager.

| Client | Auto-setup with `konoha init` | Runtime config |
|--------|------------------------------|----------------|
| **Antigravity CLI/IDE** | MCP setup when detected; external `konoha-bridge` extension only when Antigravity IDE is detected | `~/.gemini/config/mcp_config.json`; extension API `127.0.0.1:1313` when enabled |
| **Cursor** | When detected | `~/.cursor/mcp.json` and project `.cursor/mcp.json` |
| **Claude Code** | When detected | `~/.claude.json` → `mcpServers` |
| **OpenCode** | When detected | `~/.config/opencode/opencode.json` → `mcp` (legacy `~/.opencode/config.json` is detected) |
| **Command Code** | When detected as `cmd` or `commandcode` | `~/.commandcode/mcp.json` → `mcpServers` |

### RTK (Rust Token Killer) Auto-Deployment

When the `rtk` binary is available on PATH, Konoha also deploys RTK rule files to each client:

| Client | RTK Rule Location |
|--------|-------------------|
| **Antigravity** | `~/.gemini/antigravity-cli/rules/rtk.md` + `~/.gemini/antigravity-ide/rules/rtk.md` |
| **Cursor** | `~/.cursor/rules/rtk.mdc` |
| **Claude Code** | `~/.claude/rules/rtk.md` |
| **OpenCode** | `~/.config/opencode/rules/rtk.md` |
| **Command Code** | `~/.commandcode/rules/rtk.md` |

These rules instruct the agent to prefix all shell commands with `rtk` to minimize token consumption. If `rtk` is not installed, Konoha skips this step gracefully. Check status with `konoha status`.

> [!IMPORTANT]
> **Cross-Platform Config Paths:**
> - `~/.gemini/` = Linux, macOS, Windows WSL
> - `~/.cursor/` = All platforms (Windows: `%USERPROFILE%\.cursor\`)
> - `~/.claude.json` = All platforms


### 📦 Standard 3-Step Team Onboarding (ZIP / Clone / Manual)
```bash
# 1. Extract and enter the directory
unzip konoha.zip
cd konoha

# 2. Install CLI dependencies (if node_modules is not included in zip)
pnpm install

# 3. Execute one-command cross-client initialization
node bin/cli.js init --yes --force
```

### Direct Initialization
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
- `~/.claude/agents/` → Seven official ninja subagents; the host client controls model selection.
- `~/.claude/rules/rtk.md` → RTK rule (if `rtk` binary detected).

**Verify:** `/mcp` in Claude Code session — should show `konoha` and `semble`.

**Model Selection:** The host client selects the active model. Konoha does not inject model fields into client configuration.

---

## Command Code (global)

**Detection**: `cmd` or `commandcode` in PATH, or `~/.commandcode/`, or `~/.commandcode/mcp.json`.

**Writes:**
- `~/.commandcode/mcp.json` → `mcpServers` (all projects on this machine).
- `~/.commandcode/rules/konoha.md` → main-agent Konoha + Semble + RTK contract.
- `~/.commandcode/rules/rtk.md` when RTK is installed.

**Verify:** Run `cmd mcp list` or type `/mcp` in Command Code session — should show `konoha` and `semble`.

---

## OpenCode IDE (global)

**Detection**: `opencode` binary in PATH, or `~/.config/opencode/`, or the legacy `~/.opencode/config.json`.

**Writes:**
- `~/.config/opencode/opencode.json` → `mcp` (all projects on this machine).
- `~/.config/opencode/AGENTS.md` → global Konoha + Semble contract.
- `~/.config/opencode/rules/rtk.md` when RTK is installed; OpenCode has no supported RTK hook.

**Verify:** Open OpenCode IDE and check MCP configurations — should show `konoha` and `semble`.

---

## Codex CLI / IDE (global)

**Detection**: `codex` binary in PATH, or `~/.codex/`, or `~/.codex/config.toml`.

**Writes:**
- `~/.codex/config.toml` → `[mcp_servers]` (all projects on this machine).
- `~/.codex/AGENTS.md` → global Konoha + Semble contract.
- `~/.codex/rules/rtk.md` when RTK is installed.

**Config format (TOML):**
```toml
[mcp_servers.konoha]
command = "python3"
args = ["/home/<user>/.konoha/server.py"]

[mcp_servers.semble]
command = "uvx"
args = ["--from", "semble[mcp]@latest", "semble", "--content", "all"]
```

**Verify:** Run `codex mcp list` or inspect `~/.codex/config.toml` — should show `konoha` and `semble`.

---

## Agent workflow (all clients)

1. `konoha` `find_skill` for skills
2. `semble` `search` / `find_related` for code
3. `konoha` for bounded file reads
4. The embedded Konoha Bridge Router runs in-process inside the `konoha` MCP server on `127.0.0.1:19999`. The optional Antigravity IDE extension is separate and serves `127.0.0.1:1313`; it is never started by Konoha as a standalone process. Local clients do not send API keys to the aggregate router.
5. External `antigravity-extension` bridge records are disabled by default and require explicit `konoha bridge enable <name>`.

In the konoha repo: `find_skill("konoha maintenance")` after `konoha migrate`.

**Cursor note:** Konoha does not create `~/.cursor/skills/` mirrors or symlinks. Cursor agents load skill **content** through `konoha.find_skill`/`konoha.get_skill` and use `semble` for code search.

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

Konoha Bridge Router supports multiple bridges for explicit model routing. It does not perform gateway-level round-robin failover.

### Add a bridge

```bash
konoha bridge create
# => choose 1 (OpenAI-compatible)     => prompts for name, port, target URL, API key
# => choose 2 (Antigravity Extension) => port 1313, IDE-owned, disabled by default
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

### Bridge routing behavior

The gateway selects one enabled bridge per request using model-prefix, exact-model, then first-active fallback. It does not perform gateway-level round-robin retry after a `429`; retry behavior belongs to sidecar paths or the calling client.

See [LLM-BRIDGE-GATEWAY.md](LLM-BRIDGE-GATEWAY.md) for full architecture details.
