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
const { resolveStageCompute } = require('./compute_selector');

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
  } catch (_) {}
}

function clearLockFile() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch (_) {}
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
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  }
  activeBlenderProcess = null;
  clearLockFile();
  return { success: true, closed: Boolean(pid) };
}

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

function buildWorkerConfig(options) {
  const spec = options.spec || {};
  const prompt = options.prompt || '';
  const compute = resolveStageCompute(options.requestedComputeMode || 'auto');
  const turnaround = (spec && spec.turnaround) || {};
  const intermediateDir = options.intermediateDir;
  return {
    base_glb_path: options.baseGlbPath,
    live_glb_path: path.join(intermediateDir, 'live_step.glb'),
    live_preview_path: path.join(intermediateDir, 'live_preview.png'),
    final_glb_path: path.join(options.stagingDir, 'model.glb'),
    preview_png_path: path.join(options.stagingDir, 'preview.png'),
    organic: isOrganicRequest(spec, prompt),
    prompt,
    palette: (spec && spec.palette) || null,
    materials: collectMaterialSpecs(spec),
    turnaround,
    flat_studio_lighting: Boolean(turnaround.flatStudioLighting),
    gpu_backend: compute.backend,
    compute_mode: compute.effectiveMode
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
    } catch (_) {}
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
    proc.on('error', (err) => resolve({ code: -1, error: err.message, stderr: '' }));
    proc.on('close', (code) => {
      activeBlenderProcess = null;
      clearLockFile();
      resolve({ code, stderr: stderrTail.join('') });
    });
  });
}

function liveQueueDir() {
  return path.join(os.homedir(), '.konoha', 'blender_queue');
}

async function ensureLiveBlenderSession(options = {}) {
  if (options.autoLaunch === false) return getLiveBlenderStatus();
  const existing = getLiveBlenderStatus();
  if (existing.running) return { running: true, pid: existing.pid, mode: existing.mode, reused: true };

  const blenderBin = findInstalledBlenderBinary();
  if (!blenderBin) return { running: false, mode: 'unavailable', reason: 'No Blender executable found on this host' };
  if (!options.gui) return { running: false, mode: 'headless_available', reason: 'GUI not requested' };

  const queue = liveQueueDir();
  fs.mkdirSync(queue, { recursive: true });
  const { spawn } = require('child_process');
  const proc = spawn(blenderBin, ['--python', WORKER_SCRIPT, '--', '--server', queue], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env }
  });
  proc.unref();
  writeLockFile({ pid: proc.pid, mode: 'live_gui', worker: 'blender_live_worker.py', started_at: Date.now() });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  return { running: true, pid: proc.pid, mode: 'live_gui', queue_dir: queue };
}

async function dispatchToLiveSession(config, onLine, timeoutMs = 600000) {
  const queue = liveQueueDir();
  fs.mkdirSync(queue, { recursive: true });
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const requestPath = path.join(queue, `${requestId}.request.json`);
  const resultPath = path.join(queue, `${requestId}.result.json`);
  fs.writeFileSync(requestPath, JSON.stringify(config), 'utf8');

  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  for (;;) {
    for (const file of fs.readdirSync(queue).filter((f) => f.endsWith('.output.json')).sort()) {
      const full = path.join(queue, file);
      if (seen.has(full)) continue;
      seen.add(full);
      try {
        const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (payload.request_id === requestId) onLine(payload.payload);
      } catch (_) {}
    }
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      try { fs.rmSync(resultPath, { force: true }); } catch (_) {}
      return { code: result.success ? 0 : 1, error: result.success ? null : result.error };
    }
    if (Date.now() > deadline) return { code: -1, error: 'Live Blender session dispatch timed out' };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function wrapAction(payload, context) {
  return {
    event: 'blender_agent_action',
    job_id: context.jobId,
    step_id: payload.step_id,
    step_number: payload.step_number,
    total_steps: payload.total_steps,
    step_name: payload.step_name,
    tool_used: payload.tool_used,
    parameters: payload.metrics || {},
    status: payload.status,
    elapsed_ms: payload.elapsed_ms,
    compute_mode: context.compute.effectiveMode,
    compute_backend: context.compute.backend,
    live_glb_path: context.liveGlbPath,
    live_png_path: context.livePngPath,
    blender_version: payload.blender_version || context.blenderVersion,
    dcc_mcp_version: payload.dcc_mcp_version || context.dccVersion,
    timestamp: new Date().toISOString()
  };
}

async function executeLiveAgenticBlenderSession(options) {
  const {
    baseGlbPath,
    intermediateDir,
    stagingDir,
    jobId,
    spec,
    profile = 'enterprise_pbr',
    prompt = '',
    requestedComputeMode = 'auto',
    onAction = () => {}
  } = options;

  const circuit = globalCircuitRegistry.getOrCreate('yamanaka-dcc-mcp-blender', 3, 60);
  const compute = resolveStageCompute(requestedComputeMode);

  if (!circuit.allowRequest()) {
    return { success: false, mode: 'circuit_open', refinement_backend: 'deterministic_only', actions: [], error: 'Circuit breaker for dcc-mcp-blender is OPEN' };
  }
  if (!fs.existsSync(baseGlbPath)) {
    circuit.recordFailure();
    return { success: false, mode: 'missing_base_glb', refinement_backend: 'deterministic_only', actions: [], error: `Base GLB missing at ${baseGlbPath}` };
  }

  const blenderBin = findInstalledBlenderBinary();
  if (!blenderBin) {
    circuit.recordFailure();
    return { success: false, mode: 'blender_missing', refinement_backend: 'deterministic_only', actions: [], error: 'No Blender executable found on this host' };
  }

  fs.mkdirSync(intermediateDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const config = buildWorkerConfig({ baseGlbPath, intermediateDir, stagingDir, spec, prompt, requestedComputeMode });
  const configPath = path.join(intermediateDir, 'blender_job_config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  if (!fs.existsSync(config.live_glb_path)) fs.copyFileSync(baseGlbPath, config.live_glb_path);

  const blenderStatus = getBlenderStatus();
  const dccStatus = getDccMcpStatus();
  const context = {
    jobId,
    compute,
    liveGlbPath: config.live_glb_path,
    livePngPath: config.live_preview_path,
    blenderVersion: blenderStatus.version,
    dccVersion: dccStatus.version
  };

  const actions = [];
  let workerReady = null;
  let workerFailure = null;

  const live = getLiveBlenderStatus();
  const useLiveGui = live.running && live.mode === 'live_gui';
  const result = useLiveGui
    ? await dispatchToLiveSession(config, (payload) => {
        if (payload.event === 'worker_ready') { workerReady = payload; return; }
        if (payload.event === 'worker_failed') { workerFailure = payload; return; }
        if (payload.event !== 'step') return;
        const action = wrapAction(payload, context);
        actions.push(action);
        try { onAction(action); } catch (_) {}
      })
    : await streamBlenderWorker({
    blenderBin,
    configPath,
    onLine: (payload) => {
      if (payload.event === 'worker_ready') {
        workerReady = payload;
        return;
      }
      if (payload.event === 'worker_failed') {
        workerFailure = payload;
        return;
      }
      if (payload.event !== 'step') return;
      const action = wrapAction(payload, context);
      actions.push(action);
      try { onAction(action); } catch (_) {}
    }
  });

  const workerError = result.error
    || workerFailure?.error
    || (result.code !== 0 ? `Blender exited with code ${result.code}: ${String(result.stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ')}` : null);

  const finalExists = fs.existsSync(config.final_glb_path);
  const previewExists = fs.existsSync(config.preview_png_path);
  const success = !workerError && finalExists && previewExists && actions.length === 6;

  if (success) circuit.recordSuccess();
  else circuit.recordFailure();

  const lastMetrics = actions.length > 0 ? actions[actions.length - 1].parameters : {};

  return {
    success,
    mode: useLiveGui ? 'live_gui' : 'live_headless',
    refinement_backend: success ? 'dcc_mcp_blender' : 'deterministic_only',
    blender_version: (workerReady && workerReady.blender_version) || blenderStatus.version,
    dcc_mcp_version: (workerReady && workerReady.dcc_mcp_version) || dccStatus.version,
    compute_backend: compute.backend,
    effective_compute_mode: compute.effectiveMode,
    profile,
    final_glb_path: config.final_glb_path,
    preview_png_path: config.preview_png_path,
    live_glb_path: config.live_glb_path,
    live_png_path: config.live_preview_path,
    vertex_count: lastMetrics.vertices || 0,
    triangle_count: lastMetrics.triangles || 0,
    mesh_count: lastMetrics.meshes || 0,
    steps_executed: actions.length,
    actions,
    error: workerError || null
  };
}

module.exports = {
  getLiveBlenderStatus,
  closeLiveBlenderSession,
  ensureLiveBlenderSession,
  buildWorkerConfig,
  executeLiveAgenticBlenderSession,
  LOCK_FILE,
  WORKER_SCRIPT
};
