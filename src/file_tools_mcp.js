#!/usr/bin/env node
/**
 * Konoha file-tools MCP server (stdio JSON-RPC).
 * Node.js orchestrates schemas; Python scripts perform streaming I/O.
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

process.on("unhandledRejection", (reason) => {
  try {
    process.stderr.write(`[mcp konoha] unhandledRejection: ${reason && reason.stack ? reason.stack : reason}\n`);
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
});

const SERVER_NAME = "konoha";
const SERVER_VERSION = (() => {
  const candidates = [
    path.join(__dirname, '..', 'package.json'),
    path.join(__dirname, 'package.json'),
    path.join(os.homedir(), '.konoha', 'package.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const v = JSON.parse(fs.readFileSync(c, 'utf8')).version;
        if (v) return v;
      } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
  return "2.0.0";
})();

// Support both dev (require bin/lib/paths) and deployed (~/.konoha/) contexts.
const devPaths = (() => {
  try { return require("../bin/lib/paths"); } catch { return null; }
})();
const DB_PATH = devPaths ? devPaths.DB_PATH : path.join(__dirname, 'konoha.db');

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



let activeClient = null;
let _cachedActiveClient = null;

/**
 * Detect active MCP client from environment variables (same logic as server.py detect_active_client).
 * Used as fallback when clientInfo is not available (e.g. standalone gateway mode).
 */
function detect_active_client_from_env() {
  if (_cachedActiveClient) return _cachedActiveClient;
  try {
    const cd = require("./mcp/client_detection");
    _cachedActiveClient = cd.detectActiveClient();
    return _cachedActiveClient;
  } catch (_) {
    return "unattributed";
  }
}

function getBaselineBytesForTool(toolName, args) {
  try {
    const filePath = args.path || args.file_path || args.filepath || args.dir;
    if (filePath) {
      const resolved = router.resolveInputPath(filePath);
      if (fs.existsSync(resolved)) {
        const st = fs.statSync(resolved);
        if (st.isFile()) return st.size;
        if (st.isDirectory()) {
          if (toolName === "find_files_clean") return 250000;
          // aislop-ignore-next-line ai-slop/hardcoded-id (tool/provider NAME list, not a deployment identifier)
          if (toolName === "token_efficient_grep") return 150000;
        }
      }
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  if (toolName === "find_files_clean") return 250000;
  // aislop-ignore-next-line ai-slop/hardcoded-id (tool/provider NAME list, not a deployment identifier)
  if (toolName === "token_efficient_grep") return 150000;
  // aislop-ignore-next-line ai-slop/hardcoded-id (tool/provider NAME list, not a deployment identifier)
  return 0;
}

let _savingsLogger = null;
function getSavingsLogger() {
  if (!_savingsLogger) {
    _savingsLogger = require("./tools_savings_logger");
  }
  return _savingsLogger;
}

function logToolCallSavings(toolName, args, returnedBytes) {
  try {
    const queryStr = JSON.stringify(args || {}).slice(0, 500);
    const baselineBytes = getBaselineBytesForTool(toolName, args || {});
    const client = activeClient || detect_active_client_from_env() || '';
    getSavingsLogger().log(toolName, queryStr, returnedBytes, client, baselineBytes);
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

    // Detect active client: explicit env override takes highest priority
    const envClient = (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || "").toLowerCase().trim();
    if (envClient) {
      if (envClient.includes("pi")) activeClient = "pi";
      else if (envClient.includes("claude")) activeClient = "claudecode";
      else if (envClient.includes("cursor")) activeClient = "cursor";
      else if (envClient.includes("opencode")) activeClient = "opencode";
      else if (envClient.includes("commandcode") || envClient.includes("command-code")) activeClient = "commandcode";
      else if (envClient.includes("codex") || envClient.includes("openai")) activeClient = "codex";
      else if (envClient.includes("agy") || envClient.includes("antigravity-cli")) activeClient = "agy";
      else if (envClient.includes("antigravity") || envClient.includes("ide")) activeClient = "antigravity";
    }

    if (!activeClient) {
      const client_info = params.clientInfo || {};
      const client_name = (client_info.name || "").toLowerCase();
      if (
        client_name === "pi" ||
        client_name.startsWith("pi-mcp") ||
        client_name.includes("pi-mcp") ||
        client_name.includes("pi.dev") ||
        client_name.includes("pi-coding-agent")
      ) {
        activeClient = "pi";
      } else if (client_name.indexOf("cursor") !== -1) {
        activeClient = "cursor";
      } else if (client_name.indexOf("claude") !== -1) {
        activeClient = "claudecode";
      } else if (client_name.indexOf("opencode") !== -1) {
        activeClient = "opencode";
      } else if (client_name.indexOf("commandcode") !== -1 || client_name.indexOf("command-code") !== -1) {
        activeClient = "commandcode";
      } else if (client_name.indexOf("codex") !== -1 || client_name.indexOf("openai") !== -1) {
        activeClient = "codex";
      } else if (client_name.indexOf("antigravity-cli") !== -1 || client_name.indexOf("agy") !== -1) {
        activeClient = "agy";
      } else if (client_name.indexOf("antigravity") !== -1 || client_name.indexOf("ide") !== -1) {
        activeClient = "antigravity";
      }
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
    if (!root) {
      const cwd = process.cwd();
      if (cwd && !router.isIdeInstallationDirectory(cwd)) {
        root = cwd;
      }
    }

    router.setWorkspaceRoot(root);
    try {
      const runtimeState = require("./mcp/runtime_state");
      runtimeState.setWorkspaceRoot(root);
      runtimeState.setActiveClient(activeClient);

      let sessId = '';
      if (activeClient === 'agy' || activeClient === 'antigravity') {
        sessId = process.env.ANTIGRAVITY_CONVERSATION_ID || '';
      } else if (activeClient === 'claudecode') {
        sessId = process.env.CLAUDE_CONVERSATION_ID || process.env.CLAUDE_CODE_SESSION_ID || '';
      } else if (activeClient === 'pi') {
        sessId = process.env.PI_SESSION_ID || '';
        if (!sessId && process.env.PI_SESSION_FILE) {
          try {
            sessId = path.basename(process.env.PI_SESSION_FILE, path.extname(process.env.PI_SESSION_FILE));
          } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
        }
      } else if (activeClient === 'cursor') {
        sessId = process.env.CURSOR_SESSION_ID || '';
      } else if (activeClient === 'opencode') {
        sessId = process.env.OPENCODE_SESSION_ID || '';
      } else if (activeClient === 'commandcode') {
        sessId = process.env.COMMANDCODE_SESSION_ID || '';
      } else if (activeClient === 'codex') {
        sessId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION || '';
      }

      if (!sessId) {
        sessId = `sess_${activeClient || 'unknown'}_${Date.now().toString(36)}_${process.pid}`;
      }
      runtimeState.setActiveSessionId(sessId);

      const db = require("./db");
      const conn = db.getConnection();
      conn.prepare(`
        INSERT OR REPLACE INTO active_sessions (client, workspace_root, session_id, last_active_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(activeClient || 'unknown', root || process.cwd(), sessId);
      conn.close();
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }

    initialized = true;
    process.stderr.write(
      `[mcp ${SERVER_NAME}] Initialized workspace: ${router.getWorkspaceRoot()} (client: ${activeClient})\n`,
    );

    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiatedProtocol,
        capabilities: { tools: {}, resources: {}, prompts: {} },
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

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }

  if (method === "resources/templates/list") {
    return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
  }

  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
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

    let text, isError;
    try {
      ({ text, isError } = router.dispatchTool(toolName, args));
    } catch (err) {
      // Answer with the request id so clients can correlate the failure
      text = JSON.stringify({ error: `Tool execution failed: ${err.message}` });
      isError = true;
    }
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
  let conn = null;
  try {
    const db = require("./db");
    conn = db.getConnection();
    const rows = conn.prepare("SELECT name, port, provider, enabled, target_url AS targetUrl, api_key AS apiKey FROM bridges").all();
    const existing = rows.map(r => ({
      name: r.name,
      port: r.port,
      provider: r.provider,
      enabled: Boolean(r.enabled),
      targetUrl: r.targetUrl,
      apiKey: r.apiKey
    }));
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
  } catch (err) {
    process.stderr.write(`[mcp ${SERVER_NAME}] SQLite bridge load error: ${err.message}\n`);
    return [];
  } finally {
    if (conn) {
      try { conn.close(); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
  }
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
    for (const key of Object.keys(require.cache)) {
      if (key.includes('/bridge/') || key.includes('\\bridge\\')) {
        delete require.cache[key];
      }
    }
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

    function checkPortListening(port) {
      const net = require("net");
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(300);
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("timeout", () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, "127.0.0.1");
      });
    }

    // External Antigravity extensions own port 1313; if active, expose to gateway.
    // If not listening, start the embedded bridge server on port 1313 so localhost:1313 is always live.
    for (const b of externalBridges) {
      const port = b.port || 1313;
      const existing = activeBridges.get(b.name);
      if (existing && existing.ctx && !existing.external) {
        // Embedded bridge is already running for this external bridge; keep it running.
        continue;
      }
      const isListening = await checkPortListening(port);
      if (isListening) {
        activeBridges.set(b.name, { bridgeConfig: b, external: true });
      } else {
        const ctx = createContext();
        ctx.bridgeConfig = b;
        ctx.outputChannel = {
          appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\n`),
          show: () => {},
          dispose: () => {},
        };
        try {
          await startServer(ctx);
          activeBridges.set(b.name, { bridgeConfig: b, ctx, external: false });
        } catch (err) {
          if (err.message.includes("EADDRINUSE")) {
            activeBridges.set(b.name, { bridgeConfig: b, external: true });
          } else {
            process.stderr.write(`[bridge:${b.name}] Failed to start bridge server: ${err.message}\n`);
          }
        }
      }
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
          // Hoisted so the catch block below can reference the bridge context
          // when startServer fails (e.g. the expected EADDRINUSE-on-reload path).
          let ctx = null;
          try {
            await stopServer(active.ctx);
            // Wait for OS to release the TCP socket (TIME_WAIT / SO_REUSEADDR).
            // Without this, startServer may try to bind the same port before
            // the kernel has fully freed it, causing EADDRINUSE on reload.
            await new Promise((r) => setTimeout(r, 200));
            process.stderr.write(
              `[bridge:${b.name}] Old server stopped. Starting on port ${b.port} (${b.provider})...\n`,
            );

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
  // Only start the local bridge servers and gateway if running as the dedicated KONOHA_DAEMON.
  // When running as an interactive/stdio MCP server inside an IDE/CLI, we do NOT bind HTTP ports
  // (19999, 1313, 11437) to prevent port-locking, so 'konoha bridge start/stop/restart' can freely
  // manage the background bridge daemon without interference or stale in-memory module caching.
  let pollInterval = null;
  let watcher = null;

  if (process.env.KONOHA_DAEMON === 'true') {
    syncBridges()
      .then(() => {
        const { startGateway } = require("./bridge/gateway");
        return startGateway(activeBridges, 19999);
      })
      .catch((err) => {
        process.stderr.write(`[bridge] Initial sync / gateway failed: ${err.message}\n`);
      });

    // Periodically check SQLite database for updates (every 5 seconds)
    pollInterval = setInterval(() => {
      syncBridges().catch((err) => {
        process.stderr.write(`[bridge] Polling sync failed: ${err.message}\n`);
      });
    }, 5000);

    // Watch konoha.db for instant response
    const fs = require("fs");


    const dbPath = DB_PATH;
    if (fs.existsSync(dbPath)) {
      try {
        watcher = fs.watch(dbPath, (eventType) => {
          if (eventType === "change") {
            syncBridges().catch(() => {});
          }
        });
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
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
      } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
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
