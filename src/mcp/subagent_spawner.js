'use strict';

/**
 * src/mcp/subagent_spawner.js — Real OS subprocess lifecycle manager for Konoha subagents.
 * Guarantees isolated child processes, fail-closed unsupported-harness errors,
 * read-only and workspace propagation, timeout/AbortSignal cancellation, and orphan cleanup.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isReadOnlyAgent } = require('../agent_file_safety');
const { normalizeAgentName } = require('../canonical_agents');
const { resolveSpawnDescriptor, buildUnsupportedSpawnPayload } = require('./lazy_subagent');
const { reportFromAgent } = require('./memory_project_context');

const WORKER_SCRIPT = path.join(__dirname, 'subagent_worker.js');
const DEFAULT_TIMEOUT_MS = 120000;
const KILL_GRACE_MS = 300;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const activeChildren = new Set();
let shutdownHooksRegistered = false;

function terminateChildGracefully(child, graceMs = KILL_GRACE_MS) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch (_) { /* ignore ESRCH */ }
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch (_) { /* ignore ESRCH */ }
    }
  }, graceMs);
  if (typeof killTimer.unref === 'function') killTimer.unref();
}

function registerParentShutdownHooks() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const cleanup = () => {
    for (const child of activeChildren) {
      terminateChildGracefully(child, 50);
    }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
}

function getActiveChildCount() {
  return activeChildren.size;
}

function buildHarnessCommand(client, { agent, prompt, fullPrompt, harnessBin, readOnly }) {
  const canonicalClient = String(client || '').toLowerCase() === 'claudecode' ? 'claude' : String(client || '').toLowerCase();
  const bin = harnessBin || ({
    claude: 'claude',
    cursor: 'cursor-agent',
    codex: 'codex',
    opencode: 'opencode',
    commandcode: 'command-code',
    omp: 'omp',
    antigravity: 'agy',
    agy: 'agy',
    pi: 'pi'
  })[canonicalClient];

  if (!bin) return null;
  const message = fullPrompt || prompt || '';

  switch (canonicalClient) {
    case 'claude': {
      const args = ['-p', message, '--output-format', 'json'];
      if (readOnly) {
        args.push('--disallowedTools', 'Write,Edit,Bash,NotebookEdit,Agent');
      }
      return { command: bin, args };
    }
    case 'codex':
      return {
        command: bin,
        args: ['exec', '--json', ...(readOnly ? ['-s', 'read-only'] : []), message]
      };
    case 'opencode':
      return { command: bin, args: ['run', '--format', 'json', '--agent', agent, message] };
    case 'omp':
      return { command: bin, args: ['-p', '--agent', agent, message] };
    case 'cursor':
    case 'commandcode':
    case 'antigravity':
    case 'agy':
    case 'pi':
      return { command: bin, args: ['-p', message] };
    default:
      return null;
  }
}

function buildChildEnv(agent, projectPath, cwd, client) {
  const readOnly = isReadOnlyAgent(agent);
  const env = { ...process.env };
  env.KONOHA_IS_CHILD_WORKER = '1';
  env.KONOHA_CHILD_AGENT = agent;
  env.KONOHA_CHILD_CLIENT = client || 'cli';
  env.KONOHA_READONLY = readOnly ? '1' : '0';
  if (projectPath) {
    env.KONOHA_WORKSPACE = projectPath;
    env.WORKSPACE_ROOT = projectPath;
  }
  if (cwd) {
    env.KONOHA_WORKTREE = cwd;
  }
  return env;
}

function validateSpawnCapability(client, options = {}) {
  const key = String(client || 'cli').toLowerCase().trim();
  if (key === 'cli' && !options.execute) {
    return { ok: true, client: 'cli', descriptor: { supported: true, client: 'cli', tool: null, generic: true } };
  }
  const descriptor = resolveSpawnDescriptor(key, options);
  if (!descriptor.supported) {
    return {
      ok: false,
      client: key,
      payload: buildUnsupportedSpawnPayload(key, descriptor.error)
    };
  }
  return { ok: true, client: descriptor.client, descriptor };
}

function appendBounded(chunks, chunk, state) {
  if (state.bytes >= MAX_OUTPUT_BYTES) return;
  const remaining = MAX_OUTPUT_BYTES - state.bytes;
  const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  chunks.push(slice);
  state.bytes += slice.length;
}

function parseJsonlOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { events: [], last: {} };
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') events.push(obj);
    } catch (_) { /* skip non-JSON diagnostic lines */ }
  }
  if (events.length === 0) {
    try {
      const whole = JSON.parse(text);
      if (whole && typeof whole === 'object') return { events: [whole], last: whole };
    } catch (_) { /* non-JSON output */ }
    return { events: [], last: {} };
  }
  const merged = Object.assign({}, ...events.filter((e) => !Array.isArray(e)));
  return { events, last: merged };
}

function _prepareSpawnSpec(options) {
  const { getDeployableAgentNames } = require('../canonical_agents');
  const normalizedAgent = normalizeAgentName(options.agent || '');
  const validAgents = getDeployableAgentNames().filter((n) => n !== 'sannin');
  if (!validAgents.includes(normalizedAgent)) {
    return {
      ok: false,
      payload: {
        ok: false,
        status: 'error',
        error_code: 'INVALID_AGENT',
        error: `Unknown or non-worker subagent "${options.agent}". Supported workers: ${validAgents.join(', ')}`
      }
    };
  }

  const capability = validateSpawnCapability(options.client || 'cli', options);
  if (!capability.ok) return { ok: false, payload: capability.payload };

  if (options.signal && options.signal.aborted) {
    return {
      ok: false,
      payload: {
        ok: false,
        status: 'aborted',
        aborted: true,
        agent: normalizedAgent,
        client: capability.client,
        error_code: 'SPAWN_ABORTED',
        error: 'Subagent spawn cancelled before launch.'
      }
    };
  }

  const projectPath = options.projectPath ? path.resolve(options.projectPath) : process.cwd();
  const workDir = options.cwd ? path.resolve(options.cwd) : projectPath;
  const effectiveCwd = fs.existsSync(workDir) ? workDir : process.cwd();
  const readOnly = isReadOnlyAgent(normalizedAgent);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  let mergedConstraints = options.constraints || null;
  if (options.taskDir) {
    try {
      const { peekPendingAdvisorSteers, acknowledgeAdvisorSteers, formatSteerInjectionBlock } = require('../workflow/kage-reviewer/advisor_steering');
      const pending = peekPendingAdvisorSteers(options.taskDir, normalizedAgent);
      if (pending.length > 0) {
        const steerBlock = formatSteerInjectionBlock(pending);
        mergedConstraints = [steerBlock, mergedConstraints].filter(Boolean).join('\n\n');
        acknowledgeAdvisorSteers(options.taskDir, normalizedAgent, pending.map((s) => s.id));
      }
    } catch (_) { /* best-effort steer delivery */ }
  }
  const graceMs = Number.isFinite(options.killGraceMs) && options.killGraceMs > 0 ? options.killGraceMs : KILL_GRACE_MS;
  const useHarnessBinary = Boolean(options.execute || options.harnessBin);

  const baseSpec = {
    normalizedAgent,
    capability,
    projectPath,
    effectiveCwd,
    readOnly,
    timeoutMs,
    graceMs
  };

  if (useHarnessBinary) {
    const basePrompt = options.task || '';
    const baseFullPrompt = options.fullPrompt || basePrompt;
    const cmdSpec = buildHarnessCommand(capability.client, {
      agent: normalizedAgent,
      prompt: mergedConstraints ? `${mergedConstraints}\n\n${basePrompt}`.trim() : basePrompt,
      fullPrompt: mergedConstraints ? `${mergedConstraints}\n\n${baseFullPrompt}`.trim() : baseFullPrompt,
      harnessBin: options.harnessBin,
      readOnly
    });
    if (!cmdSpec) {
      return {
        ok: false,
        payload: buildUnsupportedSpawnPayload(capability.client, `No headless harness invocation configured for "${capability.client}".`)
      };
    }
    return {
      ok: true,
      spec: {
        ...baseSpec,
        useHarnessBinary: true,
        command: cmdSpec.command,
        args: cmdSpec.args,
        stdinPayload: null
      }
    };
  }

  return {
    ok: true,
    spec: {
      ...baseSpec,
      useHarnessBinary: false,
      command: process.execPath,
      args: [WORKER_SCRIPT],
      stdinPayload: JSON.stringify({
        agent: normalizedAgent,
        task: options.task || '',
        context: options.context || null,
        constraints: mergedConstraints,
        skills: Array.isArray(options.skills) ? options.skills : [],
        projectPath,
        cwd: effectiveCwd,
        taskDir: options.taskDir || null,
        sessionId: options.sessionId || null,
        flowHash: options.flowHash || null,
        taskId: options.taskId || null,
        client: capability.client,
        autoReport: Boolean(options.autoReport),
        dispatchId: options.dispatchId || null,
        parentPid: process.pid
      })
    }
  };
}

function _buildFailureExitResult({
  aborted,
  timedOut,
  code,
  signal,
  elapsedMs,
  stdout,
  stderr,
  normalizedAgent,
  client,
  childPid,
  timeoutMs
}) {
  if (!aborted && !timedOut && code === 0) return null;
  const kind = aborted
    ? { status: 'aborted', flagKey: 'aborted', errorCode: 'SPAWN_ABORTED', error: `Subagent "${normalizedAgent}" was cancelled via AbortSignal.` }
    : timedOut
      ? { status: 'timeout', flagKey: 'timed_out', errorCode: 'SPAWN_TIMEOUT', error: `Subagent "${normalizedAgent}" exceeded ${timeoutMs}ms execution timeout.` }
      : {
          status: 'failed',
          flagKey: null,
          errorCode: 'SPAWN_NONZERO_EXIT',
          error: `Subagent "${normalizedAgent}" exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 240)}` : ''}`
        };

  return {
    ok: false,
    status: kind.status,
    ...(kind.flagKey ? { [kind.flagKey]: true } : {}),
    agent: normalizedAgent,
    client,
    child_pid: childPid,
    exit_code: code,
    signal,
    elapsed_ms: elapsedMs,
    stdout,
    stderr,
    error_code: kind.errorCode,
    error: kind.error
  };
}

function _resolveChildAutoReport({ useHarnessBinary, options, normalizedAgent, client, childPid, projectPath, parsed }) {
  let autoReported = Boolean(parsed.auto_reported);
  let reportEvidence = parsed.report_evidence;
  if (!useHarnessBinary || !options.autoReport || !options.taskDir) {
    return { autoReported, reportEvidence };
  }
  try {
    const reportRaw = reportFromAgent({
      agent_name: normalizedAgent,
      summary: `Child specialist @${normalizedAgent} completed task on client=${client}: ${String(options.task || '').slice(0, 120)}`,
      status: 'completed',
      validation: [`child_spawn_verified:${normalizedAgent}:${client}:pid_${childPid} (exit 0)`],
      task_dir: options.taskDir,
      task_id: options.taskId || path.basename(options.taskDir),
      dispatch_id: options.dispatchId || undefined,
      project_path: projectPath
    });
    return { autoReported: true, reportEvidence: JSON.parse(reportRaw) };
  } catch (_) {
    return { autoReported: false, reportEvidence };
  }
}

function _writeChildStdin(child, stdinPayload) {
  try {
    if (stdinPayload !== null) child.stdin.end(stdinPayload);
    else child.stdin.end();
  } catch (_) { /* ignore broken pipe on fast exit */ }
}

function _executeSpawnSpec(spec, options, childEnv, startedAt) {
  const { normalizedAgent, capability, projectPath, effectiveCwd, readOnly, timeoutMs, graceMs, useHarnessBinary, command, args, stdinPayload } = spec;
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timeoutTimer = null;
    const outChunks = [];
    const errChunks = [];
    const outState = { bytes: 0 };
    const errState = { bytes: 0 };

    let child;
    try {
      child = spawn(command, args, {
        cwd: effectiveCwd,
        env: childEnv,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (spawnErr) {
      resolve({
        ok: false,
        status: 'error',
        agent: normalizedAgent,
        client: capability.client,
        error_code: 'SPAWN_LAUNCH_FAILED',
        error: spawnErr.message
      });
      return;
    }

    activeChildren.add(child);
    const childPid = child.pid;
    const onAbort = () => {
      aborted = true;
      terminateChildGracefully(child, graceMs);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      activeChildren.delete(child);
      resolve(result);
    };

    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateChildGracefully(child, graceMs);
    }, timeoutMs);
    if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

    child.stdout.on('data', (chunk) => appendBounded(outChunks, chunk, outState));
    child.stderr.on('data', (chunk) => appendBounded(errChunks, chunk, errState));

    child.on('error', (err) => {
      finish({
        ok: false,
        status: 'error',
        agent: normalizedAgent,
        client: capability.client,
        child_pid: childPid || null,
        elapsed_ms: Date.now() - startedAt,
        error_code: err.code === 'ENOENT' ? 'HARNESS_BINARY_NOT_FOUND' : 'SPAWN_PROCESS_ERROR',
        error: err.message
      });
    });

    child.on('close', (code, signal) => {
      const elapsedMs = Date.now() - startedAt;
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      const failed = _buildFailureExitResult({
        aborted,
        timedOut,
        code,
        signal,
        elapsedMs,
        stdout,
        stderr,
        normalizedAgent,
        client: capability.client,
        childPid,
        timeoutMs
      });
      if (failed) {
        finish(failed);
        return;
      }

      const jsonl = parseJsonlOutput(stdout);
      const parsed = jsonl.last || {};
      const { autoReported, reportEvidence } = _resolveChildAutoReport({
        useHarnessBinary,
        options,
        normalizedAgent,
        client: capability.client,
        childPid,
        projectPath,
        parsed
      });

      finish({
        ...parsed,
        ok: true,
        status: parsed.status || 'completed',
        agent: normalizedAgent,
        client: capability.client,
        child_pid: parsed.child_pid || childPid,
        parent_pid: process.pid,
        effective_cwd: parsed.effective_cwd || effectiveCwd,
        read_only_enforced: readOnly,
        exit_code: 0,
        elapsed_ms: elapsedMs,
        jsonl_events: jsonl.events,
        raw_stdout: stdout,
        raw_stderr: stderr,
        auto_reported: autoReported,
        report_evidence: reportEvidence,
        task_context_received: Boolean(options.task)
      });
    });

    _writeChildStdin(child, stdinPayload);
  });
}

async function spawnSubagent(options = {}) {
  const prepared = _prepareSpawnSpec(options);
  if (!prepared.ok) return prepared.payload;

  registerParentShutdownHooks();
  const startedAt = Date.now();
  const childEnv = buildChildEnv(
    prepared.spec.normalizedAgent,
    prepared.spec.projectPath,
    prepared.spec.effectiveCwd,
    prepared.spec.capability.client
  );
  return _executeSpawnSpec(prepared.spec, options, childEnv, startedAt);
}

async function spawnParallelSubagents(dispatches = [], sharedOptions = {}) {
  if (!Array.isArray(dispatches) || dispatches.length === 0) {
    return { ok: true, parallel: true, results: [] };
  }
  const client = sharedOptions.client || 'cli';
  const capability = validateSpawnCapability(client, sharedOptions);
  if (!capability.ok) {
    return {
      ok: false,
      parallel: true,
      ...capability.payload,
      results: []
    };
  }

  const results = await Promise.all(
    dispatches.map((entry) => spawnSubagent({
      ...sharedOptions,
      ...entry,
      client: entry.client || client
    }))
  );
  const allOk = results.every((r) => r && r.ok);
  return {
    ok: allOk,
    parallel: true,
    client: capability.client,
    results
  };
}

module.exports = {
  WORKER_SCRIPT,
  DEFAULT_TIMEOUT_MS,
  KILL_GRACE_MS,
  getActiveChildCount,
  buildHarnessCommand,
  validateSpawnCapability,
  spawnSubagent,
  spawnParallelSubagents
};
