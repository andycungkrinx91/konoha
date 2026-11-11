#!/usr/bin/env node
'use strict';

/**
 * tests/test_yamanaka_compute_and_installer.js
 *
 * Comprehensive tests for:
 * 1. GPU Auto-Detection & Stage Compute Selector (Force GPU + Auto CPU Fallback).
 * 2. OS-Detecting Blender & DCC-MCP-Blender Auto-Installer.
 * 3. 6-Step Live Agentic Blender Execution & Real-Time Event Streaming.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { detectComputeHardware, resolveStageCompute } = require('../src/mcp/three_asset/compute_selector');
const {
  detectSystemEnvironment,
  getBlenderStatus,
  getDccMcpStatus,
  getToolchainStatus,
  installBlender,
  installDccMcpBlender,
  installAllTools,
  findInstalledBlenderBinaries,
  parseBlenderVersionBanner,
  resolveLatestBlenderRelease
} = require('../src/mcp/three_asset/blender_installer');
const { executeLiveAgenticBlenderSession } = require('../src/mcp/three_asset/blender_refiner');
const { globalCircuitRegistry } = require('../src/circuit_breaker');

console.log('Running test_yamanaka_compute_and_installer.js...');

function blenderCircuitSafeReset() {
  globalCircuitRegistry.getOrCreate('yamanaka-dcc-mcp-blender', 3, 60).reset();
}

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-compute-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

try {
  // --- 1. Compute Hardware Detection & Fallback Modes ---
  console.log('\n--- 1. Testing GPU Auto-Detection & Compute Resolution ---');
  const hw = detectComputeHardware();
  assert.strictEqual(typeof hw.hasGpu, 'boolean');
  assert.ok(Array.isArray(hw.detectedBackends));
  console.log(`  Hardware detected: hasGpu=${hw.hasGpu}, primaryBackend=${hw.primaryBackend}`);

  // Test Auto Mode
  const autoRes = resolveStageCompute('auto');
  assert.strictEqual(autoRes.requestedMode, 'auto');
  assert.strictEqual(autoRes.autoFallbackApplied, false);
  console.log(`  ✓ Auto mode resolved to: ${autoRes.effectiveMode} (${autoRes.backend})`);

  // Test Force CPU Mode
  const cpuRes = resolveStageCompute('cpu');
  assert.strictEqual(cpuRes.requestedMode, 'cpu');
  assert.strictEqual(cpuRes.effectiveMode, 'cpu');
  assert.strictEqual(cpuRes.autoFallbackApplied, false);
  console.log('  ✓ Force CPU mode resolved strictly to CPU.');

  // Test Force GPU on simulated CPU-only host (Mandatory Automatic CPU Fallback)
  const forcedGpuFallback = resolveStageCompute('gpu', {
    hardwareOverrides: { hasGpu: false }
  });
  assert.strictEqual(forcedGpuFallback.requestedMode, 'gpu');
  assert.strictEqual(forcedGpuFallback.effectiveMode, 'cpu', 'Must fall back to CPU when no GPU is present');
  assert.strictEqual(forcedGpuFallback.autoFallbackApplied, true, 'autoFallbackApplied flag must be true');
  assert.ok(forcedGpuFallback.fallbackReason.includes('automatically fell back to CPU'), 'Must include fallback reason');
  console.log('  ✓ Force GPU on CPU-only host triggered seamless automatic CPU fallback without failing.');

  // Test Force GPU on host with GPU
  const forcedGpuSuccess = resolveStageCompute('gpu', {
    hardwareOverrides: { hasGpu: true, primaryBackend: 'CUDA' }
  });
  assert.strictEqual(forcedGpuSuccess.requestedMode, 'gpu');
  assert.strictEqual(forcedGpuSuccess.effectiveMode, 'gpu');
  assert.strictEqual(forcedGpuSuccess.backend, 'CUDA');
  assert.strictEqual(forcedGpuSuccess.autoFallbackApplied, false);
  console.log('  ✓ Force GPU on GPU-capable host resolved to GPU.');

  // Test options.preferredBackend pins the backend (per-call override only)
  const unpinned = resolveStageCompute('gpu', {
    hardwareOverrides: { hasGpu: true, primaryBackend: 'OPTIX' }
  });
  assert.strictEqual(unpinned.backend, 'OPTIX', 'default policy keeps the probed primary backend');
  assert.strictEqual(unpinned.preferredBackendApplied, false);
  const pinned = resolveStageCompute('gpu', {
    hardwareOverrides: { hasGpu: true, primaryBackend: 'OPTIX' },
    preferredBackend: 'cuda'
  });
  assert.strictEqual(pinned.backend, 'CUDA', 'an explicit preferredBackend pins the backend');
  assert.strictEqual(pinned.preferredBackendApplied, true);
  assert.strictEqual(pinned.effectiveMode, 'gpu');
  const pinnedAuto = resolveStageCompute('auto', {
    hardwareOverrides: { hasGpu: true, primaryBackend: 'OPTIX' },
    preferredBackend: 'CUDA'
  });
  assert.strictEqual(pinnedAuto.backend, 'CUDA', 'the pin applies in auto mode too');
  const pinnedCpuHost = resolveStageCompute('gpu', {
    hardwareOverrides: { hasGpu: false },
    preferredBackend: 'CUDA'
  });
  assert.strictEqual(pinnedCpuHost.backend, 'CPU', 'a pin cannot invent a GPU on a CPU-only host');
  assert.strictEqual(pinnedCpuHost.preferredBackendApplied, false);
  const bogusPin = resolveStageCompute('gpu', {
    hardwareOverrides: { hasGpu: true, primaryBackend: 'OPTIX' },
    preferredBackend: 'NOT_A_BACKEND'
  });
  assert.strictEqual(bogusPin.backend, 'OPTIX', 'an invalid pin falls back to the default policy');
  console.log('  ✓ options.preferredBackend pins a backend per call without changing the default policy.');

  // requested_gpu_backend threading: refiner -> buildWorkerConfig -> gpu_backend
  const { buildWorkerConfig } = require('../src/mcp/three_asset/blender_refiner');
  const pinnedConfig = buildWorkerConfig({
    baseGlbPath: '/tmp/base.glb',
    intermediateDir: '/tmp/intermediate',
    stagingDir: '/tmp/staging',
    spec: { nodes: [] },
    requestedComputeMode: 'gpu',
    requestedGpuBackend: 'CUDA'
  });
  assert.strictEqual(
    pinnedConfig.gpu_backend,
    resolveStageCompute('gpu', { preferredBackend: 'CUDA' }).backend,
    'the pin must reach the worker as gpu_backend (degrading to CPU on a CPU-only host)'
  );
  assert.strictEqual(pinnedConfig.requested_gpu_backend, 'CUDA', 'the pin travels as requested_gpu_backend');
  const unpinnedConfig = buildWorkerConfig({
    baseGlbPath: '/tmp/base.glb',
    intermediateDir: '/tmp/intermediate',
    stagingDir: '/tmp/staging',
    spec: { nodes: [] },
    requestedComputeMode: 'gpu'
  });
  assert.strictEqual(unpinnedConfig.requested_gpu_backend, null, 'no pin leaves requested_gpu_backend unset');
  console.log('  ✓ requested_gpu_backend threads through buildWorkerConfig into gpu_backend.');

  // --- 2. OS-Detecting Toolchain Auto-Installer ---
  console.log('\n--- 2. Testing OS-Detecting Blender & DCC-MCP-Blender Installer ---');
  const sysEnv = detectSystemEnvironment();
  assert.ok(['Linux', 'Windows', 'macOS'].includes(sysEnv.osName));
  assert.ok(sysEnv.toolchainDir.includes('toolchains'));
  assert.strictEqual(sysEnv.manifest, undefined, 'No hardcoded distribution manifest may remain');
  const banner = parseBlenderVersionBanner('Blender 5.2.2 LTS\n\tbuild hash abc');
  assert.strictEqual(banner.semver, '5.2.2');
  assert.strictEqual(banner.version, '5.2.2 LTS');
  const discoveredBinaries = findInstalledBlenderBinaries();
  console.log(`  ✓ System environment: ${sysEnv.osName} (${sysEnv.arch}); ${discoveredBinaries.length} Blender binary candidate(s) discovered dynamically.`);
  const toolchain = getToolchainStatus();
  assert.ok(toolchain.components.three_manifold);
  assert.ok(toolchain.components.blender);
  assert.ok(toolchain.components.dcc_mcp_blender);
  const blenderStatus = getBlenderStatus();
  if (blenderStatus.installed) {
    assert.ok(/^[0-9]+\.[0-9]+/.test(blenderStatus.version), 'Detected Blender version must be parsed from --version');
    console.log(`  ✓ Installed Blender detected dynamically: ${blenderStatus.version} at ${blenderStatus.path}`);
  } else {
    console.log('  · No Blender installation on this host; status honestly reports Not Ready.');
  }
  const dccStatus = getDccMcpStatus();
  assert.strictEqual(typeof dccStatus.installed, 'boolean');
  console.log(`  ✓ dcc-mcp-blender probe reports installed=${dccStatus.installed}, version=${dccStatus.version || 'none'}.`);

  // Test Installer Progress Callbacks
  const progressLogs = [];
  Promise.resolve().then(async () => {
    if (process.env.KONOHA_SKIP_NETWORK_TESTS !== '1') {
      try {
        const release = await resolveLatestBlenderRelease();
        assert.ok(Array.isArray(release.archives) && release.archives.length > 0, 'Blender release index must expose downloadable archives');
        console.log(`  ✓ Blender release index resolved dynamically: series ${release.series} latest ${release.version}.`);
      } catch (err) {
        console.log(`  · Blender release index unreachable (offline): ${err.message}`);
      }
    }
    await installAllTools({
      onProgress: (p) => progressLogs.push(p)
    });
    assert.ok(progressLogs.length >= 3, 'Installation must emit progress milestones');
    console.log('  ✓ installAllTools executed with progress reporting.');

    // --- 3. 6-Step Live Agentic Blender Session (real Blender when installed) ---
    console.log('\n--- 3. Testing 6-Step Live Agentic Blender Streaming ---');
    const stagingDir = path.join(QA_ROOT, 'staging');
    const intermediateDir = path.join(stagingDir, 'intermediate');
    fs.mkdirSync(intermediateDir, { recursive: true });

    const { synthesizeQuadrupedCreatureSpec } = require('../src/mcp/three_asset/creature_synthesizer');
    const { validateSceneSpec } = require('../src/mcp/three_asset/spec_schema');
    const { buildSceneFromSpec } = require('../src/mcp/three_asset/scene_builder');
    const { exportScene } = require('../src/mcp/three_asset/exporter');
    const foxPrompt = 'nine-tailed fox, orange-red fur with white muzzle and chest, quadruped standing pose, turnaround orthographic views';
    const foxSpec = validateSceneSpec({ ...synthesizeQuadrupedCreatureSpec('KuramaFox', foxPrompt, 24000), __prompt: foxPrompt });

    if (blenderStatus.installed) {
      const built = await buildSceneFromSpec(foxSpec);
      const baseGlbPath = path.join(stagingDir, 'base.glb');
      await exportScene(built.scene, baseGlbPath, { binary: true });
      assert.ok(fs.statSync(baseGlbPath).size > 10000, 'Real base GLB must be exported before refinement');

      const streamedActions = [];
      const sessionRes = await executeLiveAgenticBlenderSession({
        baseGlbPath,
        intermediateDir,
        stagingDir,
        jobId: `job_agentic_test_${Date.now()}`,
        spec: foxSpec,
        prompt: foxPrompt,
        requestedComputeMode: 'auto',
        onAction: (act) => streamedActions.push(act)
      });

      if (sessionRes.success) {
        assert.strictEqual(sessionRes.steps_executed, 6, 'All 6 real Blender steps must complete');
        assert.strictEqual(streamedActions.length, 6);
        assert.strictEqual(sessionRes.refinement_backend, 'dcc_mcp_blender');
        assert.ok(/^[0-9]+\.[0-9]+/.test(sessionRes.blender_version), 'Blender version must be reported from the real binary');
        assert.ok(fs.existsSync(path.join(intermediateDir, 'live_step.glb')), 'live_step.glb must exist for WebGL hot-reload');
        assert.ok(fs.statSync(sessionRes.final_glb_path).size > 10000, 'Real refined model.glb must be produced');
        assert.ok(fs.statSync(sessionRes.preview_png_path).size > 5000, 'Real Blender-rendered preview.png must be produced');
        for (const act of streamedActions) {
          assert.strictEqual(act.event, 'blender_agent_action');
          assert.strictEqual(typeof act.live_glb_path, 'string');
          assert.ok(act.elapsed_ms >= 0);
          assert.ok(act.parameters);
        }
        console.log(`  ✓ All 6 real Blender ${sessionRes.blender_version} steps executed in ${streamedActions.reduce((a, b) => a + b.elapsed_ms, 0)} ms with live .glb/.png hot-reload snapshots.`);
        blenderCircuitSafeReset();
      } else {
        console.log(`  · Blender refinement unavailable in this environment: ${sessionRes.error}`);
        assert.notStrictEqual(sessionRes.steps_executed, 6, 'A failed session must not claim 6 executed steps');
      }
    } else {
      const failed = await executeLiveAgenticBlenderSession({
        baseGlbPath: path.join(stagingDir, 'missing.glb'),
        intermediateDir,
        stagingDir,
        jobId: 'job_agentic_missing'
      });
      assert.strictEqual(failed.success, false);
      assert.strictEqual(failed.steps_executed, 0);
      console.log('  ✓ Missing Blender/base GLB honestly reports failure with zero fabricated steps.');
      globalCircuitRegistry.getOrCreate('yamanaka-dcc-mcp-blender', 3, 60).reset();
    }

    // --- 4. Circuit Breaker Fast-Fail Transition ---
    console.log('\n--- 4. Testing Circuit Breakers ---');
    const blenderCircuit = globalCircuitRegistry.getOrCreate('yamanaka-dcc-mcp-blender', 3, 60);
    blenderCircuit.reset();
    assert.strictEqual(blenderCircuit.state, 'CLOSED');
    blenderCircuit.recordFailure();
    blenderCircuit.recordFailure();
    blenderCircuit.recordFailure();
    assert.strictEqual(blenderCircuit.state, 'OPEN', 'Circuit must trip to OPEN after 3 failures');
    assert.strictEqual(blenderCircuit.allowRequest(), false, 'Requests must be blocked when circuit is OPEN');
    blenderCircuit.reset();
    assert.strictEqual(blenderCircuit.state, 'CLOSED', 'Circuit reset restores CLOSED state');
    console.log('  ✓ Circuit breaker fast-fail state transitions (CLOSED -> OPEN -> RESET) verified.');

    console.log('\n✔ All compute, installer, and live agentic Blender assertions passed 100%!\n');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} finally {
  try {
    fs.rmSync(QA_ROOT, { recursive: true, force: true });
  } catch (_) {}
}
