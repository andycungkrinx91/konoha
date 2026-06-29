'use strict';

const { randomUUID } = require('crypto');

/**
 * Shared mutable state for the in-process Konoha bridge (was: AG Local Bridge extension).
 *
 * Previously bundled the full VS Code extension state (output channel, status bar,
 * H2 interceptor captures, captured CSRF tokens). After the VS Code extension
 * was retired, only the fields actually consumed by the in-process HTTP server,
 * sidecar, and Cascade remain.
 */
function createContext() {
  return {
    // Identity (for Metadata proto payloads)
    sessionId: randomUUID() + Date.now().toString(),

    // Bridge configuration (assigned by file_tools_mcp.js from bridges.json)
    bridgeConfig: null,

    // HTTP server
    /** @type {import('http').Server | null} */
    server: null,

    // Sidecar discovery cache (consumed by sidecar/discovery.js)
    sidecarInfo: null,
    sidecarInfoTimestamp: 0,
    SIDECAR_CACHE_TTL: 300000, // 5 minutes (discovery is expensive on Windows)

    // Rate limiting / loop-breaking (consumed by handlers/openai.js)
    lastResponseTimestamp: 0,
    MIN_REQUEST_INTERVAL_MS: 200, // 200ms cooldown between responses
    lastUserMessageHash: '',
    lastUserMessageTimestamp: 0,
    DEDUP_WINDOW_MS: 1000, // 1s dedup window

    // Cascade conversation state (consumed by sidecar/cascade.js)
    isWorkspaceSwitching: false,
    activeCascades: new Map(), // convKey -> { id, lastUsed }
    cascadePromises: new Map(), // convKey -> Promise<string>
  };
}

module.exports = { createContext };
