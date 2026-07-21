#!/usr/bin/env node
/**
 * Konoha file-tools MCP server (stdio JSON-RPC).
 * Node.js orchestrates schemas; Python scripts perform streaming I/O.
 */
const Module = require("module");
const path = require("path");

// Hook 'vscode' module resolution for bridge compatibility
const originalResolveFilename = Module._resolveFilename;
const vscodeMockPath = path.join(__dirname, "bridge", "vscode-mock.js");
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "vscode") {
    return vscodeMockPath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const readline = require("readline");

const SERVER_NAME = "konoha";
const SERVER_VERSION = "1.1.6";

const { DB_BRIDGES_PY_PATH, DB_PATH } = require("../bin/lib/paths");

let router;
try {
  router = require("./file_tools_router");
} catch (err) {
  process.stderr.write(
    `[mcp ${SERVER_NAME}] FATAL: cannot load router: ${err.message}\n`,
  );
  process.exit(1);
}

const installErrors = router.validateInstall();
if (installErrors.length) {
  process.stderr.write(
    `[mcp ${SERVER_NAME}] FATAL: incomplete install: ${installErrors.join("; ")}\n`,
  );
  process.exit(1);
}

let initialized = false;
let negotiatedProtocol = "2024-11-05";

function handleRequest(req) {
  const method = req.method;
  const id = req.id;

  if (id === undefined && method && method.startsWith("notifications/")) {
    if (method === "notifications/initialized") {
      initialized = true;
    }
    return null;
  }

  if (method === "initialize") {
    const params = req.params || {};
    if (params.protocolVersion) {
      negotiatedProtocol = params.protocolVersion;
    }

    let root = null;
    if (params.rootUri) {
      root = router.uriToPath(params.rootUri);
    }
    if (
      !root &&
      Array.isArray(params.workspaceFolders) &&
      params.workspaceFolders[0]
    ) {
      root = router.uriToPath(params.workspaceFolders[0].uri);
    }
    if (!root && params.rootPath) {
      root = router.uriToPath(params.rootPath);
    }

    router.setWorkspaceRoot(root);
    initialized = true;
    process.stderr.write(
      `[mcp ${SERVER_NAME}] Initialized workspace: ${router.getWorkspaceRoot()}\n`,
    );

    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiatedProtocol,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }

  if (method === "notifications/initialized") {
    initialized = true;
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: router.listToolSchemas() },
    };
  }

  if (method === "tools/call") {
    const params = req.params || {};
    const toolName = params.name;
    const args = params.arguments || {};
    process.stderr.write(
      `[mcp ${SERVER_NAME}] tool_call: ${toolName}(${JSON.stringify(args)})\n`,
    );

    const { text, isError } = router.dispatchTool(toolName, args);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }],
        isError: Boolean(isError),
      },
    };
  }

  if (id !== undefined) {
    return { jsonrpc: "2.0", id, result: {} };
  }
  return null;
}

function loadBridgesFromMcp() {
  const { spawnSync } = require("child_process");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const localBridges = path.join(__dirname, "db_bridges.py");
  const dbScript = fs.existsSync(localBridges)
    ? localBridges
    : DB_BRIDGES_PY_PATH;
  const python = process.env.PYTHON_CMD || "python3";

  try {
    const res = spawnSync(python, [dbScript, "--list"], { encoding: "utf-8" });
    if (res.status === 0 && res.stdout) {
      const existing = JSON.parse(res.stdout);
      for (const b of existing) {
        if (!b.targetUrl || b.provider !== "openai") continue;
        try {
          const u = new URL(b.targetUrl);
          const isLoopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
          if (u.protocol !== "https:" && !isLoopback) {
            process.stderr.write(`[mcp ${SERVER_NAME}] bridge "${b.name}" targetUrl must be https:// — refusing to load (got ${u.protocol})\n`);
            b.disabled = true;
          }
        } catch {
          b.disabled = true;
        }
      }
      return existing;
    }
  } catch (err) {
    process.stderr.write(`[mcp ${SERVER_NAME}] SQLite bridge load error: ${err.message}\n`);
  }
  return [];
}

const activeBridges = new Map();

let isSyncing = false;
let syncPending = false;

async function syncBridges() {
  if (isSyncing) {
    syncPending = true;
    return;
  }
  isSyncing = true;

  try {
    const { createContext } = require("./bridge/context");
    const { startServer, stopServer } = require("./bridge/server");

    const bridges = loadBridgesFromMcp();
    const enabledBridges = bridges.filter((b) => b.enabled);
    const enabledNames = new Set(enabledBridges.map((b) => b.name));

    // 1. Stop bridges that are no longer enabled or deleted.
    for (const name of activeBridges.keys()) {
      const active = activeBridges.get(name);
      const stillEnabled = enabledNames.has(name);
      if (!stillEnabled) {
        process.stderr.write(`[bridge:${name}] Stopping bridge (bridge disabled in bridges.json).\n`);
        try {
          await stopServer(active.ctx);
          process.stderr.write(`[bridge:${name}] Bridge server stopped.\n`);
        } catch (err) {
          process.stderr.write(`[bridge:${name}] Error stopping server: ${err.message}\n`);
        }
        activeBridges.delete(name);
      }
    }

    // 2. Start or reload bridges
    for (const b of enabledBridges) {
      const active = activeBridges.get(b.name);
      if (!active) {
        // Start new bridge
        const ctx = createContext();
        ctx.bridgeConfig = b;
        ctx.outputChannel = {
          appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\n`),
          show: () => {},
          dispose: () => {},
        };
        process.stderr.write(
          `[bridge:${b.name}] Bridge enabled; starting server on port ${b.port} (${b.provider})...\n`,
        );
        try {
          await startServer(ctx);
          activeBridges.set(b.name, { bridgeConfig: b, ctx });
          process.stderr.write(
            `[bridge:${b.name}] Server successfully started and listening on port ${b.port}\n`,
          );
        } catch (err) {
          if (err.message.includes('EADDRINUSE')) {
            activeBridges.set(b.name, { bridgeConfig: b, ctx });
            process.stderr.write(
              `[bridge:${b.name}] Port ${b.port} is already in use. Assuming external service is running and registering with gateway.\n`,
            );
          } else {
            process.stderr.write(
              `[bridge:${b.name}] Failed to start bridge server: ${err.message}\n`,
            );
          }
        }
      } else {
        // Check if config has changed
        const oldConfig = active.bridgeConfig;
        const configChanged =
          oldConfig.port !== b.port ||
          oldConfig.provider !== b.provider ||
          oldConfig.targetUrl !== b.targetUrl ||
          oldConfig.apiKey !== b.apiKey;

        if (configChanged) {
          process.stderr.write(`[bridge:${b.name}] Configuration changed. Reloading...\n`);
          try {
            await stopServer(active.ctx);
            // Wait for OS to release the TCP socket (TIME_WAIT / SO_REUSEADDR).
            // Without this, startServer may try to bind the same port before
            // the kernel has fully freed it, causing EADDRINUSE on reload.
            await new Promise((r) => setTimeout(r, 200));
            process.stderr.write(
              `[bridge:${b.name}] Old server stopped. Starting on port ${b.port} (${b.provider})...\n`,
            );

            const ctx = createContext();
            ctx.bridgeConfig = b;
            ctx.outputChannel = {
              appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\n`),
              show: () => {},
              dispose: () => {},
            };

            await startServer(ctx);
            activeBridges.set(b.name, { bridgeConfig: b, ctx });
            process.stderr.write(
              `[bridge:${b.name}] Server reloaded and listening on port ${b.port}\n`,
            );
          } catch (err) {
            if (err.message.includes('EADDRINUSE')) {
              activeBridges.set(b.name, { bridgeConfig: b, ctx });
              process.stderr.write(
                `[bridge:${b.name}] Port ${b.port} is already in use. Assuming external service is running and registering with gateway.\n`,
              );
            } else {
              process.stderr.write(`[bridge:${b.name}] Error during reload: ${err.message}\n`);
              activeBridges.delete(b.name);
            }
          }
        }
      }
    }
  } finally {
    isSyncing = false;
    if (syncPending) {
      syncPending = false;
      syncBridges().catch((err) => {
        process.stderr.write(`[bridge] Pending sync failed: ${err.message}\n`);
      });
    }
  }
}

function main() {
  // Start the local bridge servers in-process and monitor for changes
  syncBridges()
    .then(() => {
      const { startGateway } = require("./bridge/gateway");
      return startGateway(activeBridges, 19999);
    })
    .catch((err) => {
      process.stderr.write(`[bridge] Initial sync / gateway failed: ${err.message}\n`);
    });

  // Periodically check SQLite database for updates (every 5 seconds)
  const pollInterval = setInterval(() => {
    syncBridges().catch((err) => {
      process.stderr.write(`[bridge] Polling sync failed: ${err.message}\n`);
    });
  }, 5000);

  // Watch skills.db for instant response
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dbPath = DB_PATH;
  let watcher = null;
  if (fs.existsSync(dbPath)) {
    try {
      watcher = fs.watch(dbPath, (eventType) => {
        if (eventType === "change") {
          syncBridges().catch(() => {});
        }
      });
    } catch (e) {}
  }

  if (process.env.KONOHA_DAEMON !== "true") {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    rl.on("close", () => {
      if (pollInterval) clearInterval(pollInterval);
      if (watcher) watcher.close();
      try {
        const { stopGateway } = require("./bridge/gateway");
        stopGateway().catch(() => {});
      } catch (e) {}
      process.exit(0);
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed);
        const response = handleRequest(req);
        if (response) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      } catch (err) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: `Parse error: ${err.message}` },
          })}\n`,
        );
      }
    });
  }

  process.on("uncaughtException", (err) => {
    process.stderr.write(
      `[mcp ${SERVER_NAME}] uncaughtException: ${err.message}\n`,
    );
  });
}

if (require.main === module) {
  main();
}

module.exports = { handleRequest, SERVER_NAME, SERVER_VERSION };
