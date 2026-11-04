'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CACHE_TTL_MS = 10000;
let cached = null;
let cachedAt = 0;

function _run(cmd, args, timeout = 2500) {
  try {
    const res = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (res.error || res.status !== 0 || !res.stdout) return null;
    return res.stdout.trim();
  } catch (_) {
    return null;
  }
}

function _parseNvidiaSmi(out) {
  if (!out) return null;
  const line = out.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 4) return null;
  const [name, totalMb, usedMb, utilPct] = parts;
  const total = Number(totalMb);
  const used = Number(usedMb);
  if (!Number.isFinite(total) || total <= 0) return null;
  const utilization = Number(utilPct);
  return {
    name: name || 'NVIDIA GPU',
    vendor: 'nvidia',
    vram_total_bytes: Math.round(total * 1024 * 1024),
    vram_used_bytes: Number.isFinite(used) ? Math.round(used * 1024 * 1024) : null,
    utilization_pct: Number.isFinite(utilization) ? utilization : null,
    source: 'nvidia-smi'
  };
}

function _nvidia() {
  const out = _run('nvidia-smi', [
    '--query-gpu=name,memory.total,memory.used,utilization.gpu',
    '--format=csv,noheader,nounits'
  ]);
  return _parseNvidiaSmi(out);
}

function _rocm() {
  const out = _run('rocm-smi', ['--showmeminfo', 'vram', '--showuse', '--csv']);
  if (!out) return null;
  const totalMatch = out.match(/(\d{6,})/g);
  if (!totalMatch) return null;
  const total = Number(totalMatch[0]);
  if (!Number.isFinite(total) || total <= 0) return null;
  return {
    name: 'AMD GPU (ROCm)',
    vendor: 'amd',
    vram_total_bytes: total,
    vram_used_bytes: null,
    utilization_pct: null,
    source: 'rocm-smi'
  };
}

function _appleSilicon() {
  if (os.platform() !== 'darwin') return null;
  const brand = _run('sysctl', ['-n', 'machdep.cpu.brand_string']);
  const isApple = (brand && /apple/i.test(brand)) || process.arch === 'arm64';
  if (!isApple) return null;
  const memBytes = os.totalmem();
  return {
    name: brand || 'Apple Silicon GPU',
    vendor: 'apple',
    unified_memory: true,
    vram_total_bytes: memBytes,
    vram_used_bytes: null,
    utilization_pct: null,
    source: 'sysctl',
    note: 'Unified memory: GPU shares system RAM; per-GPU usage is not exposed by the OS.'
  };
}

function _windowsWmi() {
  if (os.platform() !== 'win32') return null;
  const out = _run('powershell', [
    '-NoProfile',
    '-Command',
    "(Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress)"
  ], 4000);
  if (!out) return null;
  try {
    const parsed = JSON.parse(out);
    const name = parsed.Name || parsed.name;
    if (!name) return null;
    const ram = Number(parsed.AdapterRAM || parsed.adapterRAM);
    return {
      name,
      vendor: /nvidia/i.test(name) ? 'nvidia' : /amd|radeon/i.test(name) ? 'amd' : /intel/i.test(name) ? 'intel' : 'unknown',
      vram_total_bytes: Number.isFinite(ram) && ram > 0 ? ram : null,
      vram_used_bytes: null,
      utilization_pct: null,
      source: 'wmi',
      note: 'AdapterRAM is a 32-bit WMI field and may under-report VRAM above 4 GB.'
    };
  } catch (_) {
    return null;
  }
}

function _linuxDrmInfo() {
  if (os.platform() !== 'linux') return null;
  try {
    const drmRoot = '/sys/class/drm';
    const entries = fs.readdirSync(drmRoot).filter((n) => /^card\d+$/.test(n));
    for (const card of entries) {
      const vendorPath = path.join(drmRoot, card, 'device', 'vendor');
      if (!fs.existsSync(vendorPath)) continue;
      const vendorId = fs.readFileSync(vendorPath, 'utf8').trim();
      const totalPath = path.join(drmRoot, card, 'device', 'mem_info_vram_total');
      const usedPath = path.join(drmRoot, card, 'device', 'mem_info_vram_used');
      let total = null;
      let used = null;
      try { total = Number(fs.readFileSync(totalPath, 'utf8').trim()); } catch (_) { /* not exposed */ }
      try { used = Number(fs.readFileSync(usedPath, 'utf8').trim()); } catch (_) { /* not exposed */ }
      if (!Number.isFinite(total) || total <= 0) continue;
      const vendor = vendorId === '0x10de' ? 'nvidia' : vendorId === '0x1002' ? 'amd' : vendorId === '0x8086' ? 'intel' : 'unknown';
      return {
        name: `${vendor.toUpperCase()} GPU (${card})`,
        vendor,
        vram_total_bytes: total,
        vram_used_bytes: Number.isFinite(used) ? used : null,
        utilization_pct: null,
        source: 'sysfs'
      };
    }
  } catch (_) { /* no DRM information */ }
  return null;
}

function _detect() {
  return _nvidia() || _rocm() || _appleSilicon() || _windowsWmi() || _linuxDrmInfo();
}

/**
 * Report GPU telemetry only when it can actually be measured. When no probe
 * succeeds the result states that plainly instead of emitting placeholder
 * numbers, so dashboards never present invented hardware figures.
 */
function getGpuTelemetry(options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && cached !== null && now - cachedAt < CACHE_TTL_MS) return cached;

  const gpu = _detect();
  let payload;
  if (!gpu) {
    payload = {
      available: false,
      reason: 'no_gpu_telemetry_source',
      detail: 'No nvidia-smi, rocm-smi, Apple sysctl, WMI, or sysfs VRAM source responded.',
      probe_platform: os.platform(),
      probe_arch: os.arch()
    };
  } else {
    payload = Object.assign({ available: true }, gpu);
    if (payload.vram_total_bytes && payload.vram_used_bytes !== null) {
      payload.vram_used_pct = Math.round((payload.vram_used_bytes / payload.vram_total_bytes) * 1000) / 10;
    }
    // Plan contract aliases for backwards/cross-platform compatibility
    payload.mem_used_bytes = payload.vram_used_bytes;
    payload.mem_total_bytes = payload.vram_total_bytes;
    payload.util_pct = payload.utilization_pct;
    payload.devices = [{
      name: payload.name,
      vendor: payload.vendor,
      util_pct: payload.utilization_pct,
      mem_used_bytes: payload.vram_used_bytes,
      mem_total_bytes: payload.vram_total_bytes,
      source: payload.source
    }];
  }
  payload.generated_at = new Date().toISOString();
  cached = payload;
  cachedAt = now;
  return payload;
}

function resetGpuTelemetryCache() {
  cached = null;
  cachedAt = 0;
}

module.exports = {
  getGpuTelemetry,
  getGpuMetrics: getGpuTelemetry,
  resetGpuTelemetryCache
};
