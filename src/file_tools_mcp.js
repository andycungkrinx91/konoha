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

const TOOL_DEFAULT_BASELINES = {
  find_files_clean: 250000,
  token_efficient_grep: 150000
};

function getBaselineBytesForTool(toolName, args) {
  try {
    const filePath = args.path || args.file_path || args.filepath || args.dir || args.directory || args.target;
    if (!filePath) return TOOL_DEFAULT_BASELINES[toolName] || 0;
    const resolved = router.resolveInputPath(filePath);
    if (!fs.existsSync(resolved)) return TOOL_DEFAULT_BASELINES[toolName] || 0;
    const st = fs.statSync(resolved);
    return st.isFile() ? st.size : (TOOL_DEFAULT_BASELINES[toolName] || 0);
  } catch (_) {
    return TOOL_DEFAULT_BASELINES[toolName] || 0;
  }
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

function detectClientFromInfoOrEnv(params) {
  const envClient = (process.env.ACTIVE_CLIENT || process.env.KONOHA_CLIENT || "").toLowerCase().trim();
  if (envClient) {
    if (envClient.includes("pi")) return "pi";
    if (envClient.includes("claude")) return "claudecode";
    if (envClient.includes("cursor")) return "cursor";
    if (envClient.includes("opencode")) return "opencode";
    if (envClient.includes("commandcode") || envClient.includes("command-code")) return "commandcode";
    if (envClient.includes("codex") || envClient.includes("openai")) return "codex";
    if (envClient.includes("omp")) return "omp";
    if (envClient.includes("agy") || envClient.includes("antigravity-cli")) return "agy";
    if (envClient.includes("antigravity") || envClient.includes("ide")) return "antigravity";
  }

  const client_info = params.clientInfo || {};
  const client_name = (client_info.name || "").toLowerCase();
  if (client_name === "pi" || client_name.startsWith("pi-mcp") || client_name.includes("pi-mcp") || client_name.includes("pi.dev") || client_name.includes("pi-coding-agent")) {
    return "pi";
  }
  if (client_name.includes("cursor")) return "cursor";
  if (client_name.includes("claude")) return "claudecode";
  if (client_name.includes("opencode")) return "opencode";
  if (client_name.includes("commandcode") || client_name.includes("command-code")) return "commandcode";
  if (client_name.includes("codex") || client_name.includes("openai")) return "codex";
  if (client_name.includes("omp")) return "omp";
  if (client_name.includes("antigravity-cli") || client_name.includes("agy")) return "agy";
  if (client_name.includes("antigravity") || client_name.includes("ide")) return "antigravity";

  return detect_active_client_from_env();
}

function resolveWorkspaceRootFromParams(params) {
  if (params.rootUri) return router.uriToPath(params.rootUri);
  if (Array.isArray(params.workspaceFolders) && params.workspaceFolders[0]) {
    return router.uriToPath(params.workspaceFolders[0].uri);
  }
  if (params.rootPath) return router.uriToPath(params.rootPath);
  const cwd = process.cwd();
  return (cwd && !router.isIdeInstallationDirectory(cwd)) ? cwd : null;
}

function resolveSessionIdForClient(client) {
  if (client === 'agy' || client === 'antigravity') return process.env.ANTIGRAVITY_CONVERSATION_ID || '';
  if (client === 'claudecode') return process.env.CLAUDE_CONVERSATION_ID || process.env.CLAUDE_CODE_SESSION_ID || '';
  if (client === 'pi') {
    let sessId = process.env.PI_SESSION_ID || '';
    if (!sessId && process.env.PI_SESSION_FILE) {
      try { sessId = path.basename(process.env.PI_SESSION_FILE, path.extname(process.env.PI_SESSION_FILE)); } catch (_) { /* ignore */ }
    }
    return sessId;
  }
  if (client === 'cursor') return process.env.CURSOR_SESSION_ID || '';
  if (client === 'opencode') return process.env.OPENCODE_SESSION_ID || '';
  if (client === 'commandcode') return process.env.COMMANDCODE_SESSION_ID || '';
  if (client === 'codex') return process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION || '';
  if (client === 'omp') return process.env.OMP_SESSION_ID || process.env.OMP_AGENT_ID || '';
  return '';
}

function recordActiveSession(client, root) {
  try {
    const runtimeState = require("./mcp/runtime_state");
    runtimeState.setWorkspaceRoot(root);
    runtimeState.setActiveClient(client);

    let sessId = resolveSessionIdForClient(client);
    if (!sessId) sessId = `sess_${client || 'unknown'}_${Date.now().toString(36)}_${process.pid}`;
    runtimeState.setActiveSessionId(sessId);

    const personaMemory = require("./persona_memory");
    const effectiveRoot = root || process.cwd();
    const pHash = personaMemory.computeProjectHash(effectiveRoot);
    try { personaMemory.saveOrUpdateProject(effectiveRoot); } catch (_) { /* non-fatal */ }

    const db = require("./db");
    const conn = db.getConnection();
    conn.prepare(`
      INSERT INTO active_sessions (client, workspace_root, session_id, project_hash, last_active_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(client, workspace_root, session_id) DO UPDATE SET
        last_active_at = excluded.last_active_at,
        project_hash = COALESCE(excluded.project_hash, active_sessions.project_hash)
    `).run(client || 'unknown', effectiveRoot, sessId, pHash);
    conn.close();
  } catch (_) { /* best-effort */ }
}

function handleInitialize(id, params) {
  const requestedProtocol = params.protocolVersion || SUPPORTED_PROTOCOL_VERSIONS[0];
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(requestedProtocol)) {
    return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unsupported protocol version: ${requestedProtocol}` } };
  }
  negotiatedProtocol = requestedProtocol;
  activeClient = detectClientFromInfoOrEnv(params);

  const root = resolveWorkspaceRootFromParams(params);
  router.setWorkspaceRoot(root);
  recordActiveSession(activeClient, root);

  initialized = true;
  process.stderr.write(`[mcp ${SERVER_NAME}] Initialized workspace: ${router.getWorkspaceRoot()} (client: ${activeClient})\n`);

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

function parseToolArguments(toolName, rawArgs) {
  let args = rawArgs;
  if (args === undefined || args === null) args = {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch (_) {
      const AGENT_DELEGATION_TOOLS = ['genin', 'kage', 'jonin', 'anbu', 'chunin', 'tokubetsu_jonin', 'sannin', 'akatsuki'];
      if (AGENT_DELEGATION_TOOLS.includes(toolName)) {
        args = { task: args.trim() };
      }
    }
  }
  return args;
}

function handleToolCall(id, params) {
  const toolName = params.name;
  const args = parseToolArguments(toolName, params.arguments);
  process.stderr.write(`[mcp ${SERVER_NAME}] tool_call: ${toolName}(${JSON.stringify(args)})\n`);

  let text, isError;
  try {
    ({ text, isError } = router.dispatchTool(toolName, args));
  } catch (err) {
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

function handleRequest(req) {
  const { method, id, params = {} } = req;

  if (id === undefined && method?.startsWith("notifications/")) {
    if (method === "notifications/initialized") initialized = true;
    return null;
  }

  if (method === "initialize") return handleInitialize(id, params);
  if (method === "notifications/initialized") { initialized = true; return null; }

  if ((method === "tools/list" || method === "tools/call") && !initialized) {
    return { jsonrpc: "2.0", id, error: { code: -32002, message: "Server is not initialized" } };
  }

  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [] } };
  if (method === "resources/templates/list") return { jsonrpc: "2.0", id, result: { resourceTemplates: [] } };
  if (method === "prompts/list") return { jsonrpc: "2.0", id, result: { prompts: [] } };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: router.listToolSchemas() } };
  if (method === "tools/call") return handleToolCall(id, params);

  if (id !== undefined) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
  return null;
}

function validateBridgeTargetUrl(b) {
  if (!b.targetUrl || b.provider !== "openai") return;
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
      validateBridgeTargetUrl(b);
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
      try { conn.close(); } catch (_) { /* best-effort */ }
    }
  }
}

const activeBridges = new Map();

let isSyncing = false;
let syncPending = false;

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

async function stopObsoleteBridges(activeBridges, enabledNames, stopServer) {
  for (const name of activeBridges.keys()) {
    const active = activeBridges.get(name);
    if (!enabledNames.has(name)) {
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
}

async function startExternalBridgeServer(b, activeBridges, createContext, startServer) {
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

async function syncExternalBridges(externalBridges, activeBridges, createContext, startServer) {
  for (const b of externalBridges) {
    const port = b.port || 1313;
    const existing = activeBridges.get(b.name);
    if (existing?.ctx && !existing.external) continue;

    const isListening = await checkPortListening(port);
    if (isListening) {
      activeBridges.set(b.name, { bridgeConfig: b, external: true });
    } else {
      await startExternalBridgeServer(b, activeBridges, createContext, startServer);
    }
  }
}

async function reloadEmbeddedBridge(b, active, createContext, startServer, stopServer) {
  process.stderr.write(`[bridge:${b.name}] Configuration changed. Reloading...\n`);
  let ctx = null;
  try {
    await stopServer(active.ctx);
    await new Promise((r) => setTimeout(r, 200));
    process.stderr.write(`[bridge:${b.name}] Old server stopped. Starting on port ${b.port} (${b.provider})...\n`);

    ctx = createContext();
    ctx.bridgeConfig = b;
    ctx.outputChannel = {
      appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\n`),
      show: () => {},
      dispose: () => {},
    };

    await startServer(ctx);
    activeBridges.set(b.name, { bridgeConfig: b, ctx });
  } catch (err) {
    if (err.message.includes('EADDRINUSE') && ctx) {
      activeBridges.set(b.name, { bridgeConfig: b, ctx });
    } else {
      process.stderr.write(`[bridge:${b.name}] Error during reload: ${err.message}\n`);
      activeBridges.delete(b.name);
    }
  }
}

async function startNewEmbeddedBridge(b, createContext, startServer) {
  const ctx = createContext();
  ctx.bridgeConfig = b;
  ctx.outputChannel = {
    appendLine: (msg) => process.stderr.write(`[bridge:${b.name}] ${msg}\n`),
    show: () => {},
    dispose: () => {},
  };
  try {
    await startServer(ctx);
    activeBridges.set(b.name, { bridgeConfig: b, ctx });
  } catch (err) {
    if (err.message.includes('EADDRINUSE')) {
      activeBridges.set(b.name, { bridgeConfig: b, ctx });
    } else {
      process.stderr.write(`[bridge:${b.name}] Failed to start bridge server: ${err.message}\n`);
    }
  }
}

async function syncEmbeddedBridges(embeddedBridges, activeBridges, createContext, startServer, stopServer) {
  for (const b of embeddedBridges) {
    let active = activeBridges.get(b.name);
    if (active?.external) {
      activeBridges.delete(b.name);
      active = null;
    }
    if (!active) {
      await startNewEmbeddedBridge(b, createContext, startServer);
    } else {
      const old = active.bridgeConfig;
      const configChanged = old.port !== b.port || old.provider !== b.provider || old.targetUrl !== b.targetUrl || old.apiKey !== b.apiKey;
      if (configChanged) {
        await reloadEmbeddedBridge(b, active, createContext, startServer, stopServer);
      }
    }
  }
}

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

    await stopObsoleteBridges(activeBridges, enabledNames, stopServer);
    await syncExternalBridges(externalBridges, activeBridges, createContext, startServer);
    await syncEmbeddedBridges(embeddedBridges, activeBridges, createContext, startServer, stopServer);
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

function setupDbWatcher(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  try {
    return fs.watch(dbPath, (eventType) => {
      if (eventType === "change") syncBridges().catch(() => {});
    });
  } catch (_) {
    return null;
  }
}

function startDaemonBackgroundServices() {
  syncBridges()
    .then(() => {
      const { startGateway } = require("./bridge/gateway");
      return startGateway(activeBridges, 19999);
    })
    .catch((err) => {
      process.stderr.write(`[bridge] Initial sync / gateway failed: ${err.message}\n`);
    });

  const pollInterval = setInterval(() => {
    syncBridges().catch((err) => {
      process.stderr.write(`[bridge] Polling sync failed: ${err.message}\n`);
    });
  }, 5000);

  const watcher = setupDbWatcher(DB_PATH);
  return { pollInterval, watcher };
}

function setupStdioMcpListener(handles) {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on("close", () => {
    if (handles.pollInterval) clearInterval(handles.pollInterval);
    if (handles.watcher) handles.watcher.close();
    try {
      const { stopGateway } = require("./bridge/gateway");
      stopGateway().catch(() => {});
    } catch (_) { /* best-effort */ }
    process.exit(0);
  });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed);
      const response = handleRequest(req);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err.message}` } })}\n`);
    }
  });
}

function main() {
  let handles = { pollInterval: null, watcher: null };
  if (process.env.KONOHA_DAEMON === 'true') {
    handles = startDaemonBackgroundServices();
  } else {
    setupStdioMcpListener(handles);
  }

  process.on("uncaughtException", (err) => {
    process.stderr.write(`[mcp ${SERVER_NAME}] uncaughtException: ${err.message}\n`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { handleRequest, SERVER_NAME, SERVER_VERSION };
