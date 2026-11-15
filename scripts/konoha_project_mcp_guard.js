#!/usr/bin/env node
'use strict';

/**
 * scripts/konoha_project_mcp_guard.js
 *
 * Project-scoped JavaScript CLI guardrail for all 8 coding agent harnesses.
 * Reads JSON hook payloads from stdin (or --json), evaluates them strictly
 * against the Konoha-repository-only guardrail, prints the harness-native JSON
 * decision, and optionally exits non-zero when --exit-on-deny is passed.
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolve src/project_konoha_mcp_guardrail whether executed from scripts/,
 * symlinked, or copied inside .agents/plugins/konoha-mcp-guard/scripts/.
 */
function _resolveGuardrailModule() {
  const staticCandidates = [
    path.resolve(__dirname, '..', 'src', 'project_konoha_mcp_guardrail.js'),
    path.resolve(__dirname, '..', '..', '..', '..', 'src', 'project_konoha_mcp_guardrail.js'),
    path.resolve(__dirname, '..', '..', 'src', 'project_konoha_mcp_guardrail.js')
  ];
  for (const candidate of staticCandidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  for (const startDir of [__dirname, process.cwd()]) {
    let dir = path.resolve(startDir);
    for (let depth = 0; depth < 16 && dir; depth++) {
      const candidate = path.join(dir, 'src', 'project_konoha_mcp_guardrail.js');
      if (fs.existsSync(candidate)) return require(candidate);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error('Cannot locate src/project_konoha_mcp_guardrail.js from Konoha project MCP guard.');
}

const {
  SUPPORTED_HARNESSES,
  normalizeHarness,
  evaluateProjectMcpGuardrail,
  formatHarnessDecision
} = _resolveGuardrailModule();

function _parseArgs(argv) {
  const opts = {
    harness: process.env.KONOHA_CLIENT || process.env.KONOHA_HARNESS || 'antigravity',
    json: null,
    cwd: null,
    exitOnDeny: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--harness' || a === '--client') && argv[i + 1]) {
      opts.harness = argv[++i];
    } else if (a === '--json' && argv[i + 1]) {
      opts.json = argv[++i];
    } else if (a === '--cwd' && argv[i + 1]) {
      opts.cwd = argv[++i];
    } else if (a === '--exit-on-deny') {
      opts.exitOnDeny = true;
    }
  }
  return opts;
}

function _readStdinSafe() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function runCli(argv = process.argv) {
  const opts = _parseArgs(argv);
  const harness = normalizeHarness(opts.harness);
  const raw = opts.json || _readStdinSafe();

  let payload = {};
  if (raw && raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      payload = {};
    }
  }

  const evalOptions = { harness };
  if (opts.cwd) evalOptions.cwd = path.resolve(opts.cwd);

  const evalResult = evaluateProjectMcpGuardrail(payload, evalOptions);
  const response = formatHarnessDecision(harness, evalResult);
  process.stdout.write(`${JSON.stringify(response)}\n`);

  if (!evalResult.allowed && opts.exitOnDeny) {
    process.exitCode = 2;
  }
  return { evalResult, response };
}

if (require.main === module) {
  runCli(process.argv);
}

module.exports = {
  SUPPORTED_HARNESSES,
  runCli
};
