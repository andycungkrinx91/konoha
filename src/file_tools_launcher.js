#!/usr/bin/env node
/**
 * Cross-platform konoha-files MCP launcher.
 * Resolves Node via .node_exec_path (written by konoha init/doctor) when IDE PATH differs from nvm.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const MCP_SCRIPT = path.join(DIR, 'file_tools_mcp.js');
const NODE_PATH_FILE = path.join(DIR, '.node_exec_path');

function resolveNode() {
  if (process.env.KONOHA_NODE) {
    return process.env.KONOHA_NODE;
  }
  if (fs.existsSync(NODE_PATH_FILE)) {
    const recorded = fs.readFileSync(NODE_PATH_FILE, 'utf8').trim();
    if (recorded) {
      return recorded;
    }
  }
  return process.execPath || 'node';
}

if (!fs.existsSync(MCP_SCRIPT)) {
  process.stderr.write(`[konoha-files] missing ${MCP_SCRIPT} — run konoha init\n`);
  process.exit(1);
}

const node = resolveNode();
const child = spawn(node, [MCP_SCRIPT], {
  stdio: 'inherit',
  windowsHide: true,
  env: process.env
});

child.on('error', (err) => {
  process.stderr.write(`[konoha-files] failed to spawn node (${node}): ${err.message}\n`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
