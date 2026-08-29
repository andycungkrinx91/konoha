#!/usr/bin/env node
/**
 * Konoha file-tools MCP server (stdio JSON-RPC).
 * Node.js orchestrates schemas; Python scripts perform streaming I/O.
 */
const Module = require("module");
const fs = require("fs");
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
const SERVER_VERSION = "2.0.0";

// Support both dev (require bin/lib/paths) and deployed (~/.konoha/) contexts.
const devPaths = (() => {
  try { return require("../bin/lib/paths"); } catch(_) { return null; }
})();
const DB_PATH = devPaths ? devPaths.DB_PATH : path.join(__dirname, 'skills.db');
const DB_BRIDGES_PY_PATH = devPaths ? devPaths.DB_BRIDGES_PY_PATH : path.join(__dirname, 'db_bridges.py');

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

const { spawn } = require("child_process");
const PYTHON_CMD = process.env.PYTHON_CMD || "python3";
const SAVINGS_LOGGER = path.join(__dirname, "tools_savings_logger.py");

let activeClient = null;

/**
 * Detect active MCP client from environment variables (same logic as server.py detect_active_client).
 * Used as fallback when clientInfo is not available (e.g. standalone gateway mode).
 */
function detect_active_client_from_env() {
  try {
    const os = require("os");
    const HOME = os.homedir();
    const ANTIGRAVITY_CLI_BRAIN = path.join(HOME, ".gemini", "antigravity-cli", "brain");
    const ANTIGRAVITY_IDE_BRAIN = path.join(HOME, ".gemini", "antigravity-ide", "brain");
    const CURSOR_PROJECTS = path.join(HOME, ".cursor", "projects");
    const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");

    // Check environment variable first to distinguish CLI (agy) vs IDE (antigravity)
    const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
    if (convId) {
      const cliDir = path.join(ANTIGRAVITY_CLI_BRAIN, convId);
      const ideDir = path.join(ANTIGRAVITY_IDE_BRAIN, convId);
      if (require("fs").existsSync(cliDir)) return "agy";
      if (require("fs").existsSync(ideDir)) return "antigravity";
    }

    if (process.env.OPENCODE_CLIENT === "1" || process.env.OPENCODE_SESSION === "1") {
      return "opencode";
    }

    if (process.env.COMMANDCODE_CLIENT === "1" || process.env.COMMANDCODE_SESSION === "1") {
      return "commandcode";
    }

    if (process.env.CLAUDE_CODE_CHILD_SESSION === "1") {
      return "claudecode";
    }

    if (convId) return "antigravity";

    // Fallback to file detection without shell utilities for cross-platform safety.
    const files = [];
    const collectFiles = (directory, predicate, depth = 0) => {
      if (depth > 15 || files.length >= 100) return;
      let entries;
      try { entries = require("fs").readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        if (files.length >= 100) return;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectFiles(entryPath, predicate, depth + 1);
        else if (entry.isFile() && predicate(entryPath)) files.push(entryPath);
      }
    };
    [
      ANTIGRAVITY_IDE_BRAIN,
      ANTIGRAVITY_CLI_BRAIN,
      CURSOR_PROJECTS,
      CLAUDE_PROJECTS,
    ].forEach((brainDir) => {
      if (!require("fs").existsSync(brainDir)) return;
      const isCursor = brainDir.includes("cursor");
      const isClaude = brainDir.includes("claude");
      if (isCursor) {
        collectFiles(brainDir, (filePath) => filePath.endsWith('.jsonl') && filePath.includes(`${path.sep}agent-transcripts${path.sep}`));
      } else if (isClaude) {
        collectFiles(brainDir, (filePath) => filePath.endsWith('.jsonl'));
      } else {
        collectFiles(brainDir, (filePath) => path.basename(filePath) === 'prompt.md' || filePath.endsWith(`${path.sep}.system_generated${path.sep}logs${path.sep}transcript.jsonl`));
      }
    });

    if (!files.length) return "antigravity";
    // Sort by mtime descending
    files.sort((a, b) => {
      const mtA = require("fs").statSync(a).mtimeMs;
      const mtB = require("fs").statSync(b).mtimeMs;
      return mtB - mtA;
    });
    const mostRecent = files[0];
    if (mostRecent.includes("cursor")) return "cursor";
    if (mostRecent.includes("claude")) return "claudecode";
    if (mostRecent.includes("antigravity-cli")) return "agy";
    return "antigravity";
  } catch (_) {}
  return "antigravity";
}

function getBaselineBytesForTool(toolName, args) {
  try {
    const filePath = args.path || args.file_path || args.filepath || args.dir;
    if (filePath) {
      const resolved = router.resolveInputPath(filePath);
      if (fs.existsSync(resolved)) {
        const st = fs.statSync(resolved);
        if (st.isFile()) return st.size;
      }
    }
  } catch (_) {}
  return 0;
}

function logToolCallSavings(toolName, args, returnedBytes) {
  // Fire-and-forget: spawn detached so the stdio event loop never stalls.
  try {
    const queryStr = JSON.stringify(args || {}).slice(0, 500);
    const baselineBytes = getBaselineBytesForTool(toolName, args || {});
    spawn(
      PYTHON_CMD,
      [
        SAVINGS_LOGGER,
        toolName,
        queryStr,
        String(returnedBytes),
        (activeClient || detect_active_client_from_env() || ''),
        String(baselineBytes || 0)
      ],
      { stdio: "ignore", detached: true },
    ).unref();
  } catch (_) {
    /* router must never break because the logger hiccupped */
  }
}

let initialized = false;
let negotiatedProtocol = "2024-11-05";
const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2024-10-07", "2025-03-26", "2025-11-25", "2025-06-18", "0.1.0", "1.0.0"];

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
    const requestedProtocol = params.protocolVersion || SUPPORTED_PROTOCOL_VERSIONS[0];
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(requestedProtocol)) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unsupported protocol version: ${requestedProtocol}` } };
    }
    negotiatedProtocol = requestedProtocol;

    // Detect active client from clientInfo (mirrors server.py logic)
    const client_info = params.clientInfo || {};
    const client_name = (client_info.name || "").toLowerCase();
    if (client_name.indexOf("cursor") !== -1) {
      activeClient = "cursor";
    } else if (client_name.indexOf("claude") !== -1) {
      activeClient = "claudecode";
    } else if (client_name.indexOf("opencode") !== -1) {
      activeClient = "opencode";
    } else if (client_name.indexOf("commandcode") !== -1) {
      activeClient = "commandcode";
    } else if (client_name.indexOf("antigravity-cli") !== -1 || client_name.indexOf("agy") !== -1) {
      activeClient = "agy";
    } else if (client_name.indexOf("antigravity") !== -1 || client_name.indexOf("ide") !== -1) {
      activeClient = "antigravity";
    }
    // If clientInfo was empty/unknown, fall back to env-based detection
    if (!activeClient) {
      activeClient = detect_active_client_from_env();
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

  if ((method === "tools/list" || method === "tools/call") && !initialized) {
    return { jsonrpc: "2.0", id, error: { code: -32002, message: "Server is not initialized" } };
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
    const retBytes = Buffer.byteLength(text, "utf8");
    logToolCallSavings(toolName, args, retBytes);
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
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
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
      return existing.map((b) => {
        if (b.provider === 'antigravity-extension' && !b.targetUrl) {
          b.targetUrl = 'http://127.0.0.1:1313';
        }
        return b;
      });
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
    const embeddedBridges = enabledBridges.filter((b) => b.provider !== 'antigravity-extension');
    const externalBridges = enabledBridges.filter((b) => b.provider === 'antigravity-extension');
    const enabledNames = new Set(enabledBridges.map((b) => b.name));

    // 1. Stop bridges that are no longer enabled or deleted.
    for (const name of activeBridges.keys()) {
      const active = activeBridges.get(name);
      const stillEnabled = enabledNames.has(name);
      if (!stillEnabled) {
        process.stderr.write(`[bridge:${name}] Stopping bridge (bridge disabled in bridges.json).\n`);
        try {
          if (active.ctx) await stopServer(active.ctx);
          process.stderr.write(`[bridge:${name}] Bridge server stopped.\n`);
        } catch (err) {
          process.stderr.write(`[bridge:${name}] Error stopping server: ${err.message}\n`);
        }
        activeBridges.delete(name);
      }
    }

    // External Antigravity extensions own their HTTP server; expose them to
    // the aggregate gateway without spawning an embedded replacement.
    for (const b of externalBridges) {
      const existing = activeBridges.get(b.name);
      if (existing && !existing.external && existing.ctx) {
        try { await stopServer(existing.ctx); } catch {}
      }
      activeBridges.set(b.name, { bridgeConfig: b, external: true });
    }

    // 2. Start or reload embedded bridges.
    for (const b of embeddedBridges) {
      let active = activeBridges.get(b.name);
      if (active?.external) {
        activeBridges.delete(b.name);
        active = null;
      }
      if (!active) {
        // Start new bridge
        const ctx = createContext();
        ctx.bridgeConfig = b;
        ctx.outputChannel = {
          appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\n`),
          show: () => {},
          dispose: () => {},
        };
        // Suppress verbose "starting" messages — just attempt the bind.
        // Conflicts are expected in multi-launcher setups.
        try {
          await startServer(ctx);
          activeBridges.set(b.name, { bridgeConfig: b, ctx });
        } catch (err) {
          if (err.message.includes('EADDRINUSE')) {
            activeBridges.set(b.name, { bridgeConfig: b, ctx });
            // Port conflict is expected when another daemon/IDE instance manages this bridge.
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

            let ctx = null;
            ctx = createContext();
            ctx.bridgeConfig = b;
            ctx.outputChannel = {
              appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\\n`),
              show: () => {},
              dispose: () => {},
            };

            await startServer(ctx);
            activeBridges.set(b.name, { bridgeConfig: b, ctx });
          } catch (err) {
            if (err.message.includes('EADDRINUSE') && ctx) {
              activeBridges.set(b.name, { bridgeConfig: b, ctx });
              // Port conflict during reload is expected when another daemon owns it.
            } else {
              process.stderr.write(`[bridge:${b.name}] Error during reload: ${err.message}\\n`);
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
