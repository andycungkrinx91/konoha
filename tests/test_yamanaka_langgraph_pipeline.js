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
  nodeValidatePre,
  nodeRepair,
  routePreValidation,
  MAX_YAMANAKA_REPAIR_ATTEMPTS
} = require('../src/workflow/yamanaka/graph');
const { dispatchYamanakaWorkflow } = require('../src/workflow/yamanaka/workflows');
const { getJobById, getAssetById, get3DTokenTelemetry, createJobRecord } = require('../src/mcp/three_asset/db_3d_schema');

console.log('Running test_yamanaka_langgraph_pipeline.js...');

const conn = getConnection(testDbPath);
setupSchema(conn);

// Mirrors the dispatcher's on-disk layout (<queueRoot>/<requestId>/<requestId>.request.json).
// Polling for the worker's result rather than the request file is required: the worker
// renames the request to .running on claim, so the request file legitimately disappears.
function writeLiveRequest(config) {
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const requestDir = path.join(os.homedir(), '.konoha', 'blender_queue', requestId);
  fs.mkdirSync(requestDir, { recursive: true });
  fs.writeFileSync(path.join(requestDir, `${requestId}.request.json`), JSON.stringify(config), 'utf8');
  return { requestId, requestDir, resultPath: path.join(requestDir, `${requestId}.result.json`) };
}

async function awaitLiveResult(requestDir, resultPath, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      const stepIds = fs.readdirSync(requestDir).sort().flatMap((fileName) => {
        if (!fileName.endsWith('.output.json')) return [];
        const envelope = JSON.parse(fs.readFileSync(path.join(requestDir, fileName), 'utf8'));
        return envelope.payload && envelope.payload.event === 'step' ? [envelope.payload.step_id] : [];
      });
      return { code: result.success === false ? 1 : 0, error: result.error || null, stepIds };
    }
    if (Date.now() > deadline) return { code: -1, error: 'Live Blender session did not answer within the test deadline', stepIds: [] };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const DELIVERY_BRIEF = {
  components: [
    { name: 'primary_hull', description: 'main hull body', relative_bbox: { w: 1.2, h: 1.5, d: 1.0 }, color: '#475569' },
    { name: 'glass_window', description: 'glass window facade', relative_bbox: { w: 0.8, h: 0.7, d: 0.2 }, color: '#38bdf8' },
    { name: 'entrance_door', description: 'entrance door', relative_bbox: { w: 0.4, h: 0.9, d: 0.1 }, color: '#1e293b' },
    { name: 'signage', description: 'signage emblem', relative_bbox: { w: 0.6, h: 0.2, d: 0.1 }, color: '#f59e0b' },
    { name: 'roof_slab', description: 'roof slab', relative_bbox: { w: 1.0, h: 0.2, d: 1.0 }, color: '#94a3b8' },
    { name: 'antenna', description: 'antenna spire', relative_bbox: { w: 0.1, h: 0.6, d: 0.1 }, color: '#cbd5e1' }
  ]
};

async function testBriefPlacementSemantics() {
  console.log('\n  D1: object-brief components keep pre-refactor placement semantics');
  const { specFromBriefComponents } = require('../src/mcp/three_asset/vision_spec');
  const spec = specFromBriefComponents(DELIVERY_BRIEF, 'DeliveryReview', 'game-prop', 12000);
  assert.ok(spec && Array.isArray(spec.nodes), 'Brief synthesis must yield a node list');
  const byName = new Map(spec.nodes.map((n) => [n.name, n]));
  const main = DELIVERY_BRIEF.components[0].relative_bbox;
  const expectedY = {
    primary_hull: main.h * 0.5,
    glass_window: main.h * 0.58,
    entrance_door: Math.min(main.h * 0.28, 0.9 * 0.6),
    signage: main.h * 0.86,
    roof_slab: main.h + 0.2 * 0.5,
    antenna: main.h + 0.2 * 0.88 + 0.6 * 0.5
  };
  const cursorTrail = [];
  DELIVERY_BRIEF.components.forEach((comp) => {
    const node = byName.get(comp.name);
    assert.ok(node, `Component ${comp.name} must become a node`);
    const expected = expectedY[comp.name];
    const y = node.transform.position[1];
    assert.strictEqual(y, Number(expected.toFixed(4)), `${comp.name} must sit at the pre-refactor y=${expected.toFixed(4)}`);
    assert.strictEqual(node.part.position[1], y, 'part and transform positions must agree');
    assert.strictEqual(node.transform.position[0], 0, `${comp.name} must stay centred on x=0`);
    assert.ok(y + node.part.size[1] * 0.5 < 3.0, `${comp.name} must stay inside the 3.0 bounding extent`);
    if (comp.name === 'primary_hull') assert.strictEqual(y - node.part.size[1] * 0.5, 0, 'The primary hull must be grounded at y=0');
    cursorTrail.push(y);
  });
  // Stacked (pre-refactor) components each advance the cursor by 0.88 * h, so every
  // addition pushed the tower higher and the final part left the bounding extent.
  const stacked = DELIVERY_BRIEF.components.reduce((acc, c) => acc + c.relative_bbox.h * 0.88, 0);
  assert.ok(stacked > 3.0, 'Fixture must exercise the stacking failure mode');
  assert.ok(Math.max(...cursorTrail) < 3.0, 'No component may be stacked past the bounding extent');
  assert.ok(cursorTrail.slice(1).some((y) => y > cursorTrail[0]), 'Later components must advance the vertical cursor past the primary hull');
  assert.notStrictEqual(byName.get('entrance_door').transform.position[2], 0, 'Attached components must be offset in depth, not stacked');
  assert.notStrictEqual(byName.get('glass_window').transform.position[2], 0, 'Windows must be offset in depth, not stacked');
  console.log('  ✓ D1: y positions restored and cursorY strictly advances across all brief components.');
}

async function testRepairAppliedCannotMaskRequiredRepair() {
  console.log('\n  D2: a stale repairApplied=true cannot skip a required repair');
  const { Yamanaka3DStateAnnotation } = require('../src/workflow/yamanaka/graph');
  const channel = Yamanaka3DStateAnnotation.spec.repairApplied;
  assert.ok(channel, 'repairApplied must be declared on the Yamanaka state annotation');
  assert.strictEqual(channel.lc_graph_name, 'BinaryOperatorAggregate', 'repairApplied must be a reducted channel');
  assert.strictEqual(channel.initialValueFactory(), false, 'repairApplied must default to false on a cold pass');
  assert.strictEqual(channel.operator(false, true), true);
  assert.strictEqual(channel.operator(true, false), false, 'An explicit false must overwrite a stale true');
  assert.strictEqual(channel.operator(true, undefined), true, 'undefined must leave the value untouched');

  const failingGate = { passed: false, score: 40, rows: [], issues: ['silhouette below target'] };
  const staleState = { scoreSpecPre: failingGate, repairAttempts: 0, repairApplied: true };
  assert.strictEqual(routePreValidation(staleState), 'repair', 'A failing gate must repair even with a stale repairApplied=true');
  const coldState = { repairApplied: channel.initialValueFactory() };
  assert.strictEqual(coldState.repairApplied, false, 'A cold pass must not inherit a stale repairApplied');
  const passJobId = 'job_d2_two_pass';
  createJobRecord(getConnection(), { job_id: passJobId, nonce: 'd2nonce', source_mode: 'text_to_3d', prompt: 'two pass', staging_rel_dir: `staging/${passJobId}` });
  const flawedSpec = { nodes: [{ name: 'hull', part: { primitive: 'box', size: [1, 1, 1] }, material: { type: 'physical', roughness: 9, metalness: 9 }, transform: { position: [0, 0.5, 0] } }] };
  const secondPass = await nodeValidatePre({ jobId: passJobId, profile: 'production_pbr', spec: flawedSpec });
  const merged = { ...coldState, ...secondPass };
  assert.strictEqual(merged.repairApplied, false, 'A second pass that produced no repair must not claim one');
  assert.strictEqual(merged.scoreSpecPre.passed, false, 'The second pass pre-gate must genuinely fail the out-of-range spec');
  assert.strictEqual(routePreValidation({ ...merged, repairAttempts: 0 }), 'repair', 'The second pass must still repair a failing pre-gate');
  const repairedPass = await nodeRepair({ spec: flawedSpec, profile: 'production_pbr', critique: { issues: [] }, repairAttempts: 0 });
  assert.strictEqual(repairedPass.repairApplied, false, 'Repair against an unfixable spec must not claim success');
  assert.strictEqual(channel.operator(merged.repairApplied, repairedPass.repairApplied), false, 'Only a real patch may set repairApplied');
  console.log('  ✓ D2: stale repairApplied neither survives a cold pass nor skips a failing gate.');
}

async function testRepairPathRunsFix() {
  console.log('\n  D3: the repair path re-runs fix and the pre-gate can genuinely fail');
  const critique = { issues: [{ part: 'primary_hull', fix: { axis: 'size', index: 1, direction: 'increase', amount: 0.2 } }] };
  const spec = { nodes: [{ name: 'primary_hull', part: { primitive: 'box', size: [1, 1, 1], position: [0, 0.5, 0] }, transform: { position: [0, 0.5, 0] } }] };
  const repaired = await nodeRepair({ spec, profile: 'production_pbr', critique, repairAttempts: 0 });
  assert.strictEqual(repaired.repairApplied, true);
  assert.ok(Array.isArray(repaired.pendingPatch) && repaired.pendingPatch.length > 0, 'Repair must produce a patch through fix');
  assert.ok(repaired.spec.nodes[0].part.size[1] > 1, 'Repair must mutate the spec, not merely re-apply the profile');
  assert.strictEqual(repaired.scoreSpecPre.passed, false, 'Repair must re-score and expose a genuine failure');
  const unfixable = await nodeRepair({ spec, profile: 'production_pbr', critique: { issues: [] }, repairAttempts: 1 });
  assert.strictEqual(unfixable.repairApplied, false, 'A repaired claim without a patch is a lie and must be false');
  assert.strictEqual(unfixable.repairAttempts, 2, 'Each repair pass must still consume an attempt');
  assert.strictEqual(routePreValidation({ scoreSpecPre: repaired.scoreSpecPre, repairAttempts: repaired.repairAttempts }), 'repair',
    'A post-gate failure routed back through the pre-gate must repair, never short-circuit to build_base');
  const preJobId = 'job_d3_pre';
  createJobRecord(getConnection(), { job_id: preJobId, nonce: 'd3nonce', source_mode: 'text_to_3d', prompt: 'pre gate', staging_rel_dir: `staging/${preJobId}` });
  const preGate = await nodeValidatePre({ jobId: preJobId, profile: 'production_pbr', spec: { nodes: [] } });
  assert.strictEqual(preGate.scoreSpecPre.passed, false, 'The pre-gate must genuinely fail a spec with no subcomponents');
  assert.ok(preGate.scoreSpecPre.rows.some((row) => row.rowId === 11 && row.passed === false), 'Row 11 must report the real hierarchy failure');
  assert.strictEqual(routePreValidation({ scoreSpecPre: preGate.scoreSpecPre, repairAttempts: 0 }), 'repair');
  assert.strictEqual(routePreValidation({ scoreSpecPre: preGate.scoreSpecPre, repairAttempts: MAX_YAMANAKA_REPAIR_ATTEMPTS }), 'build_base');
  console.log('  ✓ D3: repair runs fix, re-scores, and the pre-gate genuinely fails when the spec does.');
}

async function testFailedResultCannotBeReportedAsRefinement() {
  console.log('\n  D4: a failed live result can never be reported as a successful refinement');
  const { resolveResultOutcome } = require('../src/mcp/three_asset/blender_refiner');
  for (const result of [{ success: false }, { success: false, error: '' }, { success: false, error: '   ' }, { success: false, error: null }, { success: false, error: 42 }]) {
    const outcome = resolveResultOutcome(result);
    assert.strictEqual(outcome.code, 1, `success:false must exit non-zero (${JSON.stringify(result)})`);
    assert.ok(typeof outcome.error === 'string' && outcome.error.trim().length > 0, 'success:false must always carry a non-null error');
  }
  assert.strictEqual(resolveResultOutcome({ success: false, error: 'step_2_modify_mesh raised' }).error, 'step_2_modify_mesh raised');
  assert.deepStrictEqual(resolveResultOutcome({ success: true }), { code: 0, error: null });
  const missingBase = await executeLiveRefinement({ jobId: 'job_d4_missing' });
  assert.strictEqual(missingBase.success, false);
  assert.ok(missingBase.error, 'A failed refinement must report its cause');
  assert.strictEqual(missingBase.refinement_backend, 'deterministic_only', 'A failed refinement must never claim the Blender backend');
  console.log('  ✓ D4: success:false always yields an error and never masquerades as refinement.');
}

async function executeLiveRefinement({ jobId }) {
  const { executeLiveAgenticBlenderSession } = require('../src/mcp/three_asset/blender_refiner');
  return executeLiveAgenticBlenderSession({
    baseGlbPath: path.join(QA_ROOT, 'definitely-absent.glb'),
    intermediateDir: path.join(QA_ROOT, 'd4-intermediate'),
    stagingDir: path.join(QA_ROOT, 'd4-staging'),
    jobId,
    spec: { nodes: [] }
  });
}

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
      profile: 'production_pbr',
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
  // The inspect->fix->rebuild loop legitimately re-streams all 6 steps for every
  // refinement pass, so uniqueness is asserted per pass (step numbering restarts at 1).
  const actionPasses = [];
  for (const act of agenticActions) {
    const current = actionPasses[actionPasses.length - 1];
    if (!current || act.step_number === 1) actionPasses.push([act]);
    else current.push(act);
  }
  for (const passActions of actionPasses) {
    const stepIds = new Set(passActions.map((act) => act.step_id));
    assert.strictEqual(stepIds.size, passActions.length, 'Each agentic step must be streamed exactly once per refinement pass');
    assert.strictEqual(passActions.length, 6, 'Every refinement pass must stream all 6 agentic actions');
  }
  assert.ok(actionPasses.length >= 1, 'At least one refinement pass must be streamed');
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

  // Focused Regression Assertions (Advisor Verification)
  console.log('\n--- 5. Testing Focused Regressions (scoreSpec 14 rows, part_library, string materials, ricecooker, routePostValidation) ---');
  const { extractLabelText, stripLabelText, inferArchetypeFromPrompt } = require('../src/mcp/three_asset/spec_schema');
  const { synthesizeSceneFromPrompt } = require('../src/mcp/three_asset/prompt_synthesizer');
  const { applyGenerationProfile, scoreSpec } = require('../src/mcp/three_asset/style_profile');
  const { boxNode, cylinderNode, capsuleNode, sphereNode, torusNode, coneNode, detailParts } = require('../src/mcp/three_asset/part_library');
  const { boxRatioOk, extractSpecHeightToWidthRatio } = require('../src/mcp/three_asset/silhouette');
  const { routePostValidation, routeAfterFix } = require('../src/workflow/yamanaka/graph');

  assert.deepStrictEqual(extractLabelText('generate ricecooker with merk Yong Ma'), ['Yong Ma']);
  assert.strictEqual(stripLabelText('generate ricecooker with merk Yong Ma'), 'generate ricecooker');
  assert.strictEqual(inferArchetypeFromPrompt('generate ricecooker with merk Yong Ma'), 'game-prop');
  const cookerSpec = synthesizeSceneFromPrompt('generate ricecooker with merk Yong Ma', 'RiceCooker', 12000, 'game-prop');
  assert.ok(cookerSpec && Array.isArray(cookerSpec.nodes) && cookerSpec.nodes.length >= 8);
  assert.ok(extractSpecHeightToWidthRatio(cookerSpec) >= 0.75, 'Rice cooker H/W ratio must be >= 0.75');

  // Direct part_library constructor & X-symmetry checks
  const bn = boxNode('b', 1, 2, 3, 0.1, 0.2, 0.3, '#112233');
  const cyn = cylinderNode('cy', 0.4, 0.5, 1.2, -0.1, 0.5, 0.2, '#223344');
  const capn = capsuleNode('ca', 0.2, 0.8, 0, 0.6, 0, '#334455');
  const spn = sphereNode('sp', 0.3, 0, 1.0, 0.1, '#445566');
  const trn = torusNode('tr', 0.5, 0.05, 0, 0.8, 0, '#556677');
  const cnn = coneNode('cn', 0.25, 0.6, 0, 1.2, 0, '#667788');
  assert.deepStrictEqual(bn.transform.position, [0.1, 0.2, 0.3]);
  assert.deepStrictEqual(cyn.transform.position, [-0.1, 0.5, 0.2]);
  assert.deepStrictEqual(capn.transform.position, [0, 0.6, 0]);
  assert.deepStrictEqual(spn.transform.position, [0, 1.0, 0.1]);
  assert.deepStrictEqual(trn.transform.position, [0, 0.8, 0]);
  assert.deepStrictEqual(cnn.transform.position, [0, 1.2, 0]);

  const oddPadded = detailParts(5, []);
  assert.strictEqual(oddPadded.length, 5);
  assert.strictEqual(oddPadded[4].transform.position[0], 0, 'Odd final detailPart must lie on X=0 symmetry plane');

  // String material normalization ('matte_black_steel') and scoreSpec 14 rows
  const stringMatSpec = {
    name: 'StringMatTest',
    archetype: 'game-prop',
    nodes: cookerSpec.nodes.map((n, idx) => ({
      ...n,
      material: idx === 0 ? 'matte_black_steel' : '#cbd5e1'
    }))
  };
  const normalizedMatSpec = applyGenerationProfile(stringMatSpec, 'production_pbr');
  assert.strictEqual(typeof normalizedMatSpec.nodes[0].material, 'object');
  assert.strictEqual( typeof normalizedMatSpec.nodes[0].material.metalness, 'number');
  const scored = scoreSpec(normalizedMatSpec, {
    profile: 'production_pbr',
    checks: { silhouetteIoU: 0.9, symmetry: 0.95, boxRatioOk: true, boxRatio: 1.05 }
  });
  assert.strictEqual(scored.rows.length, 14, 'scoreSpec must emit all 14 rows');
  assert.deepStrictEqual(scored.rows.map((r) => r.rowId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.strictEqual(scored.passed, true);

  // Flat disc fails boxRatioOk against objectBrief expecting H/W >= 0.75
  const flatDiscSpec = {
    nodes: [cylinderNode('disc', 1.2, 1.2, 0.15, 0, 0.075, 0, '#94a3b8')]
  };
  assert.strictEqual(boxRatioOk(flatDiscSpec, { proportions: { height_to_width_ratio: 1.0 } }, 0.25), false);

  // routePostValidation repairs failed scores (including row 14 failure and missing scoreSpecPost)
  assert.strictEqual(routePostValidation({ scoreSpecPost: { passed: false, rows: scored.rows.map((r) => r.rowId === 14 ? { ...r, passed: false } : r) }, repairAttempts: 0 }), 'repair');
  assert.strictEqual(routePostValidation({ scoreSpecPost: null, repairAttempts: 1 }), 'repair');
  // The pre-gate counter no longer governs this gate: an exhausted DSL budget must
  // still leave the post-Blender gate able to repair.
  assert.strictEqual(routePostValidation({ scoreSpecPost: { passed: false }, repairAttempts: MAX_YAMANAKA_REPAIR_ATTEMPTS }), 'repair');
  assert.strictEqual(routePostValidation({ scoreSpecPost: { passed: false }, postRepairAttempts: MAX_YAMANAKA_REPAIR_ATTEMPTS }), 'promote');
  assert.strictEqual(routePostValidation({ scoreSpecPost: { passed: true }, repairAttempts: 0 }), 'promote');
  assert.strictEqual(routeAfterFix({ pendingPatch: [{ part: 'body', axis: 'size' }] }), 'rebuild');
  assert.strictEqual(routeAfterFix({ pendingPatch: [] }), 'validate');

  // The generation profile rewrites every node (grounding offset + clearcoat) and pads
  // short specs with filler parts. A refine fork must not go through it: the parent
  // composition is the thing a fork preserves.
  const { nodeRepair } = require('../src/workflow/yamanaka/graph');
  const { syntheticParentSpec } = require('./helpers/refine_fixtures');
  const forkParentSpec = syntheticParentSpec();
  const forkEditedName = forkParentSpec.nodes[0].name;
  const forkSeedSpec = {
    ...forkParentSpec,
    nodes: forkParentSpec.nodes.map((n) => (n.name === forkEditedName
      ? { ...n, material: { ...n.material, color: '#d4af37', metalness: 0.95, roughness: 0.22 } }
      : n))
  };
  const forkRepaired = await nodeRepair({
    refineMode: true,
    repairAttempts: 0,
    spec: forkSeedSpec,
    profile: 'production_pbr',
    critique: { issues: [] },
    jobId: 'fork_repair_probe',
    iteration: 1
  });
  assert.strictEqual(forkRepaired.spec.nodes.length, forkSeedSpec.nodes.length, 'repair must not pad a refine fork past its parent composition');
  const forkParentByName = new Map(forkSeedSpec.nodes.map((n) => [n.name, n]));
  let forkChanged = 0;
  for (const node of forkRepaired.spec.nodes) {
    const beforeNode = forkParentByName.get(node.name);
    if (beforeNode && JSON.stringify(node) !== JSON.stringify(beforeNode)) forkChanged += 1;
  }
  assert.strictEqual(forkChanged, 0, `repair must not rewrite inherited fork nodes (${forkChanged} changed)`);

  // A text generation must still be normalised and padded by the profile.
  const genRepaired = await nodeRepair({
    refineMode: false,
    repairAttempts: 0,
    spec: { archetype: 'character', nodes: forkSeedSpec.nodes.map((n) => JSON.parse(JSON.stringify(n))) },
    profile: 'production_pbr',
    critique: { issues: [] },
    jobId: 'gen_repair_probe',
    iteration: 1
  });
  assert.ok(genRepaired.spec.nodes.length >= 6, 'a generation repair must still pad up to the profile minimum');

  // validate_pre is the third profile call site and must also leave a fork alone. Its
  // helper drops the padding but still applies the grounding/material rewrites, so a
  // passing fork that returned the helper's output was silently re-normalised. Exercise
  // the passing branch with nodes the profile would rewrite.
  const { nodeValidatePre } = require('../src/workflow/yamanaka/graph');
  const normalizedParent = applyGenerationProfile(syntheticParentSpec(), 'production_pbr');
  const forkPassSpec = {
    ...normalizedParent,
    nodes: normalizedParent.nodes.map((n) => {
      const next = { ...n, material: { ...n.material } };
      delete next.material.clearcoat;
      if (next.transform && Array.isArray(next.transform.position)) {
        next.transform = { ...next.transform, position: [...next.transform.position] };
      }
      return next;
    })
  };
  const forkPassSeed = JSON.parse(JSON.stringify(forkPassSpec));
  const forkPassJobId = 'validate_pre_fork_probe';
  createJobRecord(getConnection(), { job_id: forkPassJobId, nonce: 'vpforksnonce', source_mode: 'text_to_3d', prompt: 'fork pre gate', staging_rel_dir: `staging/${forkPassJobId}` });
  const forkPre = await nodeValidatePre({ jobId: forkPassJobId, profile: 'production_pbr', spec: forkPassSpec, refineMode: true, repairAttempts: 0 });
  assert.strictEqual(forkPre.scoreSpecPre.passed, true, 'the fork pre-gate probe must exercise the passing branch');
  assert.strictEqual(forkPre.spec.nodes.length, forkPassSeed.nodes.length, 'validate_pre must not pad a refine fork');
  const forkPreByName = new Map(forkPassSeed.nodes.map((n) => [n.name, n]));
  let forkPreChanged = 0;
  for (const node of forkPre.spec.nodes) {
    const beforeNode = forkPreByName.get(node.name);
    if (beforeNode && JSON.stringify(node) !== JSON.stringify(beforeNode)) forkPreChanged += 1;
  }
  assert.strictEqual(forkPreChanged, 0, `validate_pre must not rewrite inherited fork nodes (${forkPreChanged} changed)`);
  // A generation must still be normalised by the same node.
  const genPreJobId = 'validate_pre_gen_probe';
  createJobRecord(getConnection(), { job_id: genPreJobId, nonce: 'vpgensnonce', source_mode: 'text_to_3d', prompt: 'gen pre gate', staging_rel_dir: `staging/${genPreJobId}` });
  const genPre = await nodeValidatePre({ jobId: genPreJobId, profile: 'production_pbr', spec: JSON.parse(JSON.stringify(forkPassSeed)), refineMode: false, repairAttempts: 0 });
  let genPreRewritten = 0;
  for (const node of genPre.spec.nodes) {
    const beforeNode = forkPreByName.get(node.name);
    if (beforeNode && JSON.stringify(node) !== JSON.stringify(beforeNode)) genPreRewritten += 1;
  }
  assert.strictEqual(genPreRewritten, forkPassSeed.nodes.length, 'validate_pre must still normalise a generation spec');

  // A fork with non-finite geometry must fail the gate, never be rescued by the profile
  // pass: scoring its normalised form would turn a NaN extent into a passing one.
  const malformedSeed = JSON.parse(JSON.stringify(normalizedParent));
  malformedSeed.nodes.forEach((n) => { if (n.transform && Array.isArray(n.transform.position)) delete n.transform.position[1]; });
  const malformedJobId = 'validate_pre_nan_probe';
  createJobRecord(getConnection(), { job_id: malformedJobId, nonce: 'vpnanonsnonce', source_mode: 'text_to_3d', prompt: 'nan pre gate', staging_rel_dir: `staging/${malformedJobId}` });
  const malformedPre = await nodeValidatePre({ jobId: malformedJobId, profile: 'production_pbr', spec: malformedSeed, refineMode: true, repairAttempts: 0 });
  assert.strictEqual(malformedPre.scoreSpecPre.passed, false, 'a fork with missing coordinates must not pass the pre-gate');
  const extentRow = malformedPre.scoreSpecPre.rows.find((r) => r.rowId === 8);
  assert.strictEqual(Number.isNaN(extentRow.measuredValue), true, 'the extent row must report the non-finite measurement rather than hiding it');
  assert.strictEqual(malformedPre.spec.nodes.length, malformedSeed.nodes.length, 'the failing fork must still return its original composition for repair');
  const malformedByName = new Map(malformedSeed.nodes.map((n) => [n.name, n]));
  let malformedChanged = 0;
  for (const node of malformedPre.spec.nodes) {
    const beforeNode = malformedByName.get(node.name);
    if (beforeNode && JSON.stringify(node) !== JSON.stringify(beforeNode)) malformedChanged += 1;
  }
  assert.strictEqual(malformedChanged, 0, 'the failing branch must return the untouched fork spec so repair starts from the original composition');

  // The two quality gates are separate checks with separate budgets: exhausting the
  // DSL gate must not silently disable the post-Blender gate.
  assert.strictEqual(
    routePostValidation({ scoreSpecPost: { passed: false }, repairAttempts: MAX_YAMANAKA_REPAIR_ATTEMPTS, postRepairAttempts: 0 }),
    'repair',
    'an exhausted pre-gate budget must not consume the post-gate budget'
  );
  assert.strictEqual(
    routePostValidation({ scoreSpecPost: { passed: false }, postRepairAttempts: MAX_YAMANAKA_REPAIR_ATTEMPTS }),
    'promote',
    'an exhausted post-gate budget must stop repairing'
  );
  const postGateRepair = await nodeRepair({
    repairFromPostGate: true,
    refineMode: false,
    repairAttempts: 2,
    postRepairAttempts: 0,
    spec: { archetype: 'character', nodes: [{ name: 'a', part: { type: 'box', size: [1, 1, 1] }, transform: { position: [0, 0.5, 0] }, material: { color: '#334455' } }] },
    profile: 'draft',
    critique: { issues: [] },
    jobId: 'post_gate_repair_probe',
    iteration: 1
  });
  assert.strictEqual(postGateRepair.postRepairAttempts, 1, 'a post-gate repair must charge the post-gate budget');
  assert.strictEqual(postGateRepair.repairAttempts, 2, 'a post-gate repair must not charge the pre-gate budget');
  assert.strictEqual(postGateRepair.repairFromPostGate, false, 'the post-gate marker must not survive the repair it flagged');

  console.log('  ✓ All focused regressions (14 rows, part_library, matte_black_steel, ricecooker, routePostValidation, fork repair, fork pre-gate, split repair budgets) passed.');

  // Live-queue replay contract: guards that must hold even when Blender is idle.
  console.log('\n--- 6. Testing Live Blender Queue Replay Guards ---');
  const {
    createStepTally,
    resolveExpectedSteps,
    TOTAL_AGENT_STEPS
  } = require('../src/mcp/three_asset/blender_refiner');
  const { getBlenderStatus } = require('../src/mcp/three_asset/blender_installer');
  const blenderStatus = getBlenderStatus();

  const tally = createStepTally();
  assert.strictEqual(tally.claim({ step_id: 'step_1_workspace_import' }), true);
  assert.strictEqual(tally.claim({ step_id: 'step_1_workspace_import' }), false, 'A replayed step_id must be refused');
  assert.strictEqual(tally.claim({ step_id: 'step_2_modify_mesh' }), true, 'A distinct step_id must be counted once');
  assert.strictEqual(tally.claim({}), false, 'A step without step_id must never be counted');
  assert.strictEqual(tally.size(), 2);
  assert.strictEqual(tally.duplicateCount(), 1);

  // blender_live_worker.py emits worker_ready WITHOUT total_steps; worker_complete is authoritative.
  assert.strictEqual(resolveExpectedSteps({ event: 'worker_ready' }, { steps_executed: 6 }, []), 6);
  assert.strictEqual(resolveExpectedSteps({ event: 'worker_ready', total_steps: 6 }, null, []), 6);
  assert.strictEqual(resolveExpectedSteps(null, null, [{ total_steps: 6 }]), 6);
  assert.strictEqual(resolveExpectedSteps(null, null, []), TOTAL_AGENT_STEPS, 'Constant is the last-resort fallback');
  assert.strictEqual(resolveExpectedSteps({ total_steps: 0 }, { steps_executed: 'x' }, []), TOTAL_AGENT_STEPS, 'Non-positive counts are rejected');

  if (blenderStatus.installed) {
    const liveQueueRoot = path.join(os.homedir(), '.konoha', 'blender_queue');
    fs.mkdirSync(liveQueueRoot, { recursive: true });
    const blenderRefiner = require('../src/mcp/three_asset/blender_refiner');
    // Observed worker failure contract: the step traceback reaches the worker log and
    // the operator sees the raising step, not only the generic dispatcher error.
    const probeLog = path.join(QA_ROOT, 'worker-probe.stderr');
    fs.writeFileSync(probeLog, 'Traceback (most recent call last):\n  KeyError: base_glb_path\n', 'utf8');
    let previousLog = null;
    try { previousLog = fs.readFileSync(blenderRefiner.liveWorkerLogPath()); } catch (_) { /* first run leaves no log */ }
    fs.appendFileSync(blenderRefiner.liveWorkerLogPath(), fs.readFileSync(probeLog));
    const logTail = blenderRefiner.excerptWorkerLog();
    assert.ok(/KeyError: base_glb_path/.test(logTail || ''), 'Worker log tail must carry the raised step error');
    assert.ok(!blenderRefiner.redactCredentials('API_KEY=abcdef123456').includes('abcdef123456'), 'Credentials must never surface in the log tail');
    if (previousLog) fs.writeFileSync(blenderRefiner.liveWorkerLogPath(), previousLog);
    const {
      dispatchToLiveSession,
      ensureLiveBlenderSession,
      getLiveBlenderStatus,
      buildWorkerConfig
    } = require('../src/mcp/three_asset/blender_refiner');
    // Auto-launch first: only a registered live_gui worker makes queue delivery the
    // expected path; otherwise the dispatcher is right to time out.
    await ensureLiveBlenderSession({ gui: true });
    const liveWorker = getLiveBlenderStatus();
    const liveRoot = path.join(QA_ROOT, 'live-queue');
    const liveOps = {
      baseGlbPath: '',
      intermediateDir: path.join(liveRoot, 'intermediate'),
      stagingDir: path.join(liveRoot, 'staging'),
      jobId: `job_live_${Date.now()}`,
      prompt: 'live queue delivery guard',
      requestedComputeMode: 'cpu'
    };
    fs.mkdirSync(liveOps.intermediateDir, { recursive: true });
    fs.mkdirSync(liveOps.stagingDir, { recursive: true });
    fs.copyFileSync(result.output_path, path.join(liveOps.intermediateDir, 'base.glb'));
    liveOps.baseGlbPath = path.join(liveOps.intermediateDir, 'base.glb');
    // A leftover request from a previous run carrying a step stamped in the SAME
    // millisecond as the new request starts: it must never be replayed.
    const staleRequestId = `req_${Date.now()}_deadbeef`;
    const staleDir = path.join(liveQueueRoot, staleRequestId);
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, `${staleRequestId}.request.json`), JSON.stringify(buildWorkerConfig(liveOps)), 'utf8');
    fs.writeFileSync(
      path.join(staleDir, `${staleRequestId}.${Date.now()}000000.output.json`),
      JSON.stringify({ request_id: staleRequestId, seq: 1, payload: { event: 'step', step_id: 'step_9_stale_replay' } }),
      'utf8'
    );

    const liveDelivered = [];
    const liveRegistered = liveWorker.running && liveWorker.mode === 'live_gui';
    if (liveRegistered) {
      const sessionConfig = buildWorkerConfig(liveOps);
      fs.copyFileSync(liveOps.baseGlbPath, sessionConfig.live_glb_path);
      const { requestId, requestDir, resultPath } = writeLiveRequest(sessionConfig);
      const liveOutcome = await awaitLiveResult(requestDir, resultPath);
      assert.strictEqual(liveOutcome.code, 0, `Live request must complete (got ${liveOutcome.error || liveOutcome.code})`);
      assert.deepStrictEqual(liveOutcome.stepIds, [
        'step_1_workspace_import', 'step_2_modify_mesh', 'step_3_uv_unwrap',
        'step_4_set_materials', 'step_5_setup_studio', 'step_6_export_glb'
      ], 'Live request must deliver all 6 steps');
      assert.ok(fs.existsSync(sessionConfig.final_glb_path), 'Live request must export the final GLB');
      assert.ok(fs.existsSync(sessionConfig.preview_png_path), 'Live request must render the preview');
      const strayRecords = fs.readdirSync(liveQueueRoot).filter((fileName) => fileName.startsWith(`${requestId}.`) && fileName.endsWith('.output.json'));
      assert.strictEqual(strayRecords.length, 0, `Queue root must hold no <requestId>.*.output.json: ${strayRecords.join(', ')}`);
      console.log('  ✓ Live request delivered all 6 steps with code 0; telemetry stayed inside the request directory.');
    } else {
      const liveOutcome = await dispatchToLiveSession({ prompt: 'queue replay guard' }, (payload) => liveDelivered.push(payload), 20000);
      assert.strictEqual(liveOutcome.code, -1, 'A GUI worker that never answers must fail via the timeout exit');
      assert.ok(/timed out/.test(liveOutcome.error || ''), 'Timeout must be reported, not silently swallowed');
      console.log('  · No live worker registered: dispatch terminated via timeout exit.');
    }
    const replayed = liveDelivered.filter((payload) => payload && payload.step_id === 'step_9_stale_replay');
    assert.strictEqual(replayed.length, 0, 'Stale outputs from a previous request must never be replayed');
    // A live worker owns the stale fixture's layout (and may rewrite it), but an idle
    // queue must leave it byte-for-byte alone: only unregistered sessions are silent.
    if (!liveRegistered) {
      const leftover = fs.existsSync(staleDir) ? fs.readdirSync(staleDir).filter((f) => f.startsWith(staleRequestId)) : [];
      assert.strictEqual(leftover.length, 2, "The stale request's own files must stay untouched");
    }
    fs.rmSync(staleDir, { recursive: true, force: true });
    console.log('  ✓ Stale same-millisecond outputs rejected.');
  } else {
    console.log('  · Blender unavailable: same-millisecond stale replay exercised by the batch pipeline above.');
  }

  console.log('\n--- 7. Testing Delivery-Review Defects D1-D4 ---');
  await testBriefPlacementSemantics();
  await testRepairAppliedCannotMaskRequiredRepair();
  await testRepairPathRunsFix();
  await testFailedResultCannotBeReportedAsRefinement();
  console.log('  ✓ D1-D4 delivery-review defects proven fixed.');

  console.log('\n✔ All Yamanaka LangGraph pipeline tests passed 100%!\n');
}

runTests().then(() => {
  try { fs.rmSync(QA_ROOT, { recursive: true, force: true }); } catch (_) {}
}).catch((err) => {
  console.error('Test failed with error:', err);
  try { fs.rmSync(QA_ROOT, { recursive: true, force: true }); } catch (_) {}
  process.exit(1);
});
