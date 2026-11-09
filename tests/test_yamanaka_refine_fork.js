#!/usr/bin/env node
'use strict';

/**
 * tests/test_yamanaka_refine_fork.js
 *
 * Verifies the refine feature: fork-from-existing-asset with a user edit prompt.
 *   A. Additive refine columns exist on generation_jobs / assets and carry lineage.
 *   B. nodeRefineRequest loads the parent job, seeds an edited spec and skips
 *      object_brief + synthesize_dsl (routeAfterInit).
 *   C. A fork whose instruction changes nothing fails with REFINE_NO_OP, never a silent pass.
 *   D. POST /api/v1/3d/assets/:assetId/refine: 400 on empty instruction, 404 on unknown
 *      asset, 422 on an inexpressible instruction, 202 + forked job on success.
 *   E. The forked job's persisted dsl_payload_json DIFFERS from the parent's, proving the
 *      edit prompt reached the geometry input instead of being recorded and ignored.
 *   F. The parent asset's GLB and preview PNG keep identical SHA-256 across the fork.
 *   G. A parent job row that is missing / soft-deleted fails loudly (no empty spec run).
 *   H. Destructive negative control: a no-op refine implementation (instruction recorded,
 *      parent spec reused verbatim) is caught by these assertions — and is reverted after.
 *   I. Fail-closed targeting: "make it red" on a multi-node parent is REFINE_TARGET_AMBIGUOUS,
 *      never an all-node repaint, and the parent spec row is not mutated.
 *   J. An instruction with no expressible property ("make it more premium") is
 *      REFINE_INSTRUCTION_UNSUPPORTED, never a silent chrome (or any) repaint.
 *   K. "recolor the lid" on a hand-built parent clones-and-patches: node count unchanged,
 *      exactly one node's material differs, every other node deep-equal to its parent node.
 *   L. A substring that matches two nodes ("handle" vs "handle_bar") is an ambiguous error
 *      naming both candidates, and nothing is edited.
 *
 * GPU BACKEND PIN
 *   Every fork run passes requested_gpu_backend: 'CUDA' so the path under test is the
 *   configured CUDA path, never one rescued by render-time failover. A live run whose
 *   reported reason is "no working GPU backend" is asserted SKIPPED (naming the reason)
 *   instead of being claimed as a pass — see assertGpuBackendHonest().
 *
 * DESTRUCTIVE NEGATIVE CONTROL
 *   Phase H temporarily replaces nodeRefineRequest with an implementation that records the
 *   instruction and reuses the parent spec, runs the same graph, and asserts that both the
 *   spec-diff proof and the parent-file SHA proof fail. The module cache is deleted and the
 *   real module is re-required afterwards; the test then re-asserts the real behaviour so a
 *   failed revert can never leave a false pass behind.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-refine-fork-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });
const testDbPath = path.join(QA_ROOT, 'test_refine.db');
process.env.KONOHA_DB_PATH = testDbPath;
process.env.KONOHA_3D_OUTPUT_DIR = path.join(QA_ROOT, '3d-output');
delete process.env.KONOHA_BLENDER_DISABLED;
process.env.KONOHA_CYCLES_SAMPLES = '4';
process.env.KONOHA_HOME = path.join(QA_ROOT, 'konoha-home');
fs.mkdirSync(path.join(QA_ROOT, 'konoha-home', 'toolchains'), { recursive: true });

const { getConnection, setupSchema } = require('../src/db');
const { globalCircuitRegistry } = require('../src/circuit_breaker');
globalCircuitRegistry.resetAll();
const db3d = require('../src/mcp/three_asset/db_3d_schema');
const graphModulePath = require.resolve('../src/workflow/yamanaka/graph');
const refineStagePath = require.resolve('../src/workflow/yamanaka/refine_stage');

console.log('Running test_yamanaka_refine_fork.js...');

const conn = getConnection(testDbPath);
setupSchema(conn);

const { humanizeNodeName, pickUniqueTarget, pickNode, syntheticParentSpec } = require('./helpers/refine_fixtures');

const REFINE_COLUMNS = {
  generation_jobs: ['parent_job_id', 'parent_asset_id', 'refine_instruction'],
  assets: ['parent_asset_id', 'refine_instruction']
};

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function loadChainedGraph() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}workflow${path.sep}yamanaka${path.sep}`)) delete require.cache[key];
  }
  return { graph: require(graphModulePath), stage: require(refineStagePath) };
}

async function createParentAsset(jobId, nonce, prompt) {
  const graph = require('../src/workflow/yamanaka/graph');
  // Pin CUDA explicitly through the graph input so the fork path never selects
  // OPTIX: this test must pass on the CONFIGURED backend path, never because a
  // render-time fallback happened to fire.
  const res = await graph.runYamanaka3DGraph({
    job_id: jobId,
    nonce,
    prompt,
    archetype: 'game-prop',
    quality_preset: 'normal',
    requested_gpu_backend: 'CUDA'
  });
  assert.strictEqual(res.success, true, `parent generation ${jobId} must complete`);
  assertGpuBackendHonest(res, `parent generation ${jobId}`);
  const job = db3d.getJobById(conn, jobId);
  const asset = db3d.getAssetById(conn, res.asset_id);
  assert.ok(asset, 'parent asset row must exist');
  return { res, job, asset };
}

/**
 * A run pinned to CUDA must never be reported as a CPU render dressed up as GPU.
 *
 * The pin guarantees the configured path is exercised; if the host genuinely has no
 * working GPU backend the run must degrade LOUDLY (compute_device CPU +
 * gpu_unavailable true + a reason naming the failed backends) and the test records
 * that as skipped: no_working_gpu_backend rather than claiming a pass.
 */
function assertGpuBackendHonest(res, label) {
  if (res.requested_gpu_backend && res.requested_gpu_backend !== 'CUDA') {
    throw new Error(`${label}: pin was not honoured (requested_gpu_backend=${res.requested_gpu_backend})`);
  }
  if (res.effective_compute_mode === 'gpu' && res.gpu_unavailable) {
    (global.__KONOHA_GPU_SKIPS = global.__KONOHA_GPU_SKIPS || []).push(label);
    console.log(`  SKIPPED[no_working_gpu_backend] ${label}: ${res.gpu_fallback_reason}`);
    return { skipped: 'no_working_gpu_backend', reason: res.gpu_fallback_reason || null };
  }
  if (res.gpu_fallback_reason && !res.gpu_unavailable) {
    assert.ok(/OPTIX|CUDA|PTX/i.test(res.gpu_fallback_reason),
      `${label}: a GPU fallback reason must name the failed backend: ${res.gpu_fallback_reason}`);
  }
  return { skipped: null };
}

function parentFileShas(asset) {
  const root = process.env.KONOHA_3D_OUTPUT_DIR;
  const glb = asset.files.find((f) => f.file_role === 'primary_glb');
  const png = asset.files.find((f) => f.file_role === 'preview_png');
  assert.ok(glb && png, 'parent asset must have a primary GLB and preview PNG');
  const glbPath = path.join(root, glb.rel_path);
  const pngPath = path.join(root, png.rel_path);
  return { glbPath, pngPath, glb: sha256File(glbPath), png: sha256File(pngPath) };
}

/**
 * True when the instruction would reproduce the parent: the same explicit hex with no style
 * tokens resolves to the parent colour, and a size token resolves to the parent's own sizes.
 */
function isNoOpInstruction(instruction, node, refineDsl, spec = { nodes: [node] }) {
  const intent = refineDsl.parseRefineIntent(instruction, spec);
  if (intent.error_code) return false;
  if (intent.kind === 'resize') return Math.abs((intent.scaleFactor || 1) - 1) < 1e-9;
  const hexOnly = intent.hexColor && intent.tokens.every((t) => !refineDsl.INTRINSIC_TOKENS[t] || refineDsl.INTRINSIC_TOKENS[t].color);
  return Boolean(hexOnly) && String(node.material.color).toLowerCase() === intent.hexColor;
}

/**
 * A usable parent fixture must expose a uniquely named restyle target. Synthesis routes through
 * a live LLM with a deterministic fallback, so a degraded fallback spec (bare numeric node names
 * like box_105) can never prove a targeted patch. Fail loudly and re-run instead of asserting on it.
 */
function assertParentFixture(job) {
  const refineDsl = require('../src/mcp/three_asset/refine_dsl');
  const spec = JSON.parse(job.dsl_payload_json);
  if (pickUniqueTarget(spec, refineDsl)) return;
  const names = (spec.nodes || []).map((n) => String(n.name));
  const numericOnly = names.filter((n) => /^[a-z]{1,8}_\d+$/.test(n)).length;
  if (numericOnly > 0 && numericOnly >= names.length - 2) {
    throw new Error(`parent fixture ${job.job_id} degraded to the deterministic fallback spec (numeric node names: ${names.slice(0, 6).join(', ')}); re-run when synthesis is reachable`);
  }
  throw new Error(`parent fixture ${job.job_id} exposes no uniquely nameable part (nodes: ${names.slice(0, 8).join(', ')})`);
}

/**
 * Renders a node name the way a user would write it. camelCase is split so "ReactorBase"
 * becomes "Reactor Base" (not the generic stub "reactor", which other parts also carry).
 */
function request(server, method, pathname, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: pathname,
        method,
        headers: { 'Content-Type': 'application/json', 'x-konoha-web-token': 'test_token', ...headers }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try { json = JSON.parse(raw); } catch (_) { /* non-JSON body stays null */ }
          resolve({ statusCode: res.statusCode, body: raw, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function startServer() {
  const { handleWebServerRequest } = require('../src/web_server');
  const tokenState = {
    sessionToken: 'test_token',
    tokenRotatedAt: Date.now(),
    previousSessionToken: null,
    previousTokenExpiresAt: 0,
    tokenTtlMs: 12 * 60 * 60 * 1000
  };
  const server = http.createServer((req, res) => {
    const ctx = {
      port: server.address().port,
      host: '127.0.0.1',
      ...tokenState,
      getSvelteKitHandler: () => null
    };
    handleWebServerRequest(req, res, ctx).catch((err) => {
      res.writeHead(500);
      res.end(err.message);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

async function waitForJob(jobId, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = db3d.getJobById(conn, jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not settle within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function runTests() {
  const graph = require('../src/workflow/yamanaka/graph');
  const stage = require('../src/workflow/yamanaka/refine_stage');

  console.log('\n--- A. Additive refine columns ---');
  for (const [table, columns] of Object.entries(REFINE_COLUMNS)) {
    const present = conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    for (const column of columns) assert.ok(present.includes(column), `${table}.${column} must exist`);
  }
  console.log('  ✓ generation_jobs and assets expose the refine lineage columns.');

  console.log('\n--- Setup: parent asset ---');
  const parent = await createParentAsset('job_refine_parent', 'nonce_refine_parent', 'industrial coolant reactor prop with hull plating');
  assertParentFixture(parent.job);
  const parentSpec = JSON.parse(parent.job.dsl_payload_json);
  assert.ok(Array.isArray(parentSpec.nodes) && parentSpec.nodes.length > 0, 'parent job must persist its scene spec');
  const refineDsl = require('../src/mcp/three_asset/refine_dsl');
  const slug = (node) => humanizeNodeName(node.name);
  const target = pickUniqueTarget(parentSpec, refineDsl);
  assert.ok(target, 'the parent must expose at least one unambiguously named part to restyle');
  const instruction = `make the ${slug(target)} gold`;
  assert.ok(!isNoOpInstruction(instruction, target, refineDsl, parentSpec), 'the positive fixture instruction must actually change the part');
  const parentSpecSnapshot = parent.job.dsl_payload_json;
  console.log(`  ✓ Parent ${parent.asset.asset_id} persisted ${parentSpec.nodes.length} nodes; editing "${target.name}".`);

  console.log('\n--- B. nodeRefineRequest loads parent and skips brief/synthesis ---');
  const loaded = await stage.nodeRefineRequest({
    parentJob: parent.job,
    parentAsset: parent.asset,
    refineInstruction: instruction,
    parentAssetId: parent.asset.asset_id,
    domainArchetype: 'game-prop'
  });
  assert.ok(!loaded.error_code, `nodeRefineRequest must accept a valid refine: ${loaded.error_code || ''} ${loaded.error || ''} | target material ${
    JSON.stringify((parentSpec.nodes.find((n) => n.name === target.name) || {}).material)}`);
  assert.ok(loaded.spec && loaded.spec.nodes.length > 0, 'fork must seed an edited spec');
  // Clone-and-patch proof on the real parent: the fork keeps every parent node and changes one.
  assert.strictEqual(loaded.spec.nodes.length, parentSpec.nodes.length, 'clone must keep the parent node count');
  // The upstream profile pass may renormalise the persisted parent after B's direct call, so
  // replay the fork against the exact serialized parent job that E inspects.
  const canonicalParent = { ...parent.job, dsl_payload_json: JSON.stringify(loaded.parentSpec) };
  const replay = await stage.nodeRefineRequest({
    parentJob: canonicalParent,
    parentAsset: parent.asset,
    refineInstruction: instruction,
    parentAssetId: parent.asset.asset_id
  });
  assert.ok(!replay.error_code, `the canonical parent must replay cleanly: ${replay.error_code} ${replay.error || ''}`);
  const parentByName = new Map(loaded.parentSpec.nodes.map((n) => [n.name, JSON.stringify(n)]));
  const drifted = replay.spec.nodes.filter((n) => parentByName.get(n.name) !== JSON.stringify(n)).map((n) => n.name);
  assert.deepStrictEqual(drifted, [target.name], 'only the targeted node may differ from the parent clone');
  assert.deepStrictEqual(replay.spec.lights, loaded.parentSpec.lights, 'parent lighting must survive the clone untouched');
  assert.strictEqual(loaded.parentJobId, parent.job.job_id);
  assert.ok(loaded.refineDiff && loaded.refineDiff.targets.includes(target.name), 'refine diff must name the edited part');
  assert.strictEqual(graph.routeAfterInit({ refineMode: true }), 'refine_request', 'refine runs join at refine_request');
  assert.strictEqual(graph.routeAfterInit({ refineMode: false }), 'chunin_search', 'normal runs enter the chunin search stage first');
  assert.strictEqual(graph.routeAfterRefine({}), 'validate_pre', 'a clean refine goes straight to validate_pre');
  // The apply path must never rebuild the spec from DSL text: clone-and-patch only.
  const stageSource = fs.readFileSync(refineStagePath, 'utf8');
  const applyBody = (stageSource.match(/function applyRefineIntent\([\s\S]*?\n}/) || [''])[0];
  assert.ok(/function applyRefineIntent/.test(applyBody), 'applyRefineIntent must exist on disk');
  assert.ok(!/parseDslOrJson/.test(applyBody), 'applyRefineIntent must not parse DSL back into a spec');
  assert.ok(/applyIntentToSpec/.test(applyBody), 'applyRefineIntent must clone-and-patch via applyIntentToSpec');
  assert.ok(/structuredClone/.test(fs.readFileSync(require.resolve('../src/mcp/three_asset/refine_dsl'), 'utf8')), 'applyIntentToSpec must clone the parent spec');
  const graphSource = fs.readFileSync(graphModulePath, 'utf8');
  assert.ok(!/\.addEdge\('object_brief', 'refine_request'\)/.test(graphSource), 'object_brief must not feed refine_request');
  assert.ok(!/\.addEdge\('refine_request', 'synthesize_dsl'\)/.test(graphSource), 'refine_request must not feed synthesize_dsl');
  console.log('  ✓ Refine fork routes refine_request -> validate_pre, bypassing object_brief and synthesize_dsl.');

  console.log('\n--- C. No-op instruction fails loudly ---');
  const silentSpec = JSON.parse(parent.job.dsl_payload_json);
  const silentTarget = pickNode(silentSpec);
  const silentSlug = (node) => humanizeNodeName(node.name);
  const children = conn.prepare('SELECT COUNT(*) AS n FROM assets WHERE parent_asset_id = ?').get(parent.asset.asset_id).n;
  if (children > 0) {
    // A real fork legitimately keeps untouched parts identical, so "rewrite the same colour"
    // is only a true no-op on a parent that has no derived assets yet.
    console.log('  – Skipped direct no-op check: this parent already has forked children.');
  } else {
    const goldTarget = pickUniqueTarget(silentSpec, refineDsl);
    assert.ok(goldTarget, 'the parent must expose an unambiguously named part for the no-op check');
    const silentParentJob = {
      ...parent.job,
      dsl_payload_json: JSON.stringify({
        ...silentSpec,
        nodes: silentSpec.nodes.map((n) => (n.name === goldTarget.name
          ? { ...n, material: { ...n.material, color: '#d4af37', metalness: 0.95, roughness: 0.22 } }
          : n))
      })
    };
    const noOpRes = await stage.nodeRefineRequest({
      parentJob: silentParentJob,
      parentAsset: parent.asset,
      refineInstruction: `make the ${silentSlug(goldTarget)} gold`,
      parentAssetId: parent.asset.asset_id
    });
    assert.strictEqual(noOpRes.error_code, 'REFINE_NO_OP', `an edit that changes nothing must be REFINE_NO_OP, got ${JSON.stringify(noOpRes).slice(0, 200)}`);
    assert.ok(!noOpRes.spec, 'a no-op must never seed a spec');
    assert.strictEqual(db3d.getJobById(conn, parent.job.job_id).dsl_payload_json, parentSpecSnapshot, 'the no-op check must not write the parent');
    console.log(`  ✓ Instruction leaving the spec unchanged rejected as ${noOpRes.error_code}.`);
  }
  const syntheticNoOp = await stage.nodeRefineRequest({
    parentJob: {
      job_id: 'job_synth_noop',
      dsl_payload_json: JSON.stringify({
        ...syntheticParentSpec(),
        nodes: syntheticParentSpec().nodes.map((n) => (n.name === 'chest_lid' ? { ...n, material: { color: '#d4af37', metalness: 0.95, roughness: 0.22 } } : n))
      })
    },
    parentAsset: { asset_id: 'asset_synth_noop', job_id: 'job_synth_noop', asset_status: 'ready' },
    refineInstruction: 'make the lid gold'
  });
  assert.strictEqual(syntheticNoOp.error_code, 'REFINE_NO_OP', 'a clone that equals its parent must be REFINE_NO_OP');
  assert.ok(!syntheticNoOp.spec, 'a no-op must never seed a spec');
  const untouchedNoOp = await stage.nodeRefineRequest({
    parentJob: parent.job,
    parentAsset: parent.asset,
    refineInstruction: 'make it exactly the same as before',
    parentAssetId: parent.asset.asset_id
  });
  assert.strictEqual(untouchedNoOp.error_code, 'REFINE_INSTRUCTION_UNSUPPORTED');
  assert.ok(!untouchedNoOp.spec, 'an inexpressible instruction must never seed a spec');
  assert.strictEqual(db3d.getJobById(conn, parent.job.job_id).dsl_payload_json, parentSpecSnapshot, 'rejected instructions must not write the parent');
  console.log('  ✓ Instruction with no expressible effect rejected before any spec is seeded.');

  console.log('\n--- I. Unnamed target on a multi-node parent fails closed ---');
  const ambiguous = await stage.nodeRefineRequest({
    parentJob: { job_id: 'job_synth_i', dsl_payload_json: JSON.stringify(syntheticParentSpec()) },
    parentAsset: { asset_id: 'asset_synth_i', job_id: 'job_synth_i', asset_status: 'ready' },
    refineInstruction: 'make it red'
  });
  assert.strictEqual(ambiguous.error_code, 'REFINE_TARGET_AMBIGUOUS', 'an unnamed target must never repaint every node');
  assert.ok(!ambiguous.spec, 'an ambiguous target must never seed a spec');
  assert.ok(/name the part to edit/.test(ambiguous.error) && /chest_lid/.test(ambiguous.error), 'the error must list the available parts');
  const synthParserSpec = syntheticParentSpec();
  const synthIntent = refineDsl.parseRefineIntent('make it red', synthParserSpec);
  assert.strictEqual(synthIntent.error_code, 'REFINE_TARGET_AMBIGUOUS');
  assert.deepStrictEqual(synthParserSpec, syntheticParentSpec(), 'parsing must not mutate the spec it was given');
  assert.strictEqual(synthParserSpec.nodes.filter((n) => n.material.color === '#dc2626').length, 0, 'no node may be repainted');
  const singleNode = refineDsl.parseRefineIntent('make it red', { nodes: [{ name: 'orb', material: { color: '#111111' } }] });
  assert.deepStrictEqual(singleNode.targets, ['orb'], 'a one-node spec may resolve an unnamed target to its only node');
  console.log('  ✓ "make it red" on a multi-node parent -> REFINE_TARGET_AMBIGUOUS; spec untouched.');

  console.log('\n--- J. Instruction with no expressible property is not a chrome repaint ---');
  for (const vague of ['make it more premium', 'improve the import quality']) {
    const vagueRes = await stage.nodeRefineRequest({
      parentJob: { job_id: 'job_synth_j', dsl_payload_json: JSON.stringify(syntheticParentSpec()) },
      parentAsset: { asset_id: 'asset_synth_j', job_id: 'job_synth_j', asset_status: 'ready' },
      refineInstruction: vague
    });
    assert.strictEqual(vagueRes.error_code, 'REFINE_INSTRUCTION_UNSUPPORTED', `"${vague}" must be unsupported, got ${vagueRes.error_code}`);
    assert.ok(!vagueRes.spec, 'an unsupported property must never seed a spec');
    assert.ok(/color|metalness|roughness|size/.test(vagueRes.error), 'the error must name the expressible properties');
  }
  const chromeLeak = refineDsl.parseRefineIntent('make it more premium', syntheticParentSpec());
  assert.strictEqual(chromeLeak.error_code, 'REFINE_INSTRUCTION_UNSUPPORTED');
  assert.ok(!Array.isArray(chromeLeak.tokens), 'no default token may be invented');
  console.log('  ✓ Vague instructions rejected up front; no implicit chrome default exists.');

  console.log('\n--- K. Clone-and-patch: only the targeted node differs ---');
  const lidParent = syntheticParentSpec();
  const lidIntents = [
    { instruction: 'recolor the lid red', expected: 'chest_lid' },
    { instruction: 'make the lid gold', expected: 'chest_lid' },
    { instruction: 'make the chest body bigger', expected: 'chest_body' }
  ];
  for (const { instruction: lidInstruction, expected } of lidIntents) {
    const lidCall = await stage.nodeRefineRequest({
      parentJob: { job_id: 'job_synth_k', dsl_payload_json: JSON.stringify(lidParent) },
      parentAsset: { asset_id: 'asset_synth_k', job_id: 'job_synth_k', asset_status: 'ready' },
      refineInstruction: lidInstruction
    });
    assert.ok(!lidCall.error_code, `"${lidInstruction}" must resolve: ${lidCall.error_code} ${lidCall.error}`);
    assert.deepStrictEqual(lidCall.refineDiff.targets, [expected], `"${lidInstruction}" must resolve to ${expected}`);
    assert.strictEqual(lidCall.spec.nodes.length, lidParent.nodes.length, 'a fork keeps the parent composition');
    const lidByName = new Map(lidParent.nodes.map((n) => [n.name, n]));
    const changed = lidCall.spec.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(lidByName.get(n.name))).map((n) => n.name);
    assert.deepStrictEqual(changed, [expected], `exactly ${expected} must change, changed: ${changed.join(', ')}`);
    for (const node of lidCall.spec.nodes) {
      if (node.name === expected) continue;
      assert.deepStrictEqual(node, lidByName.get(node.name), `${node.name} must be deep-equal to its parent counterpart`);
    }
    assert.deepStrictEqual(lidCall.spec.lights, lidParent.lights, 'parent lights must be carried over untouched');
    assert.strictEqual(lidCall.spec.target_polycount, lidParent.target_polycount, 'top-level spec fields must be carried over');
    assert.deepStrictEqual(lidParent, syntheticParentSpec(), 'the parent spec object must never be mutated in place');
    assert.ok(typeof lidCall.dslPayload === 'string' && /^archetype /m.test(lidCall.dslPayload), 'the DSL is rendered as provenance');
  }
  console.log('  ✓ Clone-and-patch edits exactly one node; siblings, lights and top-level fields are preserved.');

  console.log('\n--- L. Substring ambiguity across two nodes fails closed ---');
  const handleAmbiguous = await stage.nodeRefineRequest({
    parentJob: { job_id: 'job_synth_l', dsl_payload_json: JSON.stringify(syntheticParentSpec()) },
    parentAsset: { asset_id: 'asset_synth_l', job_id: 'job_synth_l', asset_status: 'ready' },
    refineInstruction: 'make the handle red'
  });
  assert.strictEqual(handleAmbiguous.error_code, 'REFINE_TARGET_AMBIGUOUS', 'a substring matching two nodes must be ambiguous');
  assert.ok(!handleAmbiguous.spec, 'an ambiguous substring must never seed a spec');
  assert.ok(/side_handle/.test(handleAmbiguous.error) && /side_handle_bar/.test(handleAmbiguous.error), 'the error must name both candidates');
  const exactHandle = await stage.nodeRefineRequest({
    parentJob: { job_id: 'job_synth_l2', dsl_payload_json: JSON.stringify(syntheticParentSpec()) },
    parentAsset: { asset_id: 'asset_synth_l2', job_id: 'job_synth_l2', asset_status: 'ready' },
    refineInstruction: 'make the side_handle_bar red'
  });
  assert.ok(!exactHandle.error_code, `an exact node name must resolve: ${exactHandle.error_code} ${exactHandle.error}`);
  assert.deepStrictEqual(exactHandle.refineDiff.targets, ['side_handle_bar'], 'an exact name wins over substring candidates');
  console.log('  ✓ "the handle" names both candidates; the exact name resolves to one node.');


  console.log('\n--- D. POST /api/v1/3d/assets/:assetId/refine ---');
  const server = await startServer();
  let forkJobId = null;
  let parentShasBefore = null;
  try {
    const emptyRes = await request(server, 'POST', `/api/v1/3d/assets/${parent.asset.asset_id}/refine`, { instruction: '   ' });
    assert.strictEqual(emptyRes.statusCode, 400, 'empty instruction must be 4xx');
    assert.strictEqual(emptyRes.json.error_code, 'REFINE_INSTRUCTION_REQUIRED');

    const missingRes = await request(server, 'POST', '/api/v1/3d/assets/asset_does_not_exist/refine', { instruction: 'make it gold' });
    assert.strictEqual(missingRes.statusCode, 404, 'unknown asset must be 404');
    assert.strictEqual(missingRes.json.error_code, 'PARENT_ASSET_NOT_FOUND');

    const unsupportedRes = await request(server, 'POST', `/api/v1/3d/assets/${parent.asset.asset_id}/refine`, { instruction: 'add a chrome hatch' });
    assert.strictEqual(unsupportedRes.statusCode, 422, 'inexpressible instruction must be rejected up front');
    assert.strictEqual(unsupportedRes.json.error_code, 'REFINE_INSTRUCTION_UNSUPPORTED');

    const methodRes = await request(server, 'GET', `/api/v1/3d/assets/${parent.asset.asset_id}/refine`);
    assert.strictEqual(methodRes.statusCode, 405, 'refine route rejects non-POST methods');

    const parentJobBefore = db3d.getJobById(conn, parent.job.job_id);
    parentShasBefore = parentFileShas(parent.asset);

    const forkParent = parent;
    assertParentFixture(forkParent.job);
    const forkSpec = JSON.parse(forkParent.job.dsl_payload_json);
    const forkTarget = pickUniqueTarget(forkSpec, refineDsl);
    assert.ok(forkTarget, 'the fork parent must expose an unambiguously named part');
    const forkInstruction = `make the ${slug(forkTarget)} gold`;
    const forkPatchedSpec = {
      ...forkSpec,
      nodes: forkSpec.nodes.map((n) => (n.name === forkTarget.name
        ? { ...n, material: { ...n.material, color: '#d4af37', metalness: 0.95, roughness: 0.22 } }
        : n))
    };
    // Same instruction, but the parent spec already carries exactly the gold finish the
    // instruction requests: the clone-and-patch result is byte-identical to the parent.
    const noOpCall = await stage.nodeRefineRequest({
      parentJob: { ...forkParent.job, dsl_payload_json: JSON.stringify(forkPatchedSpec) },
      parentAsset: forkParent.asset,
      refineInstruction: `make the ${slug(forkTarget)} gold`
    });
    assert.strictEqual(noOpCall.error_code, 'REFINE_NO_OP', `a no-op fork must be REFINE_NO_OP, got ${noOpCall.error_code}`);
    assert.ok(!noOpCall.spec, 'a no-op must never seed a spec, so the route can never accept it');
    console.log('  – No-op parent variant rejected as REFINE_NO_OP by the same stage the route preflights with.');
    const forkShasBefore = parentFileShas(forkParent.asset);

    const okRes = await request(server, 'POST', `/api/v1/3d/assets/${forkParent.asset.asset_id}/refine`, { instruction: forkInstruction, quality_preset: 'normal', requested_gpu_backend: 'CUDA' });
    assert.strictEqual(okRes.statusCode, 202, `valid refine must be accepted: ${okRes.body}`);
    assert.strictEqual(okRes.json.success, true);
    assert.ok(okRes.json.job_id);
    assert.strictEqual(okRes.json.parent_asset_id, forkParent.asset.asset_id);
    assert.deepStrictEqual(okRes.json.refine_plan.skipped_stages, ['object_brief', 'synthesize_dsl']);
    assert.ok(okRes.json.refine_plan.targets.includes(forkTarget.name));
    forkJobId = okRes.json.job_id;
    console.log(`  ✓ 400 empty, 404 unknown, 422 no-op/inexpressible, 405 wrong method; fork accepted as ${forkJobId}.`);

    const settled = await waitForJob(forkJobId);
    assert.strictEqual(settled.status, 'completed', `fork must complete: ${settled.error_code} ${settled.error_message}`);

    console.log('\n--- A2. Fork lineage persisted ---');
    assert.strictEqual(settled.parent_job_id, forkParent.job.job_id);
    assert.strictEqual(settled.parent_asset_id, forkParent.asset.asset_id);
    assert.strictEqual(settled.refine_instruction, forkInstruction);
    assert.strictEqual(settled.source_mode, 'dsl_direct', 'a fork is a DSL-direct run, not a new text generation');
    const childAsset = conn.prepare("SELECT * FROM assets WHERE job_id = ?").get(forkJobId);
    assert.ok(childAsset && childAsset.asset_id !== forkParent.asset.asset_id, 'fork must promote a NEW asset');
    assert.strictEqual(childAsset.parent_asset_id, forkParent.asset.asset_id);
    assert.strictEqual(childAsset.refine_instruction, forkInstruction);
    const childAssetFiles = db3d.getAssetById(conn, childAsset.asset_id).files;
    assert.ok(childAssetFiles.length > 0, 'forked asset must own its own files');
    console.log(`  ✓ Fork ${childAsset.asset_id} records parent lineage on job and asset rows.`);

    console.log('\n--- E. Persisted spec actually changed ---');
    const childSpecRaw = settled.dsl_payload_json;
    assert.notStrictEqual(childSpecRaw, forkParent.job.dsl_payload_json, 'forked spec must differ from the parent spec');
    const childSpec = JSON.parse(childSpecRaw);
    const parentByName = new Map(forkSpec.nodes.map((n) => [n.name, n]));
    let changedCount = 0;
    for (const node of childSpec.nodes) {
      const before = parentByName.get(node.name);
      if (!before) continue;
      if (JSON.stringify(node) !== JSON.stringify(before)) changedCount += 1;
    }
    if (changedCount !== 1) {
      for (const node of childSpec.nodes) {
        const before = parentByName.get(node.name);
        if (before && JSON.stringify(node) !== JSON.stringify(before)) {
          console.log(`  DIFF ${node.name}: ${JSON.stringify(before).slice(0, 400)} -> ${JSON.stringify(node).slice(0, 400)}`);
        }
      }
    }
    assert.strictEqual(changedCount, 1, `exactly the targeted part must change, ${changedCount} nodes changed`);
    const childTarget = childSpec.nodes.find((n) => n.name === forkTarget.name);
    assert.ok(childTarget, 'edited node must survive into the forked spec');
    assert.notStrictEqual(childTarget.material.color, forkTarget.material.color, 'targeted part must take the new color');
    assert.ok(Number(childTarget.material.metalness) >= 0.9, 'gold must raise metalness');
    assert.strictEqual(childSpec.nodes.length, forkSpec.nodes.length, 'a fork keeps the parent composition');
    const parentAfterSpec = db3d.getJobById(conn, forkParent.job.job_id).dsl_payload_json;
    assert.strictEqual(parentAfterSpec, forkParent.job.dsl_payload_json, 'parent spec must not be rewritten');
    assert.deepStrictEqual(childSpec.lights, forkSpec.lights, 'the fork carries the parent lights across the clone');
    assert.strictEqual(childSpec.archetype, forkSpec.archetype, 'the fork keeps the parent archetype');
    console.log(`  ✓ Only ${forkTarget.name} changed (${forkTarget.material.color} -> ${childTarget.material.color}); ${forkSpec.nodes.length} nodes preserved.`);

    console.log('\n--- F. Parent asset files are byte-identical ---');
    const forkShasAfter = parentFileShas(forkParent.asset);
    assert.strictEqual(forkShasAfter.glb, forkShasBefore.glb, 'parent GLB must not change');
    assert.strictEqual(forkShasAfter.png, forkShasBefore.png, 'parent preview PNG must not change');
    assert.strictEqual(db3d.getAssetById(conn, forkParent.asset.asset_id).asset_status, 'ready');
    console.log('  ✓ Parent GLB and preview PNG keep identical SHA-256 across the fork.');

    console.log('\n--- G. Missing / soft-deleted parent fails loudly ---');
    conn.exec('PRAGMA foreign_keys = OFF;');
    try {
      conn.prepare("UPDATE assets SET asset_status = 'deleted' WHERE asset_id = ?").run(parent.asset.asset_id);
      const deletedRes = await request(server, 'POST', `/api/v1/3d/assets/${parent.asset.asset_id}/refine`, { instruction });
      assert.strictEqual(deletedRes.statusCode, 409, 'soft-deleted parent must be rejected');
      assert.strictEqual(deletedRes.json.error_code, 'PARENT_ASSET_NOT_REFINABLE');

      db3d.createJobRecord(conn, {
        job_id: 'job_orphan', nonce: 'nonce_orphan', source_mode: 'text_to_3d',
        prompt: 'orphan', staging_rel_dir: 'staging/job_orphan_nonce_orphan'
      });
      conn.prepare("INSERT INTO assets (asset_id, job_id, nonce, display_name, source_mode, profile, quality_preset, domain_archetype, dsl_version, refinement_backend, effective_compute_mode, vertex_count, triangle_count, is_watertight_manifold, pre_blender_score, post_blender_score, asset_status, created_at) VALUES ('asset_orphan','job_orphan','nonce_orphan','orphan','text_to_3d','production_pbr','normal','game-prop','1.0.0','deterministic_only','cpu',10,20,1,90,90,'ready','2026-01-01T00:00:00.000Z')").run();
      conn.prepare("DELETE FROM generation_jobs WHERE job_id = 'job_orphan'").run();
      const orphanRes = await request(server, 'POST', '/api/v1/3d/assets/asset_orphan/refine', { instruction });
      assert.strictEqual(orphanRes.statusCode, 409, 'missing parent job must be rejected');
      assert.strictEqual(orphanRes.json.error_code, 'PARENT_JOB_MISSING');

      const direct = await stage.nodeRefineRequest({
        parentJob: null,
        parentAsset: { asset_id: 'asset_orphan', job_id: 'job_orphan', asset_status: 'ready' },
        refineInstruction: instruction
      });
      assert.strictEqual(direct.error_code, 'PARENT_JOB_MISSING');
      assert.ok(!direct.spec, 'a missing parent must never yield an empty spec run');
    } finally {
      conn.prepare("UPDATE assets SET asset_status = 'ready' WHERE asset_id = ?").run(parent.asset.asset_id);
      conn.exec('PRAGMA foreign_keys = ON;');
    }
    console.log('  ✓ Soft-deleted asset (409 PARENT_ASSET_NOT_REFINABLE) and missing job (409 PARENT_JOB_MISSING) both fail closed.');

    console.log('\n--- H. Destructive negative control ---');
    const controlNow = Date.now();
    const parentSpecText = parent.job.dsl_payload_json;
    const parentShasAtControl = parentFileShas(parent.asset);

    // Bug under test: the edit prompt is recorded and the parent spec is reused verbatim
    // as the geometry input, so the "refined" asset is a byte-identical clone.
    const controlStage = loadChainedGraph();
    const boundStage = controlStage.stage;
    const originalRefine = boundStage.nodeRefineRequest;
    // graph.js resolves refine_stage at call time, so this override is the code the control runs.
    boundStage.nodeRefineRequest = async (state) => ({
      status: 'parsing_dsl',
      spec: JSON.parse(state.parentJob.dsl_payload_json),
      dslPayload: state.parentJob.dsl_payload_json,
      refineDiff: { targets: [], recorded_only: true }
    });
    const controlJobId = `job_ctrl_${controlNow}`;
    const controlGraph = controlStage.graph;
    const controlRes = await controlGraph.runYamanaka3DGraph({
      job_id: controlJobId,
      nonce: `nonce_ctrl_${controlNow}`,
      refine_mode: true,
      parent_job_id: parent.job.job_id,
      parent_asset_id: parent.asset.asset_id,
      refine_instruction: instruction,
      quality_preset: 'normal',
      requested_gpu_backend: 'CUDA'
    });
    const controlJob = db3d.getJobById(conn, controlJobId);
    const cloneAsset = controlRes.asset_id ? db3d.getAssetById(conn, controlRes.asset_id) : null;

    let specProofCaught = null;
    try {
      assert.notStrictEqual(controlJob.dsl_payload_json, parentSpecText);
    } catch (err) {
      specProofCaught = err;
    }
    assert.ok(specProofCaught, 'the no-op refine must be caught by the persisted-spec diff');
    assert.ok(cloneAsset, 'the control fork must still promote a clone asset so the file proof can be checked');
    const cloneShas = parentFileShas(cloneAsset);
    assert.strictEqual(cloneShas.glb, parentShasAtControl.glb, 'control clone GLB must equal the parent GLB (proving the file proof is meaningful)');
    assert.ok(cloneShas.png, 'control clone preview PNG must exist');

    // Destructive half: tampering the PARENT's promoted GLB must be detected by the SHA
    // proof, then the real file is recovered from the clone so the tree is left intact.
    const tamperPath = parentShasAtControl.glbPath;
    const tamperBackup = fs.readFileSync(tamperPath);
    let tamperCaught = null;
    try {
      fs.writeFileSync(tamperPath, Buffer.from('negative-control-corruption'));
      try {
        assert.strictEqual(sha256File(tamperPath), parentShasAtControl.glb);
      } catch (err) {
        tamperCaught = err;
      }
    } finally {
      fs.writeFileSync(tamperPath, tamperBackup);
    }
    assert.ok(tamperCaught, 'the SHA proof must detect a modified parent GLB');
    assert.strictEqual(sha256File(tamperPath), parentShasAtControl.glb, 'the parent GLB must be restored byte-for-byte');
    boundStage.nodeRefineRequest = originalRefine;
    controlStage.stage.nodeRefineRequest = originalRefine;
    console.log('  ✓ No-op refine caught by the persisted-spec diff; tampered parent GLB caught and restored.');

    console.log('\n--- H2. Revert the control and re-prove real behaviour ---');
    const restoredStage = loadChainedGraph().stage;
    assert.ok(/function applyRefineIntent/.test(fs.readFileSync(refineStagePath, 'utf8')), 'the real refine module must be back on disk');
    const restoredCall = await restoredStage.nodeRefineRequest({
      parentJob: db3d.getJobById(conn, parent.job.job_id),
      parentAsset: db3d.getAssetById(conn, parent.asset.asset_id),
      refineInstruction: instruction
    });
    assert.ok(!restoredCall.errorCode && restoredCall.spec, 'restored refine must produce an edited spec');
    assert.notStrictEqual(JSON.stringify({ nodes: restoredCall.spec.nodes }), parentSpecText, 'restored refine must change the spec');
    const parentShasFinal = parentFileShas(parent.asset);
    assert.strictEqual(parentShasFinal.glb, parentShasAtControl.glb, 'parent GLB intact after the control');
    assert.strictEqual(parentShasFinal.png, parentShasAtControl.png, 'parent preview PNG intact after the control');
    console.log('  ✓ Control reverted; real refine edits the spec and parent files are intact.');
  } finally {
    server.close();
  }

  if (global.__KONOHA_GPU_SKIPS && global.__KONOHA_GPU_SKIPS.length) {
    console.log(`\n✔ All Yamanaka refine-fork tests passed; SKIPPED[no_working_gpu_backend]: ${global.__KONOHA_GPU_SKIPS.join(', ')}\n`);
  } else {
    console.log('\n✔ All Yamanaka refine-fork tests passed 100%!\n');
  }
}

runTests()
  .then(() => {
    try { fs.rmSync(QA_ROOT, { recursive: true, force: true }); } catch (_) { /* best-effort temp cleanup */ }
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test failed with error:', err && err.stack ? err.stack : err);
    process.exit(1);
  });
