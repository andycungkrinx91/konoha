'use strict';

/**
 * Live Agentic Blender Session driver.
 * Spawns a real Blender process running blender_live_worker.py, relays genuine
 * per-step telemetry (mesh statistics, render snapshots, timing) to the workflow,
 * and enforces single-instance system-wide execution via ~/.konoha/blender.lock.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { globalCircuitRegistry } = require('../../circuit_breaker');
const { findInstalledBlenderBinary, getBlenderStatus, getDccMcpStatus } = require('./blender_installer');
const { resolveStageCompute, normalizeGpuBackend } = require('./compute_selector');
const {
  liveQueueDir, liveWorkerLogPath, rotateWorkerLog, excerptWorkerLog,
  describeVanishedRequest,
  redactCredentials, setStoredPidResolver
} = require('./blender_worker_log');


const WORKER_SCRIPT = path.join(__dirname, 'blender_live_worker.py');
const LOCK_FILE = path.join(os.homedir(), '.konoha', 'blender.lock');
const ORGANIC_ARCHETYPES = new Set(['game-creature', 'game-character']);
const ORGANIC_HINT = /\b(creature|fox|kurama|wolf|quadruped|organic|beast|fur|animal|dragon)\b/i;

let activeBlenderProcess = null;

function readLock() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return null;
    const raw = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    if (!raw) return null;
    if (raw.startsWith('{')) return JSON.parse(raw);
    return { pid: Number(raw) };
  } catch (_) {
    return null;
  }
}

function getStoredPid() {
  const lock = readLock();
  const pid = lock && Number(lock.pid);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (_) {
    clearLockFile();
    return null;
  }
}

function writeLockFile(payload) {
  try {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify(payload), 'utf-8');
  } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
}

function clearLockFile() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
}

function getLiveBlenderStatus() {
  const lock = readLock();
  const pid = getStoredPid();
  if (pid) {
    return { running: true, pid, mode: (lock && lock.mode) || 'live_headless', blender_version: lock && lock.blender_version };
  }
  if (activeBlenderProcess && !activeBlenderProcess.killed) {
    try {
      process.kill(activeBlenderProcess.pid, 0);
      return { running: true, pid: activeBlenderProcess.pid, mode: 'active_session' };
    } catch (_) {
      activeBlenderProcess = null;
    }
  }
  return { running: false, pid: null, mode: null };
}

function closeLiveBlenderSession() {
  const pid = getStoredPid() || (activeBlenderProcess && activeBlenderProcess.pid);
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
  }
  activeBlenderProcess = null;
  clearLockFile();
  return { success: true, closed: Boolean(pid) };
}

setStoredPidResolver(getStoredPid);

function isOrganicRequest(spec, prompt) {
  const archetype = String((spec && spec.archetype) || '').toLowerCase();
  return ORGANIC_ARCHETYPES.has(archetype) || ORGANIC_HINT.test(String(prompt || ''));
}

function collectMaterialSpecs(spec) {
  const out = {};
  const nodes = (spec && Array.isArray(spec.nodes)) ? spec.nodes : [];
  const walk = (list) => {
    for (const node of list) {
      if (node.csg && Array.isArray(node.csg.operands)) {
        walk(node.csg.operands);
        continue;
      }
      if (node.material && node.name && !out[node.name]) out[node.name] = node.material;
    }
  };
  walk(nodes);
  return out;
}

function buildInspectionConfig(options) {
  const spec = options.spec || {};
  const requested = options.inspection || {};
  const outputSize = options.outputSize
    || (spec && spec.output_size)
    || { width: 1024, height: 576 };
  const views = Array.isArray(requested.views) && requested.views.length
    ? requested.views
    : ['front', 'side', 'top', 'three_quarter'];
  return {
    enabled: requested.enabled !== false,
    views,
    only_views: Array.isArray(requested.only_views) ? requested.only_views : [],
    output_size: { width: outputSize.width, height: outputSize.height }
  };
}

function buildWorkerConfig(options) {
  const spec = options.spec || {};
  const prompt = options.prompt || '';
  const preferredBackend = normalizeGpuBackend(options.requestedGpuBackend || options.preferredBackend);
  const compute = resolveStageCompute(
    options.requestedComputeMode || 'auto',
    preferredBackend ? { preferredBackend } : {}
  );
  const turnaround = (spec && spec.turnaround) || {};
  const intermediateDir = options.intermediateDir;
  const organic = isOrganicRequest(spec, prompt);
  const inspection = buildInspectionConfig(options);
  return {
    base_glb_path: options.baseGlbPath,
    live_glb_path: path.join(intermediateDir, 'live_step.glb'),
    live_preview_path: path.join(intermediateDir, 'live_preview.png'),
    final_glb_path: path.join(options.stagingDir, 'model.glb'),
    preview_png_path: path.join(options.stagingDir, 'preview.png'),
    inspection_grid_path: path.join(options.stagingDir, 'inspection_grid.png'),
    organic,
    prompt,
    palette: (spec && spec.palette) || null,
    materials: collectMaterialSpecs(spec),
    turnaround,
    flat_studio_lighting: Boolean(turnaround.flatStudioLighting),
    gpu_backend: compute.backend,
    // The requested backend travels with the job so the worker can report which
    // backend was asked for even after degrading to another one (or to CPU).
    requested_gpu_backend: compute.preferredBackendApplied ? compute.backend : (preferredBackend || null),
    compute_mode: compute.effectiveMode,
    requested_compute_mode: compute.requestedMode,
    output_size: inspection.output_size,
    inspection,
    patches: Array.isArray(options.patches) ? options.patches : [],
    cycles_samples: options.cyclesSamples || (process.env.KONOHA_CYCLES_SAMPLES ? parseInt(process.env.KONOHA_CYCLES_SAMPLES, 10) : 64),
    mirror_x: Boolean(options.mirrorX ?? (spec && spec.symmetry && spec.symmetry.mirror_x)),
    metaballs: organic && Boolean(options.metaballs ?? (spec && spec.organic && spec.organic.metaballs)),
    enable_pbr: options.enablePbr !== false
  };
}

function parseTelemetryLines(buffer, state, onLine) {
  const combined = state.remainder + buffer;
  const lines = combined.split('\n');
  state.remainder = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('KONOHA_BLENDER_STEP ')) continue;
    try {
      onLine(JSON.parse(trimmed.slice('KONOHA_BLENDER_STEP '.length)));
    } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
  }
}

function streamBlenderWorker({ blenderBin, configPath, onLine }) {
  return new Promise((resolve) => {
    const proc = spawn(blenderBin, [
      '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1',
      '--python', WORKER_SCRIPT, '--', '--batch', configPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    writeLockFile({ pid: proc.pid, mode: 'live_headless', worker: 'blender_live_worker.py', started_at: Date.now() });

    activeBlenderProcess = proc;
    const state = { remainder: '' };
    const stderrTail = [];
    proc.stdout.on('data', (chunk) => parseTelemetryLines(chunk.toString('utf8'), state, onLine));
    proc.stderr.on('data', (chunk) => {
      stderrTail.push(chunk.toString('utf8'));
      if (stderrTail.length > 40) stderrTail.shift();
    });
    let settled = false;
    const settle = (code) => {
      if (settled) return;
      settled = true;
      activeBlenderProcess = null;
      clearLockFile();
      resolve({ code: typeof code === 'number' ? code : 0, stderr: stderrTail.join('') });
    };
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ code: -1, error: err.message, stderr: '' });
    });
    proc.on('close', (code) => settle(code));
    proc.on('exit', (code) => {
      setTimeout(() => settle(code), 250);
    });
  });
}

const TOTAL_AGENT_STEPS = 6;

async function ensureLiveBlenderSession(options = {}) {
  if (options.autoLaunch === false) return getLiveBlenderStatus();
  const existing = getLiveBlenderStatus();
  if (existing.running) return { running: true, pid: existing.pid, mode: existing.mode, reused: true };

  const blenderBin = findInstalledBlenderBinary();
  if (!blenderBin) return { running: false, mode: 'unavailable', reason: 'No Blender executable found on this host' };
  if (!options.gui) return { running: false, mode: 'headless_available', reason: 'GUI not requested' };

  const queue = liveQueueDir();
  fs.mkdirSync(queue, { recursive: true });
  const logPath = liveWorkerLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateWorkerLog(logPath);
  const logFd = fs.openSync(logPath, 'a');
  let proc;
  try {
    proc = spawn(blenderBin, ['--python', WORKER_SCRIPT, '--', '--server', queue], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env }
    });
  } finally {
    fs.closeSync(logFd);
  }
  let spawnError = null;
  proc.on('error', (error) => { spawnError = error.message; });
  proc.unref();
  writeLockFile({ pid: proc.pid, mode: 'live_gui', worker: 'blender_live_worker.py', started_at: Date.now() });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  if (spawnError) {
    clearLockFile();
    return { running: false, mode: 'spawn_failed', reason: spawnError, log_path: logPath };
  }
  return { running: true, pid: proc.pid, mode: 'live_gui', queue_dir: queue, log_path: logPath };
}

/**
 * Pure request-scoped delivery decision for queue polling.
 *
 * The queue directory is shared with a long-lived server worker, so ownership is
 * established by two server-side facts rather than by coarse file timestamps:
 * the worker names every telemetry record `<requestId>.<seq>.output.json` inside
 * this request's own subdirectory and stamps it with the matching `request_id`.
 * Nothing else can land here, so parallel or retried requests can never replay
 * steps, and a step emitted inside the request's first millisecond is still
 * delivered (the previous `mtimeMs < requestStartedAt` guard dropped exactly
 * those steps on filesystems with second-granularity timestamps).
 */
function resolveQueueRecord(fileName, requestId) {
  if (!fileName.startsWith(`${requestId}.`) || !fileName.endsWith('.output.json')) return null;
  const sequence = Number(fileName.slice(requestId.length + 1, -'.output.json'.length));
  if (!Number.isFinite(sequence)) return null;
  return { fileName, sequence };
}

/**
 * Delivers every not-yet-seen record in ascending emission order and returns the
 * highest sequence number handled. `accept` returns 'delivered', 'retry' (the
 * record was unreadable and is retried on the next pass) or 'drop' (foreign or
 * duplicate record, never redelivered). Records are only marked seen once
 * delivered, so a telemetry write racing the poll is not swallowed.
 */
function drainQueueRecords(records, state, accept) {
  let handled = state.lastSequence;
  const ordered = records
    .filter((record) => record.sequence > state.lastSequence && !state.seen.has(record.fileName))
    .sort((left, right) => left.sequence - right.sequence);
  for (const record of ordered) {
    const outcome = accept(record);
    if (outcome === 'retry') continue;
    state.seen.add(record.fileName);
    handled = Math.max(handled, record.sequence);
  }
  state.lastSequence = handled;
  return handled;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listQueueRecords(dir, requestId) {
  try {
    return fs.readdirSync(dir).map((fileName) => resolveQueueRecord(fileName, requestId)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function resolveResultOutcome(result) {
  if (result.success !== false) return { code: 0, error: null };
  const reportedError = typeof result.error === 'string' && result.error.trim();
  if (reportedError) return { code: 1, error: reportedError };
  return { code: 1, error: `Live Blender session reported failure without an error message (result: ${JSON.stringify(result).slice(0, 300)})` };
}

async function dispatchToLiveSession(config, onLine, timeoutMs = 600000) {
  const queueRoot = liveQueueDir();
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  // Request-scoped subdirectory: the worker writes its telemetry here with
  // KONOHA_BLENDER_REQUEST_ID pinned to requestId (see blender_live_worker.py).
  const queue = path.join(queueRoot, requestId);
  fs.mkdirSync(queue, { recursive: true });
  const requestPath = path.join(queue, `${requestId}.request.json`);
  // The worker claims the request by renaming it to <id>.request.json.running, so
  // the bare request file legitimately disappears while the steps execute.
  const runningPath = `${requestPath}.running`;
  const resultPath = path.join(queue, `${requestId}.result.json`);
  const cancelPath = path.join(queue, `${requestId}.cancel.json`);
  fs.writeFileSync(requestPath, JSON.stringify(config), 'utf8');

  const deadline = Date.now() + timeoutMs;
  const state = { seen: new Set(), lastSequence: -1 };
  const accept = (record) => {
    const envelope = readJsonFile(path.join(queue, record.fileName));
    if (!envelope) return 'retry';
    if (envelope.request_id !== requestId) return 'drop';
    onLine(envelope.payload);
    return 'delivered';
  };
  const finish = (outcome) => {
    try { fs.rmSync(queue, { recursive: true, force: true }); } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
    return outcome;
  };

  // One poll tick: a terminal outcome, or null while the request is alive. Every
  // non-null return is a real exit — completion, failure, abandonment, a vanished
  // request or a timeout — never a spin.
  const pollOutcome = () => {
    drainQueueRecords(listQueueRecords(queue, requestId), state, accept);
    const result = readJsonFile(resultPath);
    if (result) {
      // The worker writes the result right after its final emit(), so one rescan
      // picks up steps that landed during this tick with no wait and no lost tail.
      drainQueueRecords(listQueueRecords(queue, requestId), state, accept);
      return resolveResultOutcome(result);
    }
    if (fs.existsSync(cancelPath)) {
      const cancellation = readJsonFile(cancelPath);
      if (!cancellation) return { code: 1, error: 'Live Blender session request was abandoned; cancellation record is unreadable' };
      return { code: 1, error: `Live Blender session request was abandoned by the worker: ${cancellation.error || 'no reason reported'}` };
    }
    if (!fs.existsSync(requestPath) && !fs.existsSync(runningPath)) {
      return { code: 1, error: describeVanishedRequest('no request, running, result or cancel record in the request directory') };
    }
    if (Date.now() > deadline) {
      const logTail = excerptWorkerLog();
      const claim = fs.existsSync(runningPath) ? 'worker claimed the request but never wrote a result' : 'no worker claim was recorded';
      const message = `Live Blender session dispatch timed out (${claim}; log ${liveWorkerLogPath()})`;
      return { code: -1, error: logTail ? `${message}\nworker log tail:\n${logTail}` : message };
    }
    return null;
  };

  for (;;) {
    const outcome = pollOutcome();
    if (outcome) return finish(outcome);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Accumulates `step` telemetry exactly once per step_id. Duplicate delivery
 * (queue replay, both branches seeing one line) must never inflate the count to
 * fabricate a successful 6/6 session.
 */
function createStepTally() {
  const reportedIds = new Set();
  let duplicates = 0;
  return {
    /** Returns true when this step_id is new and therefore must be counted. */
    claim(payload) {
      const stepId = payload && payload.step_id;
      if (typeof stepId !== 'string' || !stepId) return false;
      if (reportedIds.has(stepId)) {
        duplicates += 1;
        return false;
      }
      reportedIds.add(stepId);
      return true;
    },
    duplicateCount: () => duplicates,
    size: () => reportedIds.size,
    ids: () => Array.from(reportedIds)
  };
}

/**
 * Expected executed-step count for a session. `worker_ready` carries no
 * total_steps from blender_live_worker.py, so the authoritative signal is the
 * final `worker_complete` record (python `len(STEPS)`); per-step `total_steps`
 * and the compiled-in constant are fallbacks only.
 */
function resolveExpectedSteps(workerReady, workerComplete, actions) {
  const candidates = [
    workerComplete && workerComplete.steps_executed,
    workerReady && workerReady.total_steps,
    actions.length > 0 && actions[actions.length - 1].total_steps
  ];
  for (const candidate of candidates) {
    const count = Number(candidate);
    if (Number.isFinite(count) && count > 0) return count;
  }
  return TOTAL_AGENT_STEPS;
}

function wrapAction(payload, context) {
  const metrics = payload.metrics || { actual_engine: payload.actual_engine };
  return {
    event: 'blender_agent_action',
    job_id: context.jobId,
    step_id: payload.step_id,
    step_number: payload.step_number,
    total_steps: payload.total_steps,
    step_name: payload.step_name,
    tool_used: payload.tool_used,
    parameters: metrics,
    status: payload.status,
    elapsed_ms: payload.elapsed_ms,
    compute_mode: context.compute.effectiveMode,
    compute_backend: context.compute.backend,
    purpose: payload.purpose || 'final',
    // Engine truth travels on the step and in its metrics (final steps).
    requested_gpu: payload.requested_gpu ?? metrics.requested_gpu, actual_engine: payload.actual_engine ?? metrics.actual_engine,
    gpu_unavailable: payload.gpu_unavailable ?? metrics.gpu_unavailable ?? null,
    live_glb_path: context.liveGlbPath, live_png_path: context.livePngPath,
    blender_version: payload.blender_version || context.blenderVersion, dcc_mcp_version: payload.dcc_mcp_version || context.dccVersion,
    timestamp: new Date().toISOString()
  };
}

/**
 * Honest compute truth for one session, never absorbing a CPU downgrade.
 *
 * A CPU render is always reported as `compute_device: 'CPU'` with
 * `gpu_unavailable: true`; a GPU render that survived only after failing another
 * GPU backend keeps `gpu_unavailable: false` but names the failed backend and
 * its error in `gpu_fallback_reason` (so the UI can say "OPTIX unavailable, used
 * CUDA"). A worker-reported total failure (every backend raised) is never dressed
 * up as a generic refinement failure: the reason names each backend and its error.
 */
function resolveComputeTruth({
  requestedGpu,
  requestedBackend,
  workerDevice,
  workerGpuUnavailable,
  workerFallbackReason,
  workerError
} = {}) {
  const backend = normalizeGpuBackend(requestedBackend);
  const deviceRaw = workerDevice === undefined || workerDevice === null ? null : String(workerDevice).toUpperCase();
  const emptyFallback = /^none of the requested backends is available/i.test(String(workerFallbackReason || ''));
  let device = deviceRaw;
  if (!device) device = emptyFallback ? 'CPU' : (backend || 'CPU');
  const cpu = device === 'CPU' || !device;
  const reason = workerFallbackReason || (workerError ? String(workerError) : null);
  return {
    requestedGpu: Boolean(requestedGpu || backend),
    requestedBackend: backend,
    device,
    gpuUnavailable: cpu ? true : Boolean(workerGpuUnavailable),
    fallbackReason: cpu ? (reason || 'CPU render; no GPU backend produced the output') : (reason || null)
  };
}

function _formatSessionResult(p) {
  return {
    success: p.success,
    mode: p.useLiveGui ? 'live_gui' : 'live_headless',
    refinement_backend: p.workerCompleted ? 'dcc_mcp_blender' : 'deterministic_only',
    blender_version: (p.workerReady && p.workerReady.blender_version) || p.blenderStatus.version,
    dcc_mcp_version: (p.workerReady && p.workerReady.dcc_mcp_version) || p.dccStatus.version,
    compute_backend: p.computeTruth.device === 'CPU' && p.compute.backend !== 'CPU' ? 'CYCLES' : p.compute.backend,
    effective_compute_mode: p.compute.effectiveMode,
    profile: p.profile,
    final_glb_path: p.config.final_glb_path,
    preview_png_path: p.config.preview_png_path,
    live_glb_path: p.config.live_glb_path,
    live_png_path: p.config.live_preview_path,
    inspection_grid_path: fs.existsSync(p.config.inspection_grid_path) ? p.config.inspection_grid_path : null,
    scene_report: p.lastMetrics.scene_report || null,
    compute_device: p.computeTruth.device,
    requested_gpu_backend: p.computeTruth.requestedBackend,
    gpu_unavailable: p.computeTruth.gpuUnavailable,
    requested_gpu: p.computeTruth.requestedGpu,
    actual_engine: p.lastMetrics.actual_engine ?? null,
    gpu_fallback_reason: p.computeTruth.fallbackReason,
    gpu_backend_attempts: Array.isArray(p.lastMetrics.render_attempts) ? p.lastMetrics.render_attempts : null,
    output_size: p.config.output_size,
    vertex_count: p.lastMetrics.vertices || 0,
    triangle_count: p.lastMetrics.triangles || 0,
    mesh_count: p.lastMetrics.meshes || 0,
    steps_executed: p.actions.length,
    expected_steps: p.expectedSteps,
    duplicate_steps_ignored: p.tally.duplicateCount(),
    step_ids: p.tally.ids(),
    actions: p.actions,
    error: p.workerError || null
  };
}

async function executeLiveAgenticBlenderSession(options) {
  const {
    baseGlbPath,
    intermediateDir,
    stagingDir,
    jobId,
    spec,
    profile = 'production_pbr',
    prompt = '',
    requestedComputeMode = 'auto',
    requestedGpuBackend = null,
    onAction = () => null,
    durableRefinementRequired = true
  } = options;

  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-dcc-mcp-blender', 3, 60);
  const pinnedBackend = normalizeGpuBackend(requestedGpuBackend || options.preferredBackend);
  const compute = resolveStageCompute(
    requestedComputeMode,
    pinnedBackend ? { preferredBackend: pinnedBackend } : {}
  );

  if (!circuit.allowRequest()) {
    return { success: false, mode: 'circuit_open', refinement_backend: 'deterministic_only', actions: [], error: 'Circuit breaker for dcc-mcp-blender is OPEN' };
  }
  if (!fs.existsSync(baseGlbPath)) {
    circuit.recordFailure();
    return { success: false, mode: 'missing_base_glb', refinement_backend: 'deterministic_only', actions: [], error: `Base GLB missing at ${baseGlbPath}` };
  }

  const blenderBin = findInstalledBlenderBinary();
  if (!blenderBin && !durableRefinementRequired) {
    // A caller that does not require durable Blender refinement (a refine fork whose geometry
    // is already the patched spec) keeps the deterministic mesh instead of failing the run.
    return { success: false, mode: 'blender_missing', refinement_backend: 'deterministic_only', actions: [], error: 'No Blender executable found on this host' };
  }
  if (!blenderBin) {
    circuit.recordFailure();
    return { success: false, mode: 'blender_missing', refinement_backend: 'deterministic_only', actions: [], error: 'No Blender executable found on this host' };
  }

  fs.mkdirSync(intermediateDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const config = buildWorkerConfig({
    baseGlbPath,
    intermediateDir,
    stagingDir,
    spec,
    prompt,
    requestedComputeMode,
    requestedGpuBackend: pinnedBackend,
    patches: options.patches,
    inspection: options.inspection,
    outputSize: options.outputSize,
    cyclesSamples: options.cyclesSamples,
    metaballs: options.metaballs,
    mirrorX: options.mirrorX,
    enablePbr: options.enablePbr
  });
  const configPath = path.join(intermediateDir, 'blender_job_config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  if (!fs.existsSync(config.live_glb_path)) fs.copyFileSync(baseGlbPath, config.live_glb_path);

  const blenderStatus = getBlenderStatus();
  const dccStatus = getDccMcpStatus();
  const context = {
    jobId, compute, blenderVersion: blenderStatus.version, dccVersion: dccStatus.version,
    liveGlbPath: config.live_glb_path, livePngPath: config.live_preview_path
  };

  const actions = [];
  let workerReady = null;
  let workerFailure = null;
  let workerComplete = null;
  const tally = createStepTally();

  const live = getLiveBlenderStatus();
  const useLiveGui = live.running && live.mode === 'live_gui';
  // Single handler shared by the live-GUI dispatcher and the headless streamer so
  // worker_failed / worker_ready / worker_complete capture cannot drift apart.
  const handleWorkerLine = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.event === 'worker_ready') { workerReady = payload; return; }
    if (payload.event === 'worker_failed') { workerFailure = payload; return; }
    if (payload.event === 'worker_complete') { workerComplete = payload; return; }
    if (payload.event !== 'step') return;
    if (!tally.claim(payload)) return;
    const action = wrapAction(payload, context);
    actions.push(action);
    try { onAction(action); } catch { /* intentional best-effort fallback: Blender refinement is optional; the deterministic mesh remains valid */ }
  };
  const result = useLiveGui
    ? await dispatchToLiveSession(config, handleWorkerLine)
    : await streamBlenderWorker({ blenderBin, configPath, onLine: handleWorkerLine });

  // A streamed worker_failed names the real cause (the raising step and message);
  // the dispatcher's own error only knows the transport-level symptom.
  const workerError = workerFailure?.error
    || result.error
    || (result.code !== 0 ? `Blender exited with code ${result.code}: ${String(result.stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ')}` : null);

  const finalExists = fs.existsSync(config.final_glb_path);
  const previewExists = fs.existsSync(config.preview_png_path);
  const expectedSteps = resolveExpectedSteps(workerReady, workerComplete, actions);
  // steps_executed is exactly actions.length because the tally rejects duplicate step_ids.
  const workerCompleted = !workerError && finalExists && previewExists && actions.length === expectedSteps;
  // A caller that does not require durable Blender refinement keeps the deterministic base mesh
  // when the worker cannot start at all; a healthy worker must still complete its steps.
  const degradedToDeterministic = !workerCompleted && !workerReady && !durableRefinementRequired;
  const success = workerCompleted || degradedToDeterministic;

  if (success) circuit.recordSuccess();
  else circuit.recordFailure();

  const lastMetrics = actions.length > 0 ? actions[actions.length - 1].parameters : {};

  // Invariant: the streamed steps are unique by step_id, so steps_executed is a
  // real count and never a replay-inflated one.
  if (tally.size() !== actions.length) {
    throw new Error(`Live Blender session double-counted steps: ${actions.length} actions for ${tally.size()} unique step_ids`);
  }

  const currentError = typeof lastMetrics.error === 'string' ? lastMetrics.error : null;
  const computeTruth = resolveComputeTruth({
    requestedGpu: Boolean(lastMetrics.requested_gpu) || compute.effectiveMode === 'gpu',
    requestedBackend: lastMetrics.requested_gpu_backend || config.requested_gpu_backend || (compute.effectiveMode === 'gpu' ? compute.backend : null),
    workerDevice: lastMetrics.device || (lastMetrics.compute_device !== undefined ? lastMetrics.compute_device : null),
    workerGpuUnavailable: Boolean(lastMetrics.gpu_unavailable),
    workerFallbackReason: lastMetrics.gpu_fallback_reason
      || (lastMetrics.compute_device === undefined ? compute.fallbackReason : null),
    workerError: currentError || workerError
  });

  return _formatSessionResult({
    success, useLiveGui, workerCompleted, workerReady, blenderStatus, dccStatus,
    compute, profile, config, lastMetrics, computeTruth, expectedSteps, tally,
    actions, workerError
  });
}

module.exports = {
  buildInspectionConfig,
  getLiveBlenderStatus,
  closeLiveBlenderSession,
  ensureLiveBlenderSession,
  buildWorkerConfig,
  executeLiveAgenticBlenderSession,
  resolveComputeTruth,
  // Exported for the queue-contract test: replay guards, step tally, step count.
  dispatchToLiveSession,
  resolveQueueRecord,
  drainQueueRecords,
  resolveResultOutcome,
  createStepTally,
  resolveExpectedSteps,
  redactCredentials,
  liveWorkerLogPath,
  excerptWorkerLog,
  TOTAL_AGENT_STEPS,
  LOCK_FILE,
  WORKER_SCRIPT
};
