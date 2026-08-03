# Konoha Bridge Gateway

The **Konoha Bridge Gateway** provides a unified local API server (port 19999) to route, multiplex, and stream LLM requests across multiple OpenAI-compatible providers from a single entry point.

## Architecture

```mermaid
graph TD
    classDef client  fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef gateway fill:#1e293b,stroke:#475569,stroke-width:2px,color:#e2e8f0;
    classDef bridge  fill:#1e3a8a,stroke:#3b82f6,stroke-width:1px,color:#f8fafc;
    classDef db      fill:#451a03,stroke:#f97316,stroke-width:2px,color:#f8fafc;
    classDef proto   fill:#4c1d95,stroke:#a78bfa,stroke-width:1px,color:#ede9fe;

    Gateway["Proxy Gateway\nPort 19999"]:::gateway
    SQLite[("SQLite\n~/.konoha/skills.db\nbridges table")]:::db
    Sidecar["Sidecar Discovery\nUDP broadcast (port 19899)"]:::proto
    Cascade["Cascade Failover\nproto → raw → gRPC"]:::proto
    BridgeA["API-Key Bridge\n<name>-<model>"]:::bridge
    BridgeB["Compatible Bridge\nOllama / vLLM / LM Studio"]:::bridge
    OpenAI["OpenAI API\napi.openai.com"]:::bridge
    LocalLLM["Local LLM\n(port 11437, etc.)"]:::bridge

    Client -->|HTTP/REST| Gateway
    Gateway -->|Read config| SQLite
    Gateway -->|POST| BridgeA
    Gateway -->|POST| BridgeB
    BridgeA --> OpenAI
    BridgeB --> LocalLLM
    Gateway -->|Discover| Sidecar
    Sidecar --> Cascade
    Cascade -->|Fallback chain| BridgeA
```

## Supported Providers

| Provider Type | CLI Alias | Model Format | Source |
|---|---|---|---|
| **OpenAI API Key** | `openai` | `<bridge_name>-<model>` | Direct OpenAI API |
| **OpenAI Compatible** | `compatible` | `<bridge_name>-<model>` | Ollama, vLLM, LM Studio, etc. |
| **Antigravity Sidecar** | `antigravity` | `<bridge_name>-<model>` | Local `agy` CLI / Antigravity IDE (requires live session) |

> **Note:** Supported providers are OpenAI API Key, OpenAI Compatible, and Antigravity Sidecar. The `openai-oauth` (device code flow) provider was removed in v1.1.7+.

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
