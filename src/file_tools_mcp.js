#!/usr/bin/env node
/**
 * Konoha file-tools MCP server (stdio JSON-RPC).
 * Node.js orchestrates schemas; Python scripts perform streaming I/O.
 */
const readline = require('readline');

const SERVER_NAME = 'konoha-files';
const SERVER_VERSION = '1.1.6';

let router;
try {
  router = require('./file_tools_router');
} catch (err) {
  process.stderr.write(`[mcp ${SERVER_NAME}] FATAL: cannot load router: ${err.message}\n`);
  process.exit(1);
}

const installErrors = router.validateInstall();
if (installErrors.length) {
  process.stderr.write(
    `[mcp ${SERVER_NAME}] FATAL: incomplete install: ${installErrors.join('; ')}\n`
  );
  process.exit(1);
}

let initialized = false;
let negotiatedProtocol = '2024-11-05';

function handleRequest(req) {
  const method = req.method;
  const id = req.id;

  if (id === undefined && method && method.startsWith('notifications/')) {
    if (method === 'notifications/initialized') {
      initialized = true;
    }
    return null;
  }

  if (method === 'initialize') {
    const params = req.params || {};
    if (params.protocolVersion) {
      negotiatedProtocol = params.protocolVersion;
    }

    let root = null;
    if (params.rootUri) {
      root = router.uriToPath(params.rootUri);
    }
    if (!root && Array.isArray(params.workspaceFolders) && params.workspaceFolders[0]) {
      root = router.uriToPath(params.workspaceFolders[0].uri);
    }
    if (!root && params.rootPath) {
      root = router.uriToPath(params.rootPath);
    }

    router.setWorkspaceRoot(root);
    initialized = true;
    process.stderr.write(
      `[mcp ${SERVER_NAME}] Initialized workspace: ${router.getWorkspaceRoot()}\n`
    );

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiatedProtocol,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    };
  }

  if (method === 'notifications/initialized') {
    initialized = true;
    return null;
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: router.listToolSchemas() }
    };
  }

  if (method === 'tools/call') {
    const params = req.params || {};
    const toolName = params.name;
    const args = params.arguments || {};
    process.stderr.write(
      `[mcp ${SERVER_NAME}] tool_call: ${toolName}(${JSON.stringify(args)})\n`
    );

    const { text, isError } = router.dispatchTool(toolName, args);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text }],
        isError: Boolean(isError)
      }
    };
  }

  if (id !== undefined) {
    return { jsonrpc: '2.0', id, result: {} };
  }
  return null;
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on('line', (line) => {
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
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` }
        })}\n`
      );
    }
  });

  process.on('uncaughtException', (err) => {
    process.stderr.write(`[mcp ${SERVER_NAME}] uncaughtException: ${err.message}\n`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { handleRequest, SERVER_NAME, SERVER_VERSION };
