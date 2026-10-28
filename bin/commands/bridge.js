"use strict";

/**
 * bin/commands/bridge.js — LLM Proxy Gateway Management.
 *
 * Subcommands:
 * - list: List all configured model bridges and listening ports
 * - start/stop/restart: Bridge process lifecycle management
 * - models: Query models available on upstream providers
 * - create/delete/enable/disable: Manage bridge routing configuration
 * - status: Port bindings and bridge proxy health
 */

const fs = require("fs");
const path = require("path");

const { SKILLS_DB_DIR, SRC_DIR } = require("../lib/paths");
const {
  C,
  log,
  warn,
  error,
  success,
  header,
  applyGradient,
  CHIDORI_THEME,
  drawTable,
  computeTableWidths,
  RASENGAN_THEME,
  gradientStatusCell
} = require("../lib/format");

const {
  askQuestion,
  fileExists
} = require("../lib/prompt");
const { checkPortActive, killProcessOnPort } = require('../../src/platform_utils');


function loadBridges() {
  try {
    const dbBridges = require('../../src/db_bridges');
    return dbBridges.listBridges();
  } catch (_) {
    return [];
  }
}

function saveBridgeSqlite(action, data) {
  try {
    const dbBridges = require('../../src/db_bridges');
    if (action === 'upsert') {
      dbBridges.upsertBridge(data);
      return true;
    } else if (action === 'delete') {
      dbBridges.deleteBridge(data);
      return true;
    } else if (action === 'enable') {
      dbBridges.setEnabled(data, true);
      return true;
    } else if (action === 'disable') {
      dbBridges.setEnabled(data, false);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function getNextAvailablePort(bridges) {
  let maxPort = 11436;
  for (const b of bridges) {
    if (b.port && b.port > maxPort) {
      maxPort = b.port;
    }
  }
  return maxPort + 1;
}

function cmdBridgeHelp() {
  header('Konoha Bridge Management');
  log(`
Usage:
  konoha bridge status                   Show status of all configured bridges
  konoha bridge list                     List all configured bridges in a table
  konoha bridge models                   List all served models by all active bridges
  konoha bridge start                    Start the bridge gateway service in background (standalone daemon)
  konoha bridge stop                     Stop background bridge gateway service
  konoha bridge restart                  Stop and restart the bridge gateway service
  konoha bridge create [name]            Create a bridge - interactive: choose API Key
  konoha bridge delete <bridge name>     Delete a bridge configuration
  konoha bridge enable <bridge name>     Enable a bridge configuration
  konoha bridge disable <bridge name>    Disable a bridge configuration

Examples:
  konoha bridge start                     (Launch standalone bridge proxy on port 19999)
  konoha bridge create                    (Interactive - choose API Key, then provider)
  konoha bridge status

Provider: OpenAI Compatible (universal - works with all OpenAI-compatible APIs)
  1  OpenAI           - https://api.openai.com/v1
  2  OpenAI Compatible - any OpenAI-compatible API (Ollama, LM Studio, vLLM, ...)
  3  Antigravity Extension - IDE-owned http://127.0.0.1:1313 (disabled by default)
 `);
}

async function cmdBridge(args) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    cmdBridgeHelp();
    process.exit(0);
  }

  switch (subcommand) {
    case 'status':
      await cmdBridgeStatus();
      break;
    case 'list':
      await cmdBridgeList();
      break;
    case 'models':
      await cmdBridgeModels();
      break;
    case 'start':
    case 'daemon':
      await cmdBridgeStart();
      break;
    case 'stop':
      await cmdBridgeStop();
      break;
    case 'restart':
      await cmdBridgeRestart();
      break;
    case 'delete':
      await cmdBridgeDelete(subArgs[0]);
      break;
    case 'enable':
      await cmdBridgeEnable(subArgs[0]);
      break;
    case 'disable':
      await cmdBridgeDisable(subArgs[0]);
      break;
    case 'create':
      await cmdBridgeCreate(subArgs[0]);
      break;
    default:
      error(`Unknown bridge subcommand: ${subcommand}`);
      log(`Run ${C.cyan}konoha bridge help${C.reset} for usage.`);
      process.exit(1);
  }
}

async function cmdBridgeStart() {
  const { spawn } = require('child_process');
  header('Starting Bridge Proxy Gateway Service');

  const gatewayActive = await checkPortActive(19999);
  if (gatewayActive) {
    warn('Proxy Gateway is already running on port 19999.');
    return;
  }

  const mcpScript = fileExists(path.join(SKILLS_DB_DIR, 'file_tools_mcp.js'))
    ? path.join(SKILLS_DB_DIR, 'file_tools_mcp.js')
    : path.join(SRC_DIR, 'file_tools_mcp.js');

  const child = spawn(process.execPath || 'node', [mcpScript], {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { KONOHA_DAEMON: 'true' })
  });
  child.on('error', (err) => {
    warn(`Background bridge process errored: ${err && err.message ? err.message : err}`);
  });
  child.unref();

  try {
    fs.writeFileSync(path.join(SKILLS_DB_DIR, 'bridge.pid'), String(child.pid));
  } catch (e) {
    warn(`Could not write bridge.pid: ${e && e.message ? e.message : e}`);
  }

  await new Promise((r) => setTimeout(r, 1000));
  const nowActive = await checkPortActive(19999);
  if (nowActive) {
    success('Bridge Proxy Gateway started successfully in background on port 19999.');
  } else {
    warn('Background process spawned. Run "konoha bridge status" to check binding status.');
  }
}

function terminatePid(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch (_) {
    /* process may have already exited */
  }
}

async function cmdBridgeStop() {
  header('Stopping Bridge Proxy Gateway Service');
  const pidFile = path.join(SKILLS_DB_DIR, 'bridge.pid');
  try {
    if (fileExists(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      terminatePid(pid);
    }
    await killProcessOnPort(19999);
    if (fileExists(pidFile)) {
      try { fs.unlinkSync(pidFile); } catch (_) { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
    }
    const stillRunning = await checkPortActive(19999);
    if (stillRunning) {
      warn('Port 19999 is still active after stop command.');
    } else {
      success('Stopped background bridge proxy gateway services.');
    }
  } catch (err) {
    warn(`Error stopping bridge services: ${err.message}`);
  }
}

async function cmdBridgeRestart() {
  header('Restarting Bridge Proxy Gateway Service');
  success('Stopping existing bridge service...');
  await cmdBridgeStop();
  try {
    saveBridgeSqlite('disable', 'Antigravity');
    await new Promise((r) => setTimeout(r, 300));
    saveBridgeSqlite('enable', 'Antigravity');
  } catch { /* intentional best-effort fallback: failure here must never crash the CLI/MCP runtime */ }
  await new Promise((r) => setTimeout(r, 600));
  success('Starting bridge service...');
  await cmdBridgeStart();
}

async function cmdBridgeList() {
  const bridges = loadBridges();
  header('Configured Bridges');

  if (bridges.length === 0) {
    log('  No bridges configured.');
    return;
  }

  const rows = [];
  for (const b of bridges) {
    const active = await checkPortActive(b.port);
    const providerLabel = {
        'openai-compatible': 'OpenAI Compatible',
        'openai':            'OpenAI'
      }[b.provider] || b.provider || '-';
    rows.push([
      b.name,
      String(b.port),
      providerLabel,
      b.enabled ? 'Enabled' : 'Disabled',
      active ? 'Running' : 'Stopped',
      b.targetUrl || '-'
    ]);
  }

  const headers = ['Name', 'Port', 'Provider', 'Configured Status', 'Runtime Status', 'Target URL'];
  const widths = computeTableWidths(headers, rows, { minWidths: [15, 6, 12, 10, 10, 20] });
  drawTable(headers, widths, ['left', 'left', 'left', 'left', 'left', 'left'], rows, [], RASENGAN_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      (cell) => cell,
      (cell) => cell,
      (cell) => cell.includes('Enabled') ? `${C.green}${cell}${C.reset}` : `${C.dim}${cell}${C.reset}`,
      (cell) => cell.includes('Running') ? `${C.green}${cell}${C.reset}` : `${C.red}${cell}${C.reset}`,
      (cell) => cell
    ]
  });
}

async function fetchBridgeModels(bridge) {
  let targetPath = bridge.targetUrl || `http://127.0.0.1:${bridge.port}`;
  if (targetPath.endsWith('/chat/completions')) {
    targetPath = targetPath.replace('/chat/completions', '/models');
  }
  if (!targetPath.endsWith('/models')) {
    if (targetPath.endsWith('/')) targetPath = targetPath.slice(0, -1);
    if (targetPath.endsWith('/v1')) targetPath = targetPath + '/models';
    else targetPath = targetPath + '/v1/models';
  }
  const headers = {};
  if (bridge.apiKey) headers['Authorization'] = `Bearer ${bridge.apiKey}`;

  try {
    const res = await fetch(targetPath, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function cmdBridgeModels() {
  header('Served Models via Proxy Gateway');

  const bridges = loadBridges();
  const bridgeList = bridges.filter(b => b.enabled && b.targetUrl);

  if (bridgeList.length === 0) {
    log('  No enabled bridges found.');
    return;
  }

  const targets = await Promise.all(bridgeList.map(b => fetchBridgeModels(b)));

  const models = [];
  for (let i = 0; i < targets.length; i++) {
    const bridge = bridgeList[i];
    if (!targets[i] || !Array.isArray(targets[i].data)) continue;
    for (const m of targets[i].data) {
      const prefixedId = `${bridge.name}-${m.id}`;
      models.push({ id: prefixedId, owned_by: m.owned_by || bridge.name });
    }
  }

  if (models.length === 0) {
    log('  No models are currently served by any active bridges.');
    return;
  }

  const rows = [];
  for (const m of models) {
    const idx = m.id.indexOf('-');
    let bridge = '-';
    let baseModel = m.id;
    if (idx !== -1) {
      bridge = m.id.substring(0, idx);
      baseModel = m.id.substring(idx + 1);
    }
    rows.push([
      bridge,
      baseModel,
      m.id,
      m.owned_by || '-'
    ]);
  }

  const headers = ['Bridge', 'Base Model Name', 'Full Alias Model ID', 'Owned By'];
  const widths = computeTableWidths(headers, rows, { minWidths: [12, 25, 45, 12] });
  drawTable(headers, widths, ['left', 'left', 'left', 'left'], rows, [], RASENGAN_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      (cell) => cell,
      (cell) => `${C.bold}${cell}${C.reset}`,
      (cell) => cell
    ]
  });
}

async function cmdBridgeStatus() {
  const bridges = loadBridges();
  header('Bridge Status Report');

  const gatewayActive = await checkPortActive(19999);
  const rows = [];
  
  rows.push([
    'Proxy Gateway',
    '19999',
    'Gateway Router',
    gatewayActive ? 'RUNNING' : 'STOPPED',
    'http://localhost:19999/v1'
  ]);

  let activeCount = 0;
  for (const b of bridges) {
    const active = await checkPortActive(b.port);
    if (active) activeCount++;
    const statusText = active
      ? 'RUNNING'
      : (b.enabled ? 'STOPPED' : 'DISABLED');
    rows.push([
      b.name,
      String(b.port),
      b.provider || 'custom',
      statusText,
      b.targetUrl || '-'
    ]);
  }

  const headers = ['Bridge Service', 'Port', 'Provider', 'Status', 'Target URL'];
  const widths = computeTableWidths(headers, rows, { minWidths: [18, 6, 14, 12, 25] });
  drawTable(headers, widths, ['left', 'left', 'left', 'left', 'left'], rows, [], RASENGAN_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.8),
      (cell) => cell,
      gradientStatusCell,
      (cell) => applyGradient(cell, CHIDORI_THEME, 0.7)
    ]
  });

  log('');
  if (activeCount > 0 || gatewayActive) {
    success(`${activeCount + (gatewayActive ? 1 : 0)} bridge service(s) active and listening.`);
  } else {
    warn('No active bridges running. Bridges are hosted in-process by konoha MCP.');
    log(`  ${C.dim}Tip: Start an active MCP IDE session or run ${C.cyan}konoha bridge start${C.dim} to run in background.${C.reset}`);
  }
}

async function cmdBridgeDelete(name) {
  if (!name) {
    error('Please specify a bridge name to delete.');
    log(`Usage: ${C.cyan}konoha bridge delete <bridge name>${C.reset}`);
    process.exit(1);
  }

  const bridges = loadBridges();
  const index = bridges.findIndex(b => b.name === name);
  if (index === -1) {
    error(`Bridge "${name}" not found.`);
    process.exit(1);
  }

  const deleted = bridges.splice(index, 1)[0];
  if (!saveBridgeSqlite('delete', deleted.name)) {
    error(`Failed to delete bridge "${deleted.name}".`);
    process.exit(1);
  }
  success(`Deleted bridge "${deleted.name}".`);
}

async function cmdBridgeEnable(name) {
  if (!name) {
    error('Please specify a bridge name to enable.');
    log(`Usage: ${C.cyan}konoha bridge enable <bridge name>${C.reset}`);
    process.exit(1);
  }

  const bridges = loadBridges();
  const bridge = bridges.find(b => b.name === name);
  if (!bridge) {
    error(`Bridge "${name}" not found.`);
    process.exit(1);
  }

  if (bridge.enabled) {
    warn(`Bridge "${name}" is already enabled.`);
    return;
  }

  if (!saveBridgeSqlite('enable', name)) {
    error(`Failed to enable bridge "${name}".`);
    process.exit(1);
  }
  success(`Enabled bridge "${name}". The runtime has been started automatically.`);
}

async function cmdBridgeDisable(name) {
  if (!name) {
    error('Please specify a bridge name to disable.');
    log(`Usage: ${C.cyan}konoha bridge disable <bridge name>${C.reset}`);
    process.exit(1);
  }

  const bridges = loadBridges();
  const bridge = bridges.find(b => b.name === name);
  if (!bridge) {
    error(`Bridge "${name}" not found.`);
    process.exit(1);
  }

  if (!bridge.enabled) {
    warn(`Bridge "${name}" is already disabled.`);
    return;
  }

  if (!saveBridgeSqlite('disable', name)) {
    error(`Failed to disable bridge "${name}".`);
    process.exit(1);
  }
  success(`Disabled bridge "${name}". The runtime has been stopped automatically.`);
}

async function cmdBridgeCreate(name) {
  const nameRegex = /^[a-zA-Z0-9_-]+$/;
  const bridges = loadBridges();

  log('\n' + applyGradient('  Konoha Bridge — Create New Bridge', CHIDORI_THEME, 0.9) + '\n');
  log(`  Provider: OpenAI Compatible (works with OpenAI, Ollama, LMStudio, vLLM, Groq, AnyLLM, etc.)\n`);

  // Bridge name
  let bridgeName = name;
  if (!bridgeName) {
    bridgeName = await askQuestion('  Bridge name: ');
    if (!bridgeName) { error('Bridge name is required.'); process.exit(1); }
  }
  if (!nameRegex.test(bridgeName)) {
    error('Invalid bridge name. Use only alphanumeric, hyphens, underscores.');
    process.exit(1);
  }
  if (bridges.some(b => b.name === bridgeName)) {
    error(`Bridge "${bridgeName}" already exists.`);
    process.exit(1);
  }

  const providerChoice = (await askQuestion('  Provider [1=OpenAI-compatible, 2=Antigravity extension]: ')).trim() || '1';
  if (providerChoice === '2') {
    const newBridge = {
      name: bridgeName,
      port: 1313,
      provider: 'antigravity-extension',
      targetUrl: 'http://127.0.0.1:1313',
      enabled: false
    };
    if (bridges.some(b => b.port === newBridge.port)) { error(`Port ${newBridge.port} already in use.`); process.exit(1); }
    if (!saveBridgeSqlite('upsert', newBridge)) {
      error(`Failed to create bridge "${bridgeName}".`);
      process.exit(1);
    }
    log('');
    success(`Bridge "${bridgeName}" created disabled.`);
    log('  Provider : Antigravity Extension (IDE-owned, port 1313)\n  Enable with: konoha bridge enable ' + bridgeName + '\n');
    return;
  }

  // Port
  const defaultPort = getNextAvailablePort(bridges);
  const portStr = await askQuestion(`  Listen port [${defaultPort}]: `);
  const port = portStr ? parseInt(portStr, 10) : defaultPort;
  if (isNaN(port) || port <= 0 || port > 65535) { error('Invalid port.'); process.exit(1); }
  if (bridges.some(b => b.port === port)) { error(`Port ${port} already in use.`); process.exit(1); }

  // Target URL
  let targetUrl = '';
  while (!targetUrl) {
    const prompt = '  Target URL (e.g. https://api.openai.com/v1 or http://localhost:11434/v1): ';
    const input = await askQuestion(prompt);
    targetUrl = input?.trim() || '';
    if (!targetUrl) warn('  Target URL is required.');
  }

  // API Key
  const apiKey = await askQuestion('  API Key (required for most APIs): ');
  if (!apiKey?.trim()) { error('API Key is required.'); process.exit(1); }

  const newBridge = {
    name: bridgeName,
    port,
    provider: 'openai-compatible',
    targetUrl,
    apiKey: apiKey.trim(),
    enabled: true
  };

  if (!saveBridgeSqlite('upsert', newBridge)) {
    error(`Failed to create bridge "${bridgeName}".`);
    process.exit(1);
  }
  log('');
  success(`Bridge "${bridgeName}" created!`);
  log(`  Provider : OpenAI Compatible\n`);
}




module.exports = {
  cmdBridge,
  cmdBridgeHelp,
  cmdBridgeStart,
  cmdBridgeStop,
  cmdBridgeRestart,
  cmdBridgeList,
  cmdBridgeModels,
  cmdBridgeStatus,
  cmdBridgeDelete,
  cmdBridgeEnable,
  cmdBridgeDisable,
  cmdBridgeCreate,
  loadBridges,
  saveBridgeSqlite,
  checkPortActive,
  getNextAvailablePort,
};
