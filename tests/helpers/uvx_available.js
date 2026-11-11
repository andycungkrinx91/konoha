'use strict';
/**
 * tests/helpers/uvx_available.js — host probe for the `uvx` launcher.
 *
 * The Cursor MCP writer only registers the `semble` server when `uvx` resolves
 * (src/cursor_manager.js buildMcpServers). CI runners have no `uvx`, so suites
 * that assert the canonical Cursor config must gate that one entry instead of
 * assuming the full three-server set.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function uvxAvailable() {
  const { resolveUvxExecutablePath } = require(path.join(ROOT, 'src', 'semble_manager'));
  const bin = resolveUvxExecutablePath();
  if (!bin) return false;
  const probe = spawnSync(bin, ['--version'], { stdio: 'ignore', windowsHide: true });
  return probe.status === 0;
}

module.exports = { uvxAvailable };
