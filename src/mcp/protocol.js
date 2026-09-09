/**
 * Konoha MCP Subsystem - Protocol Handler, JSON-RPC & Stdio Loop
 * Extracted from server.js as part of modularization refactor (Phase 7)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  getWorkspaceRoot,
  setWorkspaceRoot,
  setActiveClient,
  uriToPath,
  isIdeInstallationDir,
  HOME,
  GEMINI_DIR
} = require('./runtime_state');
const { detectActiveClient } = require('./client_detection');
const { autoMigrateProjectSkills } = require('./skills');
const { executeTool } = require('./tool_dispatch');

const ANTIGRAVITY_CLI = path.join(GEMINI_DIR, 'antigravity-cli');
const ANTIGRAVITY_CLI_BRAIN = path.join(ANTIGRAVITY_CLI, 'brain');

function getServerVersion() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', 'package.json'),
    path.join(HOME, '.konoha', 'package.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const data = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (data.version) return String(data.version);
      } catch (_) { /* ignore */ }
    }
  }
  return '2.0.0';
}

const SERVER_VERSION = getServerVersion();

let MCP_MANIFEST = { protocol_versions: ['2024-11-05'], tools: [] };
const MCP_MANIFEST_PATH = path.resolve(__dirname, '..', 'mcp_tool_manifest.json');
try {
  if (fs.existsSync(MCP_MANIFEST_PATH)) {
    MCP_MANIFEST = JSON.parse(fs.readFileSync(MCP_MANIFEST_PATH, 'utf8'));
  }
} catch (_) { /* ignore */ }

const SUPPORTED_PROTOCOL_VERSIONS = MCP_MANIFEST.protocol_versions || ['2024-11-05'];
let MCP_INITIALIZED = false;

async function handleRequest(req) {
  if (!req || typeof req !== 'object') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { method, id: rid, params } = req;
  if (rid === undefined && method !== 'initialize') {
    return null;
  }
  if (['tools/list', 'tools/call'].includes(method) && !MCP_INITIALIZED) {
    return { jsonrpc: '2.0', id: rid, error: { code: -32002, message: 'Server is not initialized' } };
  }

  if (method === 'initialize') {
    const p = params || {};
    const requestedProtocol = p.protocolVersion || SUPPORTED_PROTOCOL_VERSIONS[0];
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(requestedProtocol)) {
      return { jsonrpc: '2.0', id: rid, error: { code: -32602, message: `Unsupported protocol version: ${requestedProtocol}` } };
    }

    const clientInfo = p.clientInfo || {};
    const clientName = (clientInfo.name || '').toLowerCase();
    let detectedClient;
    if (clientName.includes('cursor')) detectedClient = 'cursor';
    else if (clientName.includes('claude')) detectedClient = 'claudecode';
    else if (clientName.includes('opencode')) detectedClient = 'opencode';
    else if (clientName.includes('commandcode')) detectedClient = 'commandcode';
    else if (clientName.includes('antigravity-cli') || clientName.includes('agy')) detectedClient = 'agy';
    else if (clientName.includes('antigravity') || clientName.includes('ide')) {
      const convId = process.env.ANTIGRAVITY_CONVERSATION_ID;
      if (convId) {
        if ((process.env.ANTIGRAVITY_LS_VERSION || '').startsWith('cli')) detectedClient = 'agy';
        else if (fs.existsSync(path.join(ANTIGRAVITY_CLI_BRAIN, convId))) detectedClient = 'agy';
        else detectedClient = 'antigravity';
      } else {
        detectedClient = 'antigravity';
      }
    } else {
      detectedClient = detectActiveClient();
    }
    setActiveClient(detectedClient);

    let newWs = null;
    if (p.rootUri) {
      const cand = uriToPath(p.rootUri);
      if (cand && !isIdeInstallationDir(cand)) newWs = cand;
    }
    if (!newWs && p.workspaceFolders && Array.isArray(p.workspaceFolders) && p.workspaceFolders.length > 0) {
      const uri = p.workspaceFolders[0].uri;
      if (uri) {
        const cand = uriToPath(uri);
        if (cand && !isIdeInstallationDir(cand)) newWs = cand;
      }
    }
    if (!newWs && p.rootPath) {
      const cand = uriToPath(p.rootPath);
      if (cand && !isIdeInstallationDir(cand)) newWs = cand;
    }

    if (newWs) {
      setWorkspaceRoot(newWs);
    }

    const currentWs = getWorkspaceRoot();
    if (currentWs) {
      process.stderr.write(`[mcp konoha] Initialized with workspace root: ${currentWs}\n`);
      try { autoMigrateProjectSkills(currentWs); } catch (_) { /* ignore */ }
    } else {
      process.stderr.write(`[mcp konoha] Initialized with no workspace root; using cwd: ${process.cwd()}\n`);
      try { autoMigrateProjectSkills(process.cwd()); } catch (_) { /* ignore */ }
    }

    MCP_INITIALIZED = true;
    return {
      jsonrpc: '2.0',
      id: rid,
      result: {
        protocolVersion: requestedProtocol,
        capabilities: { tools: {} },
        serverInfo: { name: 'konoha', version: SERVER_VERSION }
      }
    };
  }

  if (method === 'notifications/initialized') {
    MCP_INITIALIZED = true;
    return null;
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id: rid, result: { tools: MCP_MANIFEST.tools || [] } };
  }

  if (method === 'tools/call') {
    const p = params || {};
    const toolName = p.name;
    const args = p.arguments || {};

    let resultText;
    try {
      resultText = await executeTool(toolName, args);
    } catch (e) {
      // Tool crashes must still answer with the request id so clients can
      // correlate the error instead of hanging until timeout
      return {
        jsonrpc: '2.0',
        id: rid,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ error: `Tool execution failed: ${e.message}` }) }],
          isError: true
        }
      };
    }
    let isError = false;
    try {
      const parsed = JSON.parse(resultText);
      isError = typeof parsed === 'object' && parsed !== null && 'error' in parsed;
    } catch (_) { /* ignore */ }

    return {
      jsonrpc: '2.0',
      id: rid,
      result: {
        content: [{ type: 'text', text: resultText }],
        isError
      }
    };
  }

  if (rid !== undefined) {
    return { jsonrpc: '2.0', id: rid, error: { code: -32601, message: `Method not found: ${method}` } };
  }
  return null;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed);
      const resp = await handleRequest(req);
      if (resp !== null) {
        console.log(JSON.stringify(resp));
      }
    } catch (e) {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${e.message}` } }));
    }
  }
}

module.exports = {
  getServerVersion,
  SERVER_VERSION,
  MCP_MANIFEST,
  SUPPORTED_PROTOCOL_VERSIONS,
  isInitialized: () => MCP_INITIALIZED,
  setInitialized: (val) => { MCP_INITIALIZED = Boolean(val); },
  handleRequest,
  main
};
