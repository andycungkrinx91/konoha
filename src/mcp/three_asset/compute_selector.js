'use strict';

/**
 * GPU Auto-Detection & Stage Compute Selector for Yamanaka 3D Subsystem.
 * Supports Auto-Detect, Force GPU (with automatic seamless CPU fallback), and Force CPU.
 */

const os = require('os');
const { spawnSync } = require('child_process');

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

  // Apple Silicon Metal Check on Darwin
  if (platform === 'darwin') {
    backends.push('METAL');
    gpuName = os.cpus()[0]?.model || 'Apple Silicon GPU';
  }

  // NVIDIA CUDA / OPTIX Check (Linux & Windows)
  try {
    const nvRes = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      encoding: 'utf8',
      timeout: 2000
    });
    if (nvRes.status === 0 && nvRes.stdout) {
      const names = nvRes.stdout.trim().split('\n').filter(Boolean);
      if (names.length > 0) {
        gpuName = names[0].trim();
        backends.push('OPTIX', 'CUDA');
      }
    }
  } catch { /* intentional best-effort fallback: probe is advisory; default policy applies */ }

  // AMD ROCm / HIP Check
  if (backends.length === 0) {
    try {
      const rocmRes = spawnSync('rocm-smi', ['--showproductname'], {
        encoding: 'utf8',
        timeout: 2000
      });
      if (rocmRes.status === 0 && rocmRes.stdout && !rocmRes.stdout.includes('not found')) {
        backends.push('HIP');
        gpuName = 'AMD Radeon ROCm Device';
      }
    } catch { /* intentional best-effort fallback: probe is advisory; default policy applies */ }
  }

  // Fallback to CPU
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

function resolveStageCompute(requestedMode = 'auto', options = {}) {
  const normRequested = String(requestedMode || 'auto').toLowerCase();
  const hardware = detectComputeHardware(options.hardwareOverrides || {});

  if (normRequested === 'cpu') {
    return {
      requestedMode: 'cpu',
      effectiveMode: 'cpu',
      backend: 'CPU',
      autoFallbackApplied: false,
      fallbackReason: null
    };
  }

  if (normRequested === 'gpu') {
    if (hardware.hasGpu) {
      return {
        requestedMode: 'gpu',
        effectiveMode: 'gpu',
        backend: hardware.primaryBackend,
        autoFallbackApplied: false,
        fallbackReason: null
      };
    }

    // Force GPU on host without GPU -> automatic seamless CPU fallback
    return {
      requestedMode: 'gpu',
      effectiveMode: 'cpu',
      backend: 'CPU',
      autoFallbackApplied: true,
      fallbackReason: 'No compatible GPU hardware detected; automatically fell back to CPU execution'
    };
  }

  // 'auto' mode
  if (hardware.hasGpu) {
    return {
      requestedMode: 'auto',
      effectiveMode: 'gpu',
      backend: hardware.primaryBackend,
      autoFallbackApplied: false,
      fallbackReason: null
    };
  }

  return {
    requestedMode: 'auto',
    effectiveMode: 'cpu',
    backend: 'CPU',
    autoFallbackApplied: false,
    fallbackReason: null
  };
}

const COMPUTE_MODES = Object.freeze(['auto', 'cpu', 'gpu']);

module.exports = {
  COMPUTE_MODES,
  detectComputeHardware,
  resolveStageCompute
};
