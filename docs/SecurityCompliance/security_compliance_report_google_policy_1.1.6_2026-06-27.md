# Security and Compliance Review: Konoha Bridge Lifecycle Gate (v1.1.6 → Unreleased)

## Executive Summary
This review documents the security and compliance changes introduced by the **Antigravity Bridge Lifecycle Gate** — the `requiresSidecar` enforcement that couples bridge port binding to the live Antigravity CLI/IDE session. The update tightens the bridge's network footprint by ensuring that `~/.konoha/bridges.json` entries with `requiresSidecar: true` only listen on localhost while the user has Antigravity open. This reduces the local attack surface and strengthens the "no-port-after-closing-Antigravity" invariant.

## Findings

### 1. Antigravity Bridge Lifecycle Gate — `requiresSidecar` Enforcement
- **Changes Reviewed**:
  - **`src/bridge/sidecar/discovery.js`**: Added `isAntigravitySessionLive()` — probes `/bin/ps -eo pid,comm` for `agy`, `antigravity`, `antigravity-cli`, and caches results for 3 seconds. No network calls, no credential access.
  - **`src/file_tools_mcp.js`**: `syncBridges()` now imports `isAntigravitySessionLive()`, evaluates `agySidecarAllowed()` per bridge, gates the `startServer()` path (prevents binding), and stops + deletes active bridges whose sidecar disappears. Legacy `bridges.json` entries get auto-backfilled with `requiresSidecar` defaults.
  - **`bin/cli.js`**: `loadBridges()` emits `requiresSidecar: true` in the default entry. `cmdBridgeStatus()` runs the liveness probe and reports **DETECTED / NOT RUNNING**, labeling gated bridges as `AWAITING SIDECAR`.
- **Security Impact**: Positive reduction in attack surface. Previously, the bridge bound immediately on launch and stayed open regardless of user state. Now it only binds while the user's Antigravity session is active. If the user closes Antigravity, the bridge releases its port on the next 5-second sync tick. This eliminates the window where an external actor on the same machine could reach the bridge without the user's explicit consent.

### 2. No Credential Exposure via Liveness Probe
- **Action Verified**: `isAntigravitySessionLive()` reads only `ps` command-line output (`/bin/ps -eo pid,comm`). It extracts process names, not arguments, and never reads process environments, `/proc`, or any credential-bearing file.
- **Impact**: Zero new credential access. The probe is equivalent to the existing process-discovery logic in `discovery.js`.

### 3. Auto-Backfill Does Not Exfiltrate
- **Action Verified**: The `requiresSidecar` backfill in `loadBridges()` and `cmdBridgeStatus()` modifies only the in-memory object and rewrites the config file locally via `fs.writeFileSync`. No network calls, no telemetry.
- **Impact**: Safe local migration. Existing user configs gain the field transparently; the user sees no behavioral change beyond the new gate semantics.

### 4. Port Release During `AWAITING SIDECAR` State
- **Action Verified**: In the gated case, `syncBridges()` `continue`s the enabled-bridges loop — no `startServer()` is called. When a new bridge is skipped this way, it is not added to `activeBridges`. On the next sync tick (5s), if the user opens Antigravity, `agySidecarAllowed()` flips true and the bridge starts.
- **Risk Assessment**: Low. The port is never bound while gated, so no external listener exists. There is a minor UX risk: if Antigravity opens between sync ticks (within 5 s), the port remains unbound until the next tick. This is intentional — the bridge avoids race conditions by coupling to explicit liveness.

### 5. CLI `bridge status` Probe Timing
- **Action Verified**: `cmdBridgeStatus()` calls `isAntigravitySessionLive()` synchronously via `require('../src/bridge/sidecar/discovery')`. Since the helper caches for 3 s, the CLI invocation adds negligible overhead and the cached value may even persist from a prior MCP sync tick.
- **Impact**: No performance regression. The probe is CPU/light-IO only.

### 6. No New Dependencies or Network Calls
- **Action Verified**: Both changed files (`discovery.js`, `file_tools_mcp.js`, `bin/cli.js`) use only `child_process.execFile`, `fs`, and native JavaScript. No new npm packages, no outbound network traffic.
- **Impact**: Zero supply-chain expansion.

## Compliance Matrix

| Policy Area | Requirement | Status | Evidence |
|---|---|---|---|
| **Credential Privacy** | No reads of `oauth_creds.json` or other token files | Compliant | `isAntigravitySessionLive()` reads only `ps` COMM |
| **Local-Only Binding** | Bind only to `localhost` | Compliant | `startServer` already uses `'127.0.0.1'` |
| **Passive Discovery** | No auto-spawning of sidecar daemons | Compliant | Discovery probes existing processes only |
| **User Consent** | Bridge only reachable when user-initiated | Strengthened | Lifecycle gate enforces this as invariant |
| **No Credential Access** | No env var reads, no `/proc/*/environ` | Compliant | `ps -eo pid,comm` omits command arguments |
| **Deterministic Cleanup** | Release ports when sidecar closes | Compliant | `stopServer` called in cleanup pass |

## Conclusion
This lifecycle-gate update is a **strict security improvement**. It narrows the bridge's network exposure by coupling port binding to the presence of a user-launched Antigravity session, adds no new dependencies or network calls, and introduces zero credential-access paths. The change aligns with (and strengthens) Google's policy for third-party credentials and passive sidecar-only interactions.
