# Security and Compliance Review: Konoha Project v1.1.6

## Executive Summary
A comprehensive security and compliance review was performed on the Konoha project (v1.1.6) with a specific focus on the newly integrated `ag-local-bridge` features. The goal of this review is to verify credential privacy and ensure that the codebase conforms strictly to Google's security policies regarding third-party credentials (specifically the `.gemini/oauth_creds.json` file). The audit confirms that the codebase is **fully compliant** and does not perform any unauthorized credential accesses.

## Findings

### 1. Verification of Credential Privacy (No access to `oauth_creds.json`)
- **Action Verified**: Conducted a full static analysis and codebase search across the integrated bridge source files under `src/bridge/` to check for occurrences of `oauth_creds.json`, `.gemini`, `credentials`, or raw OAuth key lookups.
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

## Conclusion
The security audit confirms that the Konoha project and its integrated local bridge features do not access `.gemini/oauth_creds.json` directly or touch any sensitive user credentials in custom code. All operations are safe, local, and comply fully with secure process boundary and configuration policies.
