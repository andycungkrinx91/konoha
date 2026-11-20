'use strict';

/**
 * src/mcp/subagent_spawner.js — Real OS subprocess lifecycle manager for Konoha subagents.
 * Guarantees isolated child processes, fail-closed unsupported-harness errors,
 * read-only and workspace propagation, timeout/AbortSignal cancellation, and orphan cleanup.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
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

/**
 * A `.cmd` harness is launched through `cmd.exe`, so the process we hold is not
 * the process doing the work: killing it alone orphans the harness. Windows has
 * no signal that reaches a tree, so `taskkill /T` is the only way to take the
 * child down with its parent. Elsewhere the plain signals already reach it.
 */
function windowsKillInvocation(pid, force) {
  const system32 = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'taskkill.exe') : null;
  const taskkill = system32 && fs.existsSync(system32) ? system32 : 'taskkill';
  return { command: taskkill, args: ['/pid', String(pid), '/T', ...(force ? ['/F'] : [])] };
}

function _killProcessTree(child, force) {
  if (process.platform !== 'win32') {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
    return;
  }
  const { command, args } = windowsKillInvocation(child.pid, force);
  spawnSync(command, args, { windowsHide: true, stdio: 'ignore', timeout: 10000 });
}

function terminateChildGracefully(child, graceMs = KILL_GRACE_MS) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    _killProcessTree(child, false);
  } catch (_) { /* ignore ESRCH */ }
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        _killProcessTree(child, true);
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

/**
 * Harness binaries in preference order, paired with the client key their
 * invocation template is registered under. Used only when a caller asks for a
 * real child process without naming a harness — the `cli`/`universal` case,
 * where the fallback exists precisely because no harness could be identified.
 */
const HARNESS_PATH_ORDER = Object.freeze([
  ['omp', 'omp'],
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['cursor', 'cursor-agent'],
  ['opencode', 'opencode'],
  ['commandcode', 'command-code'],
  ['antigravity', 'agy'],
  ['pi', 'pi']
]);

function findExecutableOnPath(bin) {
  const isWindows = process.platform === 'win32';
  const exts = isWindows
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        // POSIX has no PATHEXT: a same-named non-executable file is not the
        // binary, and selecting it would turn a resolvable harness into EACCES.
        if (!isWindows && (stat.mode & 0o111) === 0) continue;
        return candidate;
      } catch (_) { /* not in this directory */ }
    }
  }
  return null;
}

function resolveInstalledHarnessClient() {
  for (const [client, bin] of HARNESS_PATH_ORDER) {
    if (findExecutableOnPath(bin)) return client;
  }
  return null;
}

/** Harness client key → headless binary that can run a prompt non-interactively. */
const HARNESS_BINARIES = Object.freeze({
  claude: 'claude',
  cursor: 'cursor-agent',
  codex: 'codex',
  opencode: 'opencode',
  commandcode: 'command-code',
  omp: 'omp',
  antigravity: 'agy',
  pi: 'pi'
});

function canonicalClientKey(client) {
  const key = String(client || '').toLowerCase();
  return key === 'claudecode' ? 'claude' : key;
}

/**
 * Windows installs npm/pnpm CLIs as `.cmd` shims, and Node refuses to spawn a
 * `.cmd`/`.bat` without a shell (EINVAL since the CVE-2024-27980 fix). cmd.exe
 * also treats a newline as a command separator, so a multi-line prompt cannot
 * ride the command line at all: newlines become spaces on this route only.
 *
 * `ponytail:` newline flattening is lossless for prose and cosmetic for code
 * blocks; `%NAME%` still expands because cmd does that even inside quotes.
 * Upgrade by writing the prompt to a file once a harness is known to read one.
 */
function _windowsShimSpec(binPath, args) {
  const quote = (value) => `"${String(value).replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
  const line = [binPath, ...args].map(quote).join(' ');
  return {
    // The extra outer pair is what `/s` strips, leaving the inner quoting intact.
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true
  };
}

function _platformHarnessSpec(spec) {
  const command = path.isAbsolute(spec.command)
    ? spec.command
    : (findExecutableOnPath(spec.command) || spec.command);
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { ...spec, command };
  }
  return _windowsShimSpec(command, spec.args);
}

function _harnessInvocation(client, { agent, prompt, fullPrompt, harnessBin, readOnly }) {
  const canonicalClient = canonicalClientKey(client);
  const bin = harnessBin || HARNESS_BINARIES[canonicalClient];

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
      // OMP has no `--agent` flag (oclif rejects it outright, exit 2), so the
      // specialist identity travels as appended system-prompt text.
      return {
        command: bin,
        args: ['-p', '--append-system-prompt', `You are the Konoha @${agent} subagent.`, message]
      };
    case 'cursor':
    case 'commandcode':
    case 'antigravity':
    case 'pi':
      return { command: bin, args: ['-p', message] };
    default:
      return null;
  }
}

function buildHarnessCommand(client, options = {}) {
  const spec = _harnessInvocation(client, options);
  return spec ? _platformHarnessSpec(spec) : null;
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
  const wantsChildProcess = Boolean(options.execute || options.harnessBin);
  if (key === 'cli' && !wantsChildProcess) {
    return { ok: true, client: 'cli', descriptor: { supported: true, client: 'cli', tool: null, generic: true } };
  }
  // `cli`/`universal` mean "no harness was identified"; for a real child process
  // that has to become the installed one, or nothing can be launched at all.
  const effectiveKey = (key === 'cli' || key === 'universal') && wantsChildProcess
    ? (resolveInstalledHarnessClient() || key)
    : canonicalClientKey(key);
  if (wantsChildProcess) {
    // A real child process needs the harness *binary*, not the harness's
    // in-session subagent tool: `pi -p` runs a prompt fine without the
    // pi-subagents extension, so requiring native tool support here refused a
    // spawn the machine could actually perform.
    const bin = options.harnessBin || HARNESS_BINARIES[effectiveKey];
    if (!bin) {
      return {
        ok: false,
        client: effectiveKey,
        payload: buildUnsupportedSpawnPayload(effectiveKey, `No headless harness invocation configured for "${effectiveKey}".`)
      };
    }
    return {
      ok: true,
      client: effectiveKey,
      descriptor: { supported: true, client: effectiveKey, tool: null, generic: true, headlessBin: bin }
    };
  }
  const descriptor = resolveSpawnDescriptor(effectiveKey, options);
  if (!descriptor.supported) {
    return {
      ok: false,
      client: effectiveKey,
      payload: buildUnsupportedSpawnPayload(effectiveKey, descriptor.error)
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
        // Cancelled before launch: no child ever existed.
        spawn_state: 'directive_only',
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
        windowsVerbatimArguments: Boolean(cmdSpec.windowsVerbatimArguments),
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
    // Fixed vocabulary: directive_only | completed | failed. A timeout or abort
    // is a failure, not a state of its own.
    spawn_state: 'failed',
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
  const { normalizedAgent, capability, projectPath, effectiveCwd, readOnly, timeoutMs, graceMs, useHarnessBinary, command, args, stdinPayload, windowsVerbatimArguments } = spec;
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
        ...(windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
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
        spawn_state: 'failed',
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
        spawn_state: 'completed',
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
  buildRawHarnessInvocation: _harnessInvocation,
  findExecutableOnPath,
  resolveInstalledHarnessClient,
  windowsKillInvocation,
  validateSpawnCapability,
  spawnSubagent,
  spawnParallelSubagents
};
