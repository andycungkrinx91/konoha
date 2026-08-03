'use strict';

/**
 * Bridge Manager — manages individual bridge servers + gateway
 * Used by both the MCP server and the CLI (`konoha bridge` commands)
 */

const http = require('http');
const { spawnSync, execSync } = require('child_process');
const path = require('path');
const os = require('os');

// ─── Database helpers ────────────────────────────────────────────────────────

function runBridgeDb(args) {
  const bridgeScript = path.join(__dirname, '..', 'db_bridges.py');
  const python = process.env.PYTHON_CMD || 'python3';
  const res = spawnSync(python, [bridgeScript, ...args], { encoding: 'utf-8', timeout: 5000 });
  if (res.status !== 0) throw new Error(res.stderr || 'db_bridges.py failed');
  return JSON.parse(res.stdout);
}

function listBridges() {
  return runBridgeDb(['--list']);
}

function upsertBridge(bridge) {
  return runBridgeDb(['--upsert', JSON.stringify(bridge)]);
}

function deleteBridge(name) {
  return runBridgeDb(['--delete', name]);
}

function setEnabled(name, enabled) {
  return runBridgeDb(enabled ? ['--enable', name] : ['--disable', name]);
}

// ─── Next available port finder ──────────────────────────────────────────────

const PORT_BASE = 11435;
const _bridgeProcesses = new Map(); // name -> { ctx, server, config }
const GATEWAY_PORT = 19999;

function _isPortFree(port) {
  return new Promise(resolve => {
    const srv = http.createServer();
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
    srv.on('error', () => resolve(false));
  });
}

async function findFreePort(base) {
  for (let offset = 0; offset < 50; offset++) {
    const port = base + offset;
    if (await _isPortFree(port)) return port;
  }
  throw new Error('No free port found near ' + base);
}

// ─── Start a single bridge server ────────────────────────────────────────────

function createContext(config) {
  return {
    sessionId: 'cli-' + Date.now(),
    bridgeConfig: config,
    server: null,
    sidecarInfo: null,
    sidecarInfoTimestamp: 0,
    lastResponseTimestamp: 0,
    MIN_REQUEST_INTERVAL_MS: 200,
    lastUserMessageHash: '',
    lastUserMessageTimestamp: 0,
    DEDUP_WINDOW_MS: 1000,
    isWorkspaceSwitching: false,
    activeCascades: new Map(),
    cascadePromises: new Map(),
    // VSCode-style output channel (CLI uses stderr)
    outputChannel: {
      appendLine: (msg) => process.stderr.write(`[bridge:${config.name}] ${msg}\n`),
      show: () => {},
      dispose: () => {},
    },
  };
}

async function startBridge(config) {
  const { createContext: _ctx } = require('./context');
  const { startServer, stopServer } = require('./server');
  const ctx = _ctx();
  ctx.bridgeConfig = config;
  ctx.outputChannel = {
    appendLine: (msg) => process.stderr.write(`[bridge:${config.name}] ${msg}\n`),
    show: () => {},
    dispose: () => {},
  };

  const port = config.port;
  try {
    await startServer(ctx);
    _bridgeProcesses.set(config.name, { ctx, config });
    process.stderr.write(`[bridge:${config.name}] ✅ Started on port ${port}\n`);
    return { name: config.name, port, status: 'running' };
  } catch (err) {
    process.stderr.write(`[bridge:${config.name}] ❌ Failed to start on port ${port}: ${err.message}\n`);
    return { name: config.name, port, status: 'error', error: err.message };
  }
}

async function stopBridge(name) {
  const entry = _bridgeProcesses.get(name);
  if (!entry) return { name, status: 'stopped' };
  try {
    await stopServer(entry.ctx);
    _bridgeProcesses.delete(name);
    process.stderr.write(`[bridge:${name}] ⏹️  Stopped\n`);
    return { name, status: 'stopped' };
  } catch (err) {
    _bridgeProcesses.delete(name);
    return { name, status: 'error', error: err.message };
  }
}

async function stopAllBridges() {
  const names = [..._bridgeProcesses.keys()];
  await Promise.all(names.map(n => stopBridge(n)));
}

// ─── Gateway management ──────────────────────────────────────────────────────

let _gatewayServer = null;
let _gatewayActiveBridges = null;

async function startGateway() {
  const { startGateway: _start } = require('./gateway');
  _gatewayActiveBridges = new Map();
  const bridges = listBridges().filter(b => b.enabled);
  for (const b of bridges) {
    const entry = _bridgeProcesses.get(b.name);
    if (entry) {
      _gatewayActiveBridges.set(b.name, entry);
    }
  }
  try {
    await _start(_gatewayActiveBridges, GATEWAY_PORT);
    _gatewayServer = _gatewayActiveBridges;
    process.stderr.write(`[gateway] ✅ Running on port ${GATEWAY_PORT}\n`);
    return { port: GATEWAY_PORT, status: 'running' };
  } catch (err) {
    process.stderr.write(`[gateway] ❌ Failed to start on port ${GATEWAY_PORT}: ${err.message}\n`);
    return { port: GATEWAY_PORT, status: 'error', error: err.message };
  }
}

async function stopGateway() {
  const { stopGateway: _stop } = require('./gateway');
  if (_gatewayServer) {
    await _stop();
    _gatewayServer = null;
    _gatewayActiveBridges = null;
    process.stderr.write(`[gateway] ⏹️  Stopped\n`);
  }
  return { port: GATEWAY_PORT, status: 'stopped' };
}

// ─── CLI status / models ─────────────────────────────────────────────────────

function isGatewayRunning() {
  return _gatewayServer !== null;
}

function isBridgeRunning(name) {
  return _bridgeProcesses.has(name);
}

async function fetchGatewayModels() {
  if (!isGatewayRunning()) {
    throw new Error('Gateway is not running');
  }
  const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/models`);
  if (!res.ok) throw new Error(`Gateway returned HTTP ${res.status}`);
  return res.json();
}

// ─── Init from DB on module load ─────────────────────────────────────────────

async function initFromDb() {
  const bridges = listBridges().filter(b => b.enabled);
  for (const b of bridges) {
    await startBridge(b);
  }
}

module.exports = {
  // DB
  listBridges,
  upsertBridge,
  deleteBridge,
  setEnabled,
  // Start/stop
  startBridge,
  stopBridge,
  stopAllBridges,
  startGateway,
  stopGateway,
  // Status
  isGatewayRunning,
  isBridgeRunning,
  // Models
  fetchGatewayModels,
  // Init
  initFromDb,
  // Constants
  GATEWAY_PORT,
  PORT_BASE,
  _bridgeProcesses,
};
