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
  installAllTools
} = require('../src/mcp/three_asset/blender_installer');
const { executeLiveAgenticBlenderSession } = require('../src/mcp/three_asset/blender_refiner');
const { globalCircuitRegistry } = require('../src/circuit_breaker');

console.log('Running test_yamanaka_compute_and_installer.js...');

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

  // --- 2. OS-Detecting Toolchain Auto-Installer ---
  console.log('\n--- 2. Testing OS-Detecting Blender & DCC-MCP-Blender Installer ---');
  const sysEnv = detectSystemEnvironment();
  assert.ok(['Linux', 'Windows', 'macOS'].includes(sysEnv.osName));
  assert.ok(sysEnv.toolchainDir.includes('toolchains'));
  assert.ok(sysEnv.manifest.url.includes('blender'));
  console.log(`  ✓ System environment: ${sysEnv.osName} (${sysEnv.arch}) -> manifest: ${sysEnv.manifest.filename}`);

  const toolchain = getToolchainStatus();
  assert.ok(toolchain.components.three_manifold);
  assert.ok(toolchain.components.blender);
  assert.ok(toolchain.components.dcc_mcp_blender);
  assert.strictEqual(toolchain.components.three_manifold.ready_state, 'Ready');
  console.log('  ✓ Toolchain status correctly aggregated components with ready states.');

  // Test Installer Progress Callbacks
  const progressLogs = [];
  Promise.resolve().then(async () => {
    await installAllTools({
      onProgress: (p) => progressLogs.push(p)
    });
    assert.ok(progressLogs.length >= 5, 'Installation must emit progress milestones');
    console.log('  ✓ installAllTools executed with progress reporting.');

    // --- 3. 6-Step Live Agentic Blender Session ---
    console.log('\n--- 3. Testing 6-Step Live Agentic Blender Streaming ---');
    const stagingDir = path.join(QA_ROOT, 'staging');
    const intermediateDir = path.join(stagingDir, 'intermediate');
    fs.mkdirSync(intermediateDir, { recursive: true });

    const baseGlbPath = path.join(stagingDir, 'base.glb');
    fs.writeFileSync(baseGlbPath, Buffer.from('mock base glb'));

    const streamedActions = [];
    const sessionRes = await executeLiveAgenticBlenderSession({
      baseGlbPath,
      intermediateDir,
      stagingDir,
      jobId: 'job_agentic_test',
      requestedComputeMode: 'auto',
      onAction: (act) => streamedActions.push(act)
    });

    assert.strictEqual(sessionRes.success, true);
    assert.strictEqual(sessionRes.steps_executed, 6);
    assert.strictEqual(streamedActions.length, 6);

    const stepIds = streamedActions.map(a => a.step_id);
    assert.deepStrictEqual(stepIds, [
      'step_1_workspace_import',
      'step_2_bevel_and_normals',
      'step_3_uv_unwrap_pack',
      'step_4_principled_bsdf_pbr',
      'step_5_studio_lighting_and_camera',
      'step_6_final_export_and_verify'
    ]);

    for (const act of streamedActions) {
      assert.strictEqual(act.event, 'blender_agent_action');
      assert.strictEqual(typeof act.live_glb_path, 'string');
      assert.ok(act.parameters);
      assert.ok(act.narrative);
    }

    assert.ok(fs.existsSync(path.join(intermediateDir, 'live_step.glb')), 'live_step.glb must exist for WebGL viewport hot-reload');
    assert.ok(fs.existsSync(sessionRes.final_glb_path), 'Final model.glb must be generated in staging');
    console.log('  ✓ All 6 human-like agentic steps executed and intermediate .glb hot-reload snapshot verified.');

    // --- 4. Circuit Breaker Fast-Fail Transition ---
    console.log('\n--- 4. Testing Circuit Breakers ---');
    const blenderCircuit = globalCircuitRegistry.getOrCreate('yamanaka-dcc-mcp-blender', 3, 60);
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
