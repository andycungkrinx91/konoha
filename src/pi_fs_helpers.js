'use strict';

// Small filesystem helpers shared by the Pi integration. They live here rather
// than in pi_manager.js so that module stays under the 700-line ceiling the repo
// lints at; none of them carry Pi-specific behaviour.

const fs = require('fs');

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function ensureDirSafe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) { /* best effort: a failed mkdir must never crash the CLI or MCP runtime */ }
}

module.exports = { fileExists, readJsonSafe, ensureDirSafe };
