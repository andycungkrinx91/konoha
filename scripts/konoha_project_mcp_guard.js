#!/usr/bin/env node
'use strict';

/**
 * scripts/konoha_project_mcp_guard.js
 *
 * Project-scoped JavaScript CLI guardrail for all 8 coding agent harnesses.
 * Reads JSON hook payloads from stdin (or --json), evaluates them strictly
 * against the Konoha-repository-only guardrail, prints the harness-native JSON
 * decision, and optionally exits non-zero when --exit-on-deny is passed.
 *
 * A denial is a decision point. `--hitl` turns it into a three-way prompt:
 * block and try the Konoha route, accept the risk under a scoped exception, or
 * cancel. Harness hooks never prompt — they stay fail-closed — so the
 * interactive path is opt-in and its exceptions are what the hook honours.
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolve a file under src/ whether this CLI is executed from scripts/,
 * symlinked, or copied inside .agents/plugins/konoha-mcp-guard/scripts/ — the
 * copy has no src/ sibling, so a plain relative require throws MODULE_NOT_FOUND.
 */
function _resolveSrcModule(relativePath) {
  const staticCandidates = [
    path.resolve(__dirname, '..', 'src', relativePath),
    path.resolve(__dirname, '..', '..', '..', '..', 'src', relativePath),
    path.resolve(__dirname, '..', '..', 'src', relativePath)
  ];
  for (const candidate of staticCandidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  for (const startDir of [__dirname, process.cwd()]) {
    let dir = path.resolve(startDir);
    for (let depth = 0; depth < 16 && dir; depth++) {
      const candidate = path.join(dir, 'src', relativePath);
      if (fs.existsSync(candidate)) return require(candidate);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`Cannot locate src/${relativePath} from Konoha project MCP guard.`);
}

const guardrail = _resolveSrcModule('project_konoha_mcp_guardrail.js');
const {
  SUPPORTED_HARNESSES,
  normalizeHarness,
  findKonohaRepoRoot,
  evaluateProjectMcpGuardrail,
  formatHarnessDecision,
  describeGuardrailRemediation,
  readGuardrailExceptions,
  revokeGuardrailExceptions
} = guardrail;

function _parseArgs(argv) {
  const opts = {
    harness: process.env.KONOHA_CLIENT || process.env.KONOHA_HARNESS || 'antigravity',
    json: null,
    cwd: null,
    repoRoot: null,
    exitOnDeny: false,
    hitl: false,
    ttlMinutes: null,
    justification: null,
    acceptWithRisk: false,
    listExceptions: false,
    revokeExceptions: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--harness' || a === '--client') && argv[i + 1]) {
      opts.harness = argv[++i];
    } else if (a === '--json' && argv[i + 1]) {
      opts.json = argv[++i];
    } else if (a === '--cwd' && argv[i + 1]) {
      opts.cwd = argv[++i];
    } else if (a === '--repo-root' && argv[i + 1]) {
      opts.repoRoot = argv[++i];
    } else if (a === '--ttl-minutes' && argv[i + 1]) {
      opts.ttlMinutes = Number(argv[++i]);
    } else if (a === '--justification' && argv[i + 1]) {
      opts.justification = argv[++i];
    } else if (a === '--exit-on-deny') {
      opts.exitOnDeny = true;
    } else if (a === '--hitl') {
      opts.hitl = true;
    } else if (a === '--accept-with-risk') {
      opts.acceptWithRisk = true;
      opts.hitl = true;
    } else if (a === '--list-exceptions') {
      opts.listExceptions = true;
    } else if (a === '--revoke-exceptions') {
      opts.revokeExceptions = true;
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

function _parsePayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

/**
 * An explicit `--repo-root` names the exception store the caller wants, so it is
 * taken as given; only a discovered cwd has to prove it is a Konoha checkout.
 */
function _resolveRepoRoot(opts) {
  if (opts.repoRoot) return path.resolve(opts.repoRoot);
  return findKonohaRepoRoot(opts.cwd || process.cwd());
}

function _emitListExceptions(repoRoot) {
  const entries = readGuardrailExceptions(repoRoot);
  if (!entries.length) {
    process.stdout.write('No active guardrail exceptions.\n');
    return 0;
  }
  process.stdout.write(`Active guardrail exceptions (${entries.length}):\n`);
  for (const e of entries) {
    process.stdout.write(`  ${e.id}  ${e.code}  tool=${e.tool}  path=${e.path}  expires=${e.expires_at}  by=${e.accepted_by}\n`);
  }
  return 0;
}

async function _runHitl(opts, evalResult, repoRoot, payload) {
  const { runHitlSession, hasControllingTerminal } = _resolveSrcModule('guardrail_hitl.js');

  if (opts.acceptWithRisk || opts.justification) {
    // Non-interactive acceptance: the caller already decided, the audit trail
    // still demands a written justification.
    const { recordGuardrailException } = guardrail;
    if (!opts.justification || opts.justification.trim().length < 8) {
      process.stderr.write('--accept-with-risk requires --justification "why this risk is acceptable".\n');
      return 2;
    }
    const targetPath = (payload.tool_input && (payload.tool_input.path || payload.tool_input.file_path)) || '';
    recordGuardrailException(repoRoot, {
      code: evalResult.code,
      tool: payload.tool_name || payload.toolName || payload.tool || '*',
      targetPath,
      justification: opts.justification,
      harness: evalResult.harness,
      ttlMs: (Number.isFinite(opts.ttlMinutes) && opts.ttlMinutes > 0 ? opts.ttlMinutes : 30) * 60 * 1000
    });
    const reEvaluated = evaluateProjectMcpGuardrail(payload, { harness: evalResult.harness, repoRoot });
    process.stdout.write(`${JSON.stringify(formatHarnessDecision(evalResult.harness, reEvaluated))}\n`);
    return reEvaluated.allowed ? 0 : 2;
  }

  if (!hasControllingTerminal()) {
    // Fail closed: a hook, a CI job, or a detached process has no keyboard.
    process.stderr.write(`${evalResult.reason}\n`);
    process.stderr.write(`Another way: ${describeGuardrailRemediation(evalResult.code)}\n`);
    process.stderr.write('No TTY available, so the call is blocked. Re-run interactively, or accept the risk explicitly with --accept-with-risk --justification "...".\n');
    return 2;
  }

  const session = await runHitlSession({
    payload,
    harness: evalResult.harness,
    repoRoot,
    ttlMinutes: opts.ttlMinutes,
    justification: opts.justification
  });
  const response = formatHarnessDecision(evalResult.harness, session.evaluation);
  process.stdout.write(`${JSON.stringify(response)}\n`);
  return session.evaluation.allowed ? 0 : 2;
}

function runCli(argv = process.argv) {
  const opts = _parseArgs(argv);
  const harness = normalizeHarness(opts.harness);
  const raw = opts.json || _readStdinSafe();

  const payload = _parsePayload(raw);
  const repoRoot = _resolveRepoRoot(opts);

  if (opts.listExceptions) {
    if (!repoRoot) {
      process.stderr.write('Not inside a Konoha repository; no exception store to list.\n');
      return { evalResult: null, response: null, exitCode: 2 };
    }
    return { evalResult: null, response: null, exitCode: _emitListExceptions(repoRoot) };
  }

  if (opts.revokeExceptions) {
    if (!repoRoot) {
      process.stderr.write('Not inside a Konoha repository; no exception store to revoke.\n');
      return { evalResult: null, response: null, exitCode: 2 };
    }
    const removed = revokeGuardrailExceptions(repoRoot);
    process.stdout.write(`Revoked ${removed} guardrail exception(s).\n`);
    return { evalResult: null, response: null, exitCode: 0 };
  }

  const evalOptions = { harness };
  if (opts.cwd) evalOptions.cwd = path.resolve(opts.cwd);
  // The store can be overridden away from the checkout; the call scope still comes from cwd.
  if (repoRoot) evalOptions.repoRoot = repoRoot;

  const evalResult = evaluateProjectMcpGuardrail(payload, evalOptions);

  if (opts.hitl && !evalResult.allowed) {
    const effectiveRepoRoot = repoRoot || evalResult.repo_root;
    if (!effectiveRepoRoot) {
      process.stderr.write('Not inside a Konoha repository; the project guardrail is inactive.\n');
      return { evalResult, response: null, exitCode: 2 };
    }
    return { evalResult, response: null, hitl: _runHitl(opts, evalResult, effectiveRepoRoot, payload) };
  }

  const response = formatHarnessDecision(harness, evalResult);
  process.stdout.write(`${JSON.stringify(response)}\n`);

  if (!evalResult.allowed && opts.exitOnDeny) {
    process.exitCode = 2;
  }
  return { evalResult, response, exitCode: evalResult.allowed ? 0 : (opts.exitOnDeny ? 2 : 0) };
}

if (require.main === module) {
  const result = runCli(process.argv);
  if (result.hitl) {
    result.hitl
      .then((code) => { process.exitCode = code; })
      .catch((err) => {
        process.stderr.write(`${err && err.message ? err.message : err}\n`);
        process.exitCode = 2;
      });
  } else if (result.exitCode) {
    process.exitCode = result.exitCode;
  }
}

module.exports = {
  SUPPORTED_HARNESSES,
  runCli
};
