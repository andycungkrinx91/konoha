'use strict';

/**
 * GPU Auto-Detection & Stage Compute Selector for Yamanaka 3D Subsystem.
 * Supports Auto-Detect, Force GPU (with automatic seamless CPU fallback), and Force CPU.
 */

const os = require('os');
const { spawnSync } = require('child_process');

function _detectNvidia() {
  try {
    const res = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      encoding: 'utf8',
      timeout: 2000
    });
    if (res.status !== 0 || !res.stdout) return null;
    const names = res.stdout.trim().split('\n').filter(Boolean);
    return names.length > 0 ? names[0].trim() : null;
  } catch {
    return null;
  }
}

function _detectAmd() {
  try {
    const res = spawnSync('rocm-smi', ['--showproductname'], {
      encoding: 'utf8',
      timeout: 2000
    });
    if (res.status === 0 && res.stdout && !res.stdout.includes('not found')) {
      return 'AMD Radeon ROCm Device';
    }
    return null;
  } catch {
    return null;
  }
}

function detectComputeHardware(overrides = {}) {
  if (overrides.hasGpu !== undefined) {
    return {
      hasGpu: Boolean(overrides.hasGpu),
      detectedBackends: overrides.detectedBackends || (overrides.hasGpu ? ['CUDA'] : ['CPU']),
      primaryBackend: overrides.primaryBackend || (overrides.hasGpu ? 'CUDA' : 'CPU'),
      gpuName: overrides.gpuName || (overrides.hasGpu ? 'Simulated GPU Device' : null),
      details: overrides.details || {}
    };
  }

  if (process.env.KONOHA_FORCE_CPU === '1' || process.env.KONOHA_FORCE_CPU === 'true') {
    return {
      hasGpu: false,
      detectedBackends: ['CPU'],
      primaryBackend: 'CPU',
      gpuName: null,
      details: { forcedByEnv: true }
    };
  }

  const platform = os.platform();
  const backends = [];
  let gpuName = null;

  if (platform === 'darwin') {
    backends.push('METAL');
    gpuName = os.cpus()[0]?.model || 'Apple Silicon GPU';
  }

  const nvidiaGpu = _detectNvidia();
  if (nvidiaGpu) {
    gpuName = nvidiaGpu;
    backends.push('OPTIX', 'CUDA');
  } else {
    const amdGpu = _detectAmd();
    if (amdGpu) {
      gpuName = amdGpu;
      backends.push('HIP');
    }
  }

  backends.push('CPU');
  const hasGpu = backends.some(b => b !== 'CPU');

  return {
    hasGpu,
    detectedBackends: backends,
    primaryBackend: hasGpu ? backends[0] : 'CPU',
    gpuName: hasGpu ? gpuName : null,
    details: {
      platform,
      arch: os.arch(),
      cpuCount: os.cpus().length,
      memoryTotalMb: Math.round(os.totalmem() / (1024 * 1024))
    }
  };
}

function normalizeGpuBackend(backend) {
  if (!backend) return null;
  const upper = String(backend).trim().toUpperCase();
  return GPU_BACKENDS.includes(upper) ? upper : null;
}

function _makeResult(reqMode, effMode, backend, options = {}) {
  return {
    requestedMode: reqMode,
    effectiveMode: effMode,
    backend,
    autoFallbackApplied: Boolean(options.autoFallbackApplied),
    fallbackReason: options.fallbackReason || null,
    preferredBackend: options.preferredBackend || null,
    preferredBackendApplied: Boolean(options.preferredBackendApplied)
  };
}

function resolveStageCompute(requestedMode = 'auto', options = {}) {
  const normRequested = String(requestedMode || 'auto').toLowerCase();
  const preferredBackend = normalizeGpuBackend(options.preferredBackend);
  const hardware = detectComputeHardware(options.hardwareOverrides || {});

  if (normRequested === 'cpu') {
    return _makeResult('cpu', 'cpu', 'CPU', { preferredBackend });
  }

  if (preferredBackend && hardware.hasGpu) {
    return _makeResult(normRequested, 'gpu', preferredBackend, {
      preferredBackend,
      preferredBackendApplied: true
    });
  }

  if (hardware.hasGpu) {
    return _makeResult(normRequested, 'gpu', hardware.primaryBackend, { preferredBackend });
  }

  if (normRequested === 'gpu') {
    return _makeResult('gpu', 'cpu', 'CPU', {
      autoFallbackApplied: true,
      fallbackReason: 'No compatible GPU hardware detected; automatically fell back to CPU execution',
      preferredBackend
    });
  }

  return _makeResult('auto', 'cpu', 'CPU', { preferredBackend });
}

const COMPUTE_MODES = Object.freeze(['auto', 'cpu', 'gpu']);
const GPU_BACKENDS = Object.freeze(['OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI']);

module.exports = {
  COMPUTE_MODES,
  GPU_BACKENDS,
  detectComputeHardware,
  normalizeGpuBackend,
  resolveStageCompute
};
