'use strict';

/**
 * src/doctor_3d.js — Automated diagnostics and self-repair for the 3D toolchain.
 *
 * Probes:
 * 1. 3D Deterministic Generator (Three.js and Manifold-3D kernel packages).
 * 2. 3D Blender Refinement (Blender LTS binary and DCC-MCP bridge integration).
 * 3. 3D Output Directory (~/.konoha/3d-output writable check; auto-created on repair).
 * 4. 3D DCC-MCP Bridge (dcc-mcp-blender version).
 * 5. 3D GPU Acceleration (GPU compute and hardware telemetry via getGpuMetrics).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function _findPackageVersion(startDir, pkgName) {
  let cur = startDir;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(cur, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (pkg.name === pkgName && pkg.version) return pkg.version;
      } catch (_) {
        // Ignore unreadable package.json
      }
    }
    cur = path.dirname(cur);
  }
  return null;
}

function resolvePackageVersion(pkgName) {
  try {
    const directPath = require.resolve(pkgName);
    const ver = _findPackageVersion(path.dirname(directPath), pkgName);
    if (ver) return ver;
  } catch (_) {
    // Package not directly resolvable via require.resolve
  }

  try {
    const rootPkg = require('../package.json');
    if (rootPkg.dependencies && rootPkg.dependencies[pkgName]) {
      return rootPkg.dependencies[pkgName].replace(/^[\^~]/, '');
    }
  } catch (_) {
    // Root package.json unreadable or missing dependency
  }

  return null;
}

function get3DStatus() {
  const threeVer = resolvePackageVersion('three');
  const manifoldVer = resolvePackageVersion('manifold-3d');
  let blender = { installed: false, version: null, path: null, ready_state: 'Unknown' };
  try {
    const installer = require('./mcp/three_asset/blender_installer');
    blender = installer.getBlenderStatus ? installer.getBlenderStatus() : { installed: false };
  } catch (_) {
    // blender_installer unavailable
  }

  let dcc = { installed: false, version: null, ready_state: 'Unknown' };
  try {
    const installer = require('./mcp/three_asset/blender_installer');
    dcc = installer.getDccMcpStatus ? installer.getDccMcpStatus() : { installed: false };
  } catch (_) {
    // dcc_mcp unavailable
  }

  let outputRoot = path.join(os.homedir(), '.konoha', '3d-output');
  try {
    const storage = require('./mcp/three_asset/storage_manager');
    if (storage.getOutputRoot) {
      const root = storage.getOutputRoot();
      if (root) outputRoot = root;
    }
  } catch (_) {
    // storage_manager unavailable
  }

  return {
    blender: {
      installed: Boolean(blender && blender.installed),
      version: (blender && blender.version) || null,
      path: (blender && blender.path) || null,
      ready_state: (blender && blender.ready_state) || 'Unknown'
    },
    dcc_mcp: {
      installed: Boolean(dcc && dcc.installed),
      version: (dcc && dcc.version) || null,
      ready_state: (dcc && dcc.ready_state) || 'Unknown'
    },
    output_root: outputRoot,
    output_root_exists: fs.existsSync(outputRoot),
    threeVer,
    manifoldVer
  };
}

function check3DToolchain(record, autoRepair = false) {
  const status = get3DStatus();

  // 3D Deterministic Generator
  if (status.threeVer && status.manifoldVer) {
    record(
      '3D Deterministic Generator',
      'HEALTHY',
      `Procedural mesh + GLB export available (three@${status.threeVer}, manifold-3d@${status.manifoldVer})`
    );
  } else {
    record(
      '3D Deterministic Generator',
      'WARNING',
      `Procedural generator: three@${status.threeVer || 'missing'}, manifold-3d@${status.manifoldVer || 'missing'}`
    );
  }

  // 3D Blender Refinement
  if (status.blender.installed && status.dcc_mcp.installed) {
    record(
      '3D Blender Refinement',
      'HEALTHY',
      `Blender ${status.blender.version} + dcc-mcp ${status.dcc_mcp.version}`
    );
  } else {
    record(
      '3D Blender Refinement',
      'NOT INSTALLED',
      `Blender ${status.blender.installed ? (status.blender.version || 'ok') : 'missing'}, dcc-mcp ${status.dcc_mcp.installed ? (status.dcc_mcp.version || 'ok') : 'missing'}`
    );
  }

  // 3D Output Directory
  const outputDir = status.output_root;
  try {
    if (!fs.existsSync(outputDir)) {
      if (autoRepair) {
        fs.mkdirSync(outputDir, { recursive: true });
        record('3D Output Directory', 'REPAIRED', `Created missing directory: ${outputDir}`);
      } else {
        record('3D Output Directory', 'WARNING', `Directory does not exist: ${outputDir}`);
      }
    } else {
      fs.accessSync(outputDir, fs.constants.W_OK);
      record('3D Output Directory', 'HEALTHY', `Writable output directory: ${outputDir}`);
    }
  } catch (err) {
    record('3D Output Directory', 'WARNING', `Directory not writable: ${outputDir} (${err.message})`);
  }

  // 3D DCC-MCP Bridge
  if (status.dcc_mcp.installed) {
    record('3D DCC-MCP Bridge', 'HEALTHY', `dcc-mcp-blender ${status.dcc_mcp.version}`);
  } else {
    let latestPyPi = null;
    try {
      const installer = require('./mcp/three_asset/blender_installer');
      latestPyPi = installer.resolveLatestDccMcpVersion ? installer.resolveLatestDccMcpVersion() : null;
    } catch (_) {
      // resolveLatestDccMcpVersion unavailable
    }
    record('3D DCC-MCP Bridge', 'WARNING', `dcc-mcp-blender not installed${latestPyPi ? ` (latest PyPI: ${latestPyPi})` : ''}`);
  }

  // 3D GPU Acceleration
  try {
    const { getGpuMetrics } = require('./gpu_telemetry');
    const metrics = getGpuMetrics();
    const gpuDevices = Array.isArray(metrics?.devices) ? metrics.devices : [];
    if (gpuDevices.length > 0) {
      const summary = gpuDevices.map((d) => `${d.name || 'GPU'} (${d.vendor || 'Unknown'})`).join(', ');
      record('3D GPU Acceleration', 'HEALTHY', `GPU available: ${summary}`);
    } else {
      record('3D GPU Acceleration', 'HEALTHY', `CPU compute mode active (${metrics?.compute_mode || 'cpu'}; software rasterizer)`);
    }
  } catch (err) {
    record('3D GPU Acceleration', 'WARNING', `GPU telemetry error: ${err.message}`);
  }

  return status;
}

function record3DChecks(record) {
  return check3DToolchain(record, false);
}

module.exports = {
  check3DToolchain,
  record3DChecks,
  get3DStatus
};
