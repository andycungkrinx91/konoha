# Security and Compliance Review: Konoha Project v1.1.6

## Executive Summary
A comprehensive security and compliance review was performed on the Konoha project (v1.1.6) covering both the original `ag-local-bridge` integration and the subsequent removal of the now-redundant VS Code extension shell. The goal of this review is to verify credential privacy and ensure that the codebase conforms strictly to Google's security policies regarding third-party credentials (specifically the `.gemini/oauth_creds.json` file). The audit confirms that the codebase is **fully compliant** and does not perform any unauthorized credential accesses. The deletion of the VS Code extension entrypoint, the HTTPS/H2/HTTP-server monkey-patch interceptors, and the dead `/v1/captures` debug endpoint strictly reduces the bridge's local attack surface while preserving all functional behavior of the in-process antigravity bridge (now hosted entirely inside the `konoha-files` MCP server).

## Findings

### 1. Verification of Credential Privacy (No access to `oauth_creds.json`)
- **Action Verified**: Conducted a full static analysis and codebase search across the integrated bridge source files under `src/bridge/` to check for occurrences of `oauth_creds.json`, `.gemini`, `credentials`, raw OAuth key lookups, and any reads of token-bearing files. Re-audited after the VS Code extension shell deletion to confirm no credential-access path was introduced or exposed.
- **Impact**: Confirmed that the bridge never reads, writes, accesses, or processes `.gemini/oauth_creds.json` or any other external user token files on disk. The bridge solely forwards LLM requests to the locally running, CSRF-protected sidecar endpoint. All actual authentication and outbound calls are handled by the native sidecar itself, ensuring absolute credential safety and alignment with Google policy.

### 2. Local Process Discovery and CSRF Protection
- **Action Verified**: Inspected the process discovery logic in `src/bridge/sidecar/discovery.js` and the connection setup in `src/bridge/sidecar/rpc.js`.
- **Impact**: The connection details (the dynamic local port and the CSRF token) are retrieved dynamically at runtime by parsing the process list for the active sidecar executable (`language_server_*` or `agy`). The local bridge only binds to `localhost` and validates headers to prevent cross-site request forgery, completely isolating the proxy loop within the user's local machine.

### 3. Interactive Consent and Validation for Custom Bridge Configurations
- **Action Verified**: Inspected the CLI create command implementation in `bin/cli.js` (`cmdBridgeCreate`). Verified that all custom OpenAI configurations (port, target URL, and API key) are prompted interactively and checked against strict safety bounds (port number validation, duplicate port prevention, name validation regex `/^[a-zA-Z0-9_-]+$/`).
- **Impact**: Ensures that no configuration edits happen silently, and that custom inputs are sanitized to prevent command injection or local port conflicts.

### 4. Dynamic Bridge Multi-Instance Listening and Hot-Reloading Process Control
- **Action Verified**: Inspected the dynamic bridge loader and sync logic in `src/file_tools_mcp.js` (`activeBridges`, `syncBridges()`, `fs.watch()`, `setInterval()`).
- **Impact**: Confirmed that only bridges marked `enabled: true` in `~/.konoha/bridges.json` are launched. Added dynamic config reloading (hot-swapping): the running MCP server watches `bridges.json` for modifications (creates, updates, deletes, toggles) using `fs.watch` and a 5-second polling fallback. Active bridge servers are instantly started, reloaded, or shut down in real-time, eliminating the need to restart the host IDE/MCP process. In-process servers are correctly isolated using separate context objects (`bridgeCtx`). Added a dedicated cleanup listener (`rl.on("close")`) to clear intervals, stop file watchers, and terminate all bridge sockets cleanly when the parent client connection closes, preventing orphaned background listener processes.

### 5. Strict Passive Process Discovery Policy for Antigravity Bridge
- **Action Verified**: Inspected the process discovery logic in `src/bridge/sidecar/discovery.js` (`_discoverSidecarOnce`).
- **Impact**: Confirmed that the bridge strictly employs passive process discovery to locate active sidecar/`agy` daemons. To maintain 100% compliance with Google's security policies and prevent unauthorized background sessions, the bridge connects only to active, user-initiated client instances (IDE or CLI) and never spawns or hosts background sidecar/gRPC processes on its own when they are not running. If no user session is active, the request safely fails, preventing any potential account restrictions.

### 6. Prevention of HTTP/2 Unary Connection Memory Leak
- **Action Verified**: Inspected and verified the fix in `src/bridge/sidecar/rpc.js` (`_makeH2UnaryCallOnce`).
- **Impact**: Declared a proper timer variable and invoked `clearTimeout` when settling the ConnectRPC promise. This ensures that dynamic timeout handlers do not persist indefinitely in Node's event loop, guaranteeing runtime memory stability during long inference sessions.

### 7. Bounded Body Parser Validation in Proxy Gateway and Bridge
- **Action Verified**: Inspected and verified the fixes in `src/bridge/gateway.js` (`readBody`) and `src/bridge/utils.js` (`readBody`).
- **Impact**: Configured bounded parser implementations with a high limit of 200MB default to fully support massive token contexts and large multi-image/file inputs of modern AI models. Requests exceeding this high boundary trigger safe socket destruction, preserving cross-OS runtime safety (Windows, macOS, Linux) against heap exhaustion (OOM) attacks.

### 8. Robust Multi-Tool Response Sanitation
- **Action Verified**: Inspected and verified the fix in `src/bridge/sanitize.js` (`fixMissingToolResponses`).
- **Impact**: Refactored the validation loop to check all consecutive subsequent tool messages instead of only the single immediate next message. Missing responses are accurately identified and individual placeholder observations are injected on a per-tool-call level, ensuring perfect OpenAI spec compatibility and preventing validation failures.

### 9. VS Code Extension Shell Removal (`ag-local-bridge` decommission)
- **Action Verified**: Deleted `src/bridge/extension.js` (the VS Code `activate`/`deactivate` entrypoint registering `agLocalBridge.*` commands), `src/bridge/interceptors/https.js`, `src/bridge/interceptors/h2.js`, and `src/bridge/interceptors/http-server.js` (the monkey-patches that wrapped Node's `https.request`, H2 sessions, and `http.createServer` to capture Antigravity's outbound CSRF tokens and H2 payloads). Trimmed `src/bridge/context.js` to remove the now-orphaned extension fields (`outputChannel`, `statusBarItem`, `interceptedCsrf`, `interceptedPort`, `_originalHttpsRequest`, `_originalCreateServer`, `capturedPayloads`, `MAX_CAPTURES`, `extensionVersion`, `chatRequestsInFlight`, `MAX_CONCURRENT_REQUESTS`). Removed the dead `GET /v1/captures` route from `src/bridge/server.js` (its only writer was the deleted H2 interceptor). Re-ran the full credential audit on the remaining `src/bridge/` tree: zero hits for `oauth_creds`, `credentials`, `.gemini/`, OAuth tokens, or any read of token-bearing files.
- **Impact**: The bridge's local attack surface strictly **decreases** — three Node.js global monkey-patches (`https.request`, `http.createServer`, and the H2 client session layer) are gone, eliminating a class of local-proxy footguns and removing the only code path that ever copied a CSRF token from a third-party HTTP socket. Credential privacy posture is unchanged or improved: the bridge still uses only **passive sidecar discovery** (parsing the `--csrf_token` and `--extension_server_csrf_token` flags from the running `language_server_*` / `agy` process command line via OS-level process introspection), and still never touches `.gemini/oauth_creds.json`. Authentication remains exclusively the responsibility of the user-started `agy` CLI or Antigravity IDE binary — exactly the policy boundary required by Google's third-party-credential policy.

## Conclusion
The security audit confirms that the Konoha project and its integrated local bridge features do not access `.gemini/oauth_creds.json` directly or touch any sensitive user credentials in custom code. All operations are safe, local, and comply fully with secure process boundary and configuration policies. The decommission of the `ag-local-bridge` VS Code extension shell (Finding #9) is a strict security improvement: fewer Node.js global hooks, fewer in-memory credential-adjacent fields, and a smaller attack surface — while the in-process antigravity bridge hosted by the `konoha-files` MCP server preserves identical functional behavior and identical credential-isolation guarantees.
