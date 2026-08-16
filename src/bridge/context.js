'use strict';

const { randomUUID } = require('crypto');

/**
 * Shared mutable state for the embedded, headless Konoha bridge.
 *
 * The external konoha-bridge project is an Antigravity IDE extension and is not
 * started through this context; it owns its own HTTP server on port 1313.
 * The embedded bridge keeps only the fields consumed by its HTTP server,
 * sidecar, and Cascade.
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
