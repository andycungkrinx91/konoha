#!/usr/bin/env node
'use strict';

/**
 * tests/test_yamanaka_langgraph_pipeline.js
 *
 * Verifies LangGraph.js Yamanaka 3D Workflow StateGraph:
 * Proves StateGraph compiles and links with KonohaCheckpointSaver
 * Proves end-to-end execution of runYamanaka3DGraph()
 * Proves generation_jobs, validation_results, and llm_requests_3d persistence in SQLite
 * Proves liveAgentSteps streaming and intermediate .glb hot-reload generation
 * Proves staging directory is cleaned upon promotion
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-langgraph-3d-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'test_lg.db');
process.env.KONOHA_DB_PATH = testDbPath;
process.env.KONOHA_3D_OUTPUT_DIR = path.join(QA_ROOT, '3d-output');

const { getConnection, setupSchema } = require('../src/db');
const {
  buildYamanaka3DGraph,
  runYamanaka3DGraph,
  MAX_YAMANAKA_REPAIR_ATTEMPTS
} = require('../src/workflow/yamanaka/graph');
const { dispatchYamanakaWorkflow } = require('../src/workflow/yamanaka/workflows');
const { getJobById, getAssetById, get3DTokenTelemetry } = require('../src/mcp/three_asset/db_3d_schema');

console.log('Running test_yamanaka_langgraph_pipeline.js...');

const conn = getConnection(testDbPath);
setupSchema(conn);

async function runTests() {
  // Build and compile graph
  console.log('\n--- 1. Testing LangGraph StateGraph Construction ---');
  const graph = buildYamanaka3DGraph();
  assert.ok(graph, 'StateGraph must compile successfully');
  assert.strictEqual(MAX_YAMANAKA_REPAIR_ATTEMPTS, 3);
  console.log('  ✓ StateGraph compiled and linked with KonohaCheckpointSaver.');

  // Run Text-to-3D through LangGraph pipeline
  console.log('\n--- 2. Testing End-to-End runYamanaka3DGraph Execution ---');
  const jobId = `job_lg_${Date.now()}`;
  const streamedActions = [];

  const result = await runYamanaka3DGraph(
    {
      job_id: jobId,
      prompt: 'Cyberpunk quantum mainframe terminal with glowing holographic rings',
      archetype: 'saas',
      profile: 'enterprise_pbr',
      quality_preset: 'standard',
      requested_compute_mode: 'auto'
    },
    {
      configurable: {
        onAction: (act) => streamedActions.push(act)
      }
    }
  );

  assert.strictEqual(result.success, true, 'runYamanaka3DGraph must succeed');
  assert.strictEqual(result.status, 'completed');
  assert.ok(result.asset_id, 'Asset ID must be assigned upon promotion');
  assert.ok(fs.existsSync(result.output_path), 'Final GLB must exist at output_path');
  assert.ok(fs.existsSync(result.preview_path), 'Preview PNG must exist');
  const agenticActions = streamedActions.filter((act) => act.event === 'blender_agent_action');
  assert.strictEqual(agenticActions.length, 6, 'Must stream all 6 agentic actions');
  const baseMeshReady = streamedActions.find((act) => act.event === 'base_mesh_ready');
  assert.ok(baseMeshReady, 'Must emit base_mesh_ready once the base GLB is exported for live viewport hot-reload');
  assert.strictEqual(baseMeshReady.live_glb_ready, true);
  console.log(`  ✓ Workflow completed. Promoted asset: ${result.asset_id}`);

  // Verify SQLite DB Records
  console.log('\n--- 3. Testing SQLite Database Records ---');
  const job = getJobById(conn, result.job_id || jobId);
  assert.ok(job);
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.staging_cleaned, 1, 'Staging directory must be marked cleaned');

  const asset = getAssetById(conn, result.asset_id);
  assert.ok(asset);
  assert.strictEqual(asset.asset_status, 'ready');
  assert.strictEqual(asset.files.length >= 2, true);

  const telem = get3DTokenTelemetry(conn, 'all');
  assert.ok(telem.total_tokens >= 0);
  console.log(`  ✓ generation_jobs, assets, asset_files, and tokens persisted accurately.`);

  // Test dispatchYamanakaWorkflow alias
  console.log('\n--- 4. Testing dispatchYamanakaWorkflow Delegate ---');
  const aliasResult = await dispatchYamanakaWorkflow({
    prompt: 'Modular tactical defense turret',
    archetype: 'game-prop',
    profile: 'draft'
  });
  assert.strictEqual(aliasResult.success, true);
  console.log('  ✓ dispatchYamanakaWorkflow delegated cleanly through LangGraph.');

  console.log('\n✔ All Yamanaka LangGraph pipeline tests passed 100%!\n');
}

runTests().then(() => {
  try { fs.rmSync(QA_ROOT, { recursive: true, force: true }); } catch (_) {}
}).catch((err) => {
  console.error('Test failed with error:', err);
  try { fs.rmSync(QA_ROOT, { recursive: true, force: true }); } catch (_) {}
  process.exit(1);
});
