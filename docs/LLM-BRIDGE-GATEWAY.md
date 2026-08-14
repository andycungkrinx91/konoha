# Konoha Bridge Gateway

> **v2.0.0 Architecture** — The Konoha Bridge Gateway is now part of the broader **Konoha Bridge Router** stack, which multiplexes requests across user-configured LLM bridges. The outer Proxy Gateway listens on **port 19999** and forwards to inner bridges on user-defined ports.

The **Konoha Bridge Gateway** provides a unified local API server (port 19999) to route, multiplex, and stream LLM requests across multiple OpenAI-compatible providers from a single entry point.

## Architecture

> **Canonical editable diagram:** [04 LLM Bridge Gateway](diagrams/konoha-architecture.drawio) · [Diagram manifest](diagrams/README.md). The page distinguishes request-time bridge selection from retries inside sidecar protocol paths; there is no gateway-level 429 round-robin failover.

```mermaid
---
title: Konoha LLM Bridge Gateway
config:
  theme: base
  themeVariables:
    background: '#ffffff'
    primaryColor: '#ffe6cc'
    primaryTextColor: '#78350f'
    primaryBorderColor: '#d97706'
    lineColor: '#64748b'
    secondaryColor: '#dbeafe'
    tertiaryColor: '#ede9fe'
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
  flowchart:
    nodeSpacing: 90
    rankSpacing: 110
    padding: 32
    wrappingWidth: 360
---
flowchart LR
    Client([MCP / API Client]) --> Gateway[Konoha Bridge Router<br/>HTTP API :19999]
    Gateway -->|Read model mapping| Bridges[(SQLite bridges table<br/>model cache)]
    Bridges -->|Prefix / exact / first active| Gateway
    Gateway -->|One request| OpenAI[OpenAI API-Key<br/>Bridge]
    Gateway -->|One request| Compatible[OpenAI-Compatible<br/>Bridge]
    Gateway -->|Sidecar route| Antigravity[Antigravity<br/>Sidecar]
    OpenAI --> OpenAIAPI[OpenAI API]
    Compatible --> Local[Local LLM<br/>Endpoint]
    Antigravity --> Cascade[Sidecar protocol cascade<br/>proto -> raw -> gRPC]
    Gateway -->|Discovery :19899| Discovery[UDP Discovery<br/>:19899]

    classDef client fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px
    classDef gateway fill:#ffe6cc,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef bridge fill:#e0e7ff,stroke:#6366f1,color:#312e81
    classDef storage fill:#ffedd5,stroke:#ea580c,color:#7c2d12,stroke-width:2px
    class Client client
    class Gateway gateway
    class OpenAI,Compatible,Antigravity,OpenAIAPI,Local,Cascade,Discovery bridge
    class Bridges storage
```

## Supported Providers

| Provider Type | CLI Alias | Model Format | Source |
|---|---|---|---|
| **OpenAI API Key** | `openai` | `<bridge_name>-<model>` | Direct OpenAI API |
| **OpenAI Compatible** | `compatible` | `<bridge_name>-<model>` | Ollama, vLLM, LM Studio, etc. |
| **Antigravity Sidecar** | `antigravity` | `<bridge_name>-<model>` | Local `agy` CLI / Antigravity IDE (requires live session) |

> **Note:** Supported providers are OpenAI API Key, OpenAI Compatible, and Antigravity Sidecar. The `openai-oauth` (device code flow) provider was removed in v2.0.0.

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/healthz` | None | Health check |
| `GET` | `/v1/models` | None | List all models from all active bridges |
| `POST` | `/v1/chat/completions` | None | Chat completions (auto-routed by model prefix) |
| `POST` | `/v1/messages` | None | Anthropic Messages API format |
| `POST` | `/v1/messages.beta` | None | Anthropic Messages beta format |
| `POST` | `/v1/gemini/*` | None | Google Gemini API format |
| `GET` | `/v1/bridge-list` | None | List all configured bridges |
| `POST` | `/v1/messages/count_tokens` | None | Anthropic preflight mock (returns `{"input_tokens": 0}`) — used by Claude CLI / Cherry Studio as a budget-warning preflight |

## Model Naming Rules

### Standard Bridges (`provider: openai` or `openai-compatible`)

Format: `<bridge_name>-<model>`

Examples:
```
my-ollama-llama3.1          # Ollama bridge
lm-studio-mistral-7b        # LM Studio bridge
gpt-api-gpt-4o              # OpenAI API key bridge
```

### Enhanced Model Resolution Flow

1. Extract model name from request (e.g. `gpt-api-gpt-4o`)
2. Split by first hyphen: bridge = `gpt-api`, model = `gpt-4o`
3. Query SQLite `bridges` table for `name = 'gpt-api'`
4. If bridge provider is `antigravity`, verify Antigravity sidecar session is alive via `isAntigravitySessionLive()`
5. Check bridge `enabled` flag — exclude disabled bridges
6. Resolve to an inner bridge, cache the lookup for 30 seconds
7. Forward request with mapped model name

## Bridge Management

### Creating Bridges

```bash
konoha bridge create   # Interactive wizard
```

Wizard prompts:
```
Choose provider type:
  1  OpenAI API Key
  2  OpenAI Compatible (Ollama, LM Studio, vLLM)

Enter choice [1/2]:
```

For **OpenAI API Key** (option 1):
- Prompts: bridge name, port, target URL, API key
- Stores in `~/.konoha/skills.db` bridges table

For **OpenAI Compatible** (option 2):
- Prompts: bridge name, port, target URL (required), API key (optional)
- Example: `http://localhost:11437/v1/chat/completions`

### Managing Bridges

```bash
konoha bridge list              # Table of all configured bridges
konoha bridge status            # Detailed status with runtime connectivity check
konoha bridge models            # All models served across active bridges
konoha bridge enable <name>     # Enable a disabled bridge
konoha bridge disable <name>    # Disable without deleting
konoha bridge delete <name>     # Remove bridge entirely
konoha bridge start             # Start gateway daemon (port 19999)
konoha bridge stop              # Stop gateway daemon
```

## Sidecar Discovery

The gateway supports automatic sidecar discovery for detecting local LLM instances:

1. **UDP broadcast** on port 19899 to discover running sidecars
2. **Cascade fallback**: proto codec → raw JSON → gRPC
3. Auto-registering discovered instances as bridges

## Gateway Protections

### Streaming Timeout Protection

- Gateway never times out during streaming — upstream timeout is extended automatically
- SSE error frames are HTML-entity escaped to prevent framing corruption
- Null bytes and non-printable characters are stripped from error messages
- Response body size is capped at 200MB per request

### Concurrent Request Limits

- Maximum concurrent chat requests: configurable (default varies)
- Rate limiting: minimum interval between requests enforced
- Excess requests receive 429 responses with retry guidance

### Request Validation

- Malformed JSON returns `400 Invalid JSON`
- `[object Object]` serialized messages detected and rejected with clear error
- Missing messages field returns `400 Invalid Request`
- Empty message content validated

### Bridge Failover

The gateway itself does **not** rotate across bridges mid-request. Per request:

1. `resolveBridgeAndModel()` picks **one** bridge using a 3-step priority: (a) `<bridge_name>-<model>` prefix match, (b) exact model-name match across the combined bridge model cache, (c) fallback to the first active bridge (see `src/bridge/gateway.js:65-110`).
2. The gateway forwards the request to that single bridge and **pipes the response verbatim** (status code, headers, body) back to the client. There is no 429-driven rotation loop at the gateway layer — a 429 from the bridge is passed straight through to the caller.

**Where retries actually happen:**

- **Sidecar raw inference path** (`src/bridge/sidecar/raw.js:268-275`): `callRawInference` runs its own retry loop — up to 4 attempts with a 2-second backoff between each — for transient gRPC / connection / sidecar-discoverable / `RESOURCE_EXHAUSTED` errors. This happens inside the sidecar bridge process before the gateway ever sees the response.
- **Cascade path** (`src/bridge/sidecar/cascade.js:75-82`): up to 3 retries with 10s backoff, restarting the cascade on each attempt.
- **RPC path** (`src/bridge/sidecar/rpc.js:277-292`): `_withRetry` wraps transient H2 connect/timeout errors (2 retries).
- **Per-handler error translation**: format adapters such as `src/bridge/handlers/gemini.js:259-304` detect rate-limit-style errors (`429`, `RESOURCE_EXHAUSTED`, `capacity`, `H2 timeout`, `Sidecar not discovered`, etc.) and translate them into a proper 429 response with a `Retry-After` header for the client. They do not retry.

**No global round-robin rotator**: the gateway has no mechanism that, on 429, picks the next bridge and re-sends the same request. Multi-bridge availability is a routing-time concern (model-to-bridge mapping), not a runtime failover concern. If you need cross-bridge failover, the caller (client SDK) must implement it.

### Header Sanitization

The gateway strips the following inbound headers before forwarding to inner bridges:

- `Authorization`, `x-api-key` — API keys are only injected by the bridge (not proxied).
- `x-forwarded-*`, `x-request-id`, `x-client-*`, `x-konoha-gateway-*` — metadata headers.

This ensures local clients never need to send API keys to the gateway, and upstream bridges receive only clean requests.

### Response Model Rewriting

Both streaming and non-streaming responses have their `"model"` field rewritten back to the gateway alias:

- OpenAI: extracts `"model"` from response JSON.
- Anthropic: rewrites `"model_id"` field.
- Gemini: rewrites `"model"` in JSON response.

For example, a request to `adacode-claude-sonnet-4-6` gets rewritten to return `"model": "adacode-claude-sonnet-4-6"` even though the upstream bridge responds with its internal model name.

### Compression Safety

The gateway sets `Accept-Encoding: identity` on forwarded requests to guarantee uncompressed responses. This ensures regex-based model name rewriting is reliable.

## Bridge Schema

### SQLite Database: `~/.konoha/skills.db`

```sql
CREATE TABLE bridges (
    name        TEXT    PRIMARY KEY,
    port        INTEGER NOT NULL,
    provider    TEXT    NOT NULL,   -- openai | openai-compatible | antigravity
    enabled     INTEGER NOT NULL DEFAULT 1,
    target_url  TEXT,
    api_key     TEXT
);
```

### Python CLI: `src/db_bridges.py`

```bash
python3 src/db_bridges.py --list
python3 src/db_bridges.py --upsert '{"name":"my-bridge","port":11437,...}'
python3 src/db_bridges.py --delete my-bridge
python3 src/db_bridges.py --enable my-bridge
python3 src/db_bridges.py --disable my-bridge
```

## Gateway Source Files

| File | Role |
|---|---|
| `src/bridge/server.js` | HTTP server entrypoint, request routing |
| `src/bridge/gateway.js` | Proxy gateway logic, model resolution, concurrent request guard |
| `src/bridge/handlers/openai.js` | OpenAI `/v1/chat/completions` handler |
| `src/bridge/handlers/anthropic.js` | Anthropic `/v1/messages` handler |
| `src/bridge/handlers/gemini.js` | Google Gemini API handler |
| `src/bridge/handlers/proxy.js` | Generic reverse-proxy handler |
| `src/bridge/sidecar/discovery.js` | Sidecar discovery via UDP broadcast |
| `src/bridge/sidecar/cascade.js` | Cascade failover chain (proto → raw → gRPC) |
| `src/bridge/sidecar/proto.js` | Protobuf codec using `@bufbuild/protobuf` |
| `src/bridge/sidecar/raw.js` | Raw inference codec |
| `src/bridge/sidecar/rpc.js` | RPC client for sidecar communication |
| `src/bridge/context.js` | Bridge context management (per-bridge state) |
| `src/bridge/models.js` | Model mapping utilities |
| `src/bridge/utils.js` | Shared utilities (logging, streaming helpers, readBody) |
| `src/db_bridges.py` | SQLite bridge CRUD |

---

## Konoha Bridge Extension — Auto-Install

The Antigravity-side `konoha-bridge` extension is a customized fork of the open-source `ag-local-bridge` project. It runs **inside Antigravity's process** and provides:

- WebSocket-based sidecar communication for the bridge router (port `19999`).
- Automatic bridge discovery when the Antigravity IDE/CLI is open (`requiresSidecar: true`).

### Source & Installation

| Property | Value |
|---|---|
| **Repository** | `https://github.com/andycungkrinx91/konoha-bridge/tree/master` |
| **Current version** | `1.2.0` (bumped when upstream releases change) |
| **Default branch** | `master` |
| **Install locations** | `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-1.2.0-universal/` (primary), mirrored to legacy `~/.antigravity/extensions/` and `~/.vscode/extensions/` for back-compat |

### Auto-Install Flow

```
konoha init   → autoInstallKonohaBridgeExtension(true)   ← one-time on fresh install
konoha <cmd>  → ensureAutoSetup() → autoInstallKonohaBridgeExtension(true)  ← every CLI run
```

**What happens on each call:**

1. Detects whether the extension is **already installed at the correct version** across all three target paths.
2. If present → logs a skipped message and returns `true` immediately (zero-op).
3. If absent or **version mismatch** → clones from `github:andycungkrinx91/konoha-bridge@master --depth=1` into a **temp directory** first.
4. After a successful clone, copies into all three extension directories and **removes stale old-version directories** to avoid conflicts.
5. Cleans up the temp directory regardless of success or failure.
6. On any failure (git error, copy error, permission error) → logs a warning but **does not block** the CLI — the bridge simply won't be available until the user retries or runs `konoha doctor --yes`.

### Manual Reinstall

```bash
# Remove stale extension directories then re-run init
rm -rf ~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-*
rm -rf ~/.antigravity/extensions/andycungkrinx91.konoha-bridge-*
konoha doctor --yes
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `konoha-bridge` extension not loading in Antigravity IDE | Check `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-1.2.0-universal/package.json` exists. If missing, run `konoha doctor --yes` |
| Extension fails to connect to bridge router on port 19999 | Start the gateway: `konoha bridge start` or run `konoha bridge create` to register an Antigravity sidecar bridge |
| Stale extension version after `konoha upgrade` | Run the manual reinstall above, then `konoha doctor --yes` |

**Note:** The extension install is **fire-and-forget** — a failure does not block any other CLI operation (MCP registration, file-tools deploy, agent setup, etc.). Check the warning output for details.
