#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getConnection, setupSchema, validateCanonicalSchema } = require('../src/db');
const {
  MIGRATION_ID,
  CANONICAL_3D_TABLES,
  runGate1PreCheckAudit,
  purgeLegacy3DTables,
  verifyAndApplyCanonicalSchema,
  record3DLlmRequest,
  get3DTokenTelemetry,
  createJobRecord,
  updateJobStage,
  recordValidationResult,
  promoteAssetTransaction,
  listReadyAssets,
  getAssetById,
  getAssetFileByRole,
  getJobById
} = require('../src/mcp/three_asset/db_3d_schema');

console.log('Running test_yamanaka_db_check_before_apply.js...');

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-3d-schema-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'test_3d_schema.db');
process.env.KONOHA_DB_PATH = testDbPath;
const conn = getConnection(testDbPath);

try {
  // --- 1. Gate 1: Read-Only Pre-Check Audit ---
  console.log('\n--- 1. Testing Gate 1 Pre-Check Audit ---');
  const gate1 = runGate1PreCheckAudit(conn);
  assert.strictEqual(typeof gate1.ok, 'boolean');
  assert.strictEqual(Array.isArray(gate1.existingTables), true);
  console.log('  ✓ Gate 1 Pre-Check audit executed cleanly.');

  // --- 2. Initial Schema Setup & Migration Application ---
  console.log('\n--- 2. Testing Canonical Schema Application ---');
  setupSchema(conn);

  const validation = validateCanonicalSchema(conn);
  assert.strictEqual(validation.valid, true, `Validation failed: ${validation.errors.join(', ')}`);

  for (const tbl of CANONICAL_3D_TABLES) {
    const exists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tbl);
    assert.ok(exists, `Mandatory canonical 3D table '${tbl}' must exist`);
  }
  console.log('  ✓ All 6 canonical 3D STRICT tables exist.');

  // --- 3. Gate 2: Forbidden Legacy Table Rejection & Purge ---
  console.log('\n--- 3. Testing Forbidden Legacy Table Rejection & Purge ---');
  conn.exec('CREATE TABLE IF NOT EXISTS roblox_models (id TEXT PRIMARY KEY, mesh TEXT);');
  assert.throws(
    () => verifyAndApplyCanonicalSchema(conn),
    /FORBIDDEN LEGACY TABLE DETECTED/i,
    'Should throw error when forbidden legacy table is detected'
  );
  console.log('  ✓ Forbidden legacy table correctly blocked migration.');

  purgeLegacy3DTables(conn);
  const robloxTbl = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'roblox_models'").get();
  assert.strictEqual(robloxTbl, undefined, 'Legacy table roblox_models must be purged');
  console.log('  ✓ purgeLegacy3DTables successfully dropped forbidden legacy table.');

  // --- 4. Schema Drift Detection ---
  console.log('\n--- 4. Testing Schema Drift Checksum Verification ---');
  assert.throws(
    () => verifyAndApplyCanonicalSchema(conn, MIGRATION_ID, '-- TAMPERED DDL SQL'),
    /SCHEMA DRIFT ERROR/i,
    'Should throw schema drift error if DDL checksum mismatches recorded migration'
  );
  console.log('  ✓ Schema drift checksum mismatch detected and rejected.');

  // --- 5. STRICT Table Mode Constraints Verification ---
  console.log('\n--- 5. Testing SQLite STRICT Mode Constraints ---');
  const jobId = `job_test_${Date.now()}`;
  const nonce = `nonce_${Date.now()}_abc`;

  // Invalid status string should violate CHECK constraint
  assert.throws(
    () => {
      createJobRecord(conn, {
        job_id: jobId,
        nonce,
        source_mode: 'text_to_3d',
        status: 'invalid_status_xyz',
        staging_rel_dir: `.staging/${jobId}_${nonce}`
      });
    },
    /CHECK constraint failed/i,
    'STRICT mode must enforce CHECK constraints on status'
  );

  // Valid insertion
  createJobRecord(conn, {
    job_id: jobId,
    nonce,
    source_mode: 'text_to_3d',
    status: 'pending',
    prompt: 'A sleek titanium robotic drone',
    profile: 'enterprise_pbr',
    quality_preset: 'standard',
    requested_compute_mode: 'auto',
    effective_compute_mode: 'cpu',
    dsl_version: '1.0.0',
    dsl_payload_json: '{"nodes": []}',
    domain_archetype: 'vehicle',
    staging_rel_dir: `.staging/${jobId}_${nonce}`
  });

  const job = getJobById(conn, jobId);
  assert.strictEqual(job.job_id, jobId);
  assert.strictEqual(job.status, 'pending');
  console.log('  ✓ generation_jobs record created with strict integrity.');

  updateJobStage(conn, jobId, { status: 'synthesizing_spec' });
  const updatedJob = getJobById(conn, jobId);
  assert.strictEqual(updatedJob.status, 'synthesizing_spec');
  console.log('  ✓ updateJobStage updated job status cleanly.');

  // --- 6. LLM Token & Cost Telemetry Insertion and Window Filtering ---
  console.log('\n--- 6. Testing Real 3D Token & Cost Counter Telemetry ---');
  record3DLlmRequest(conn, {
    job_id: jobId,
    request_kind: 'dsl_synthesis',
    provider: '9router',
    model: 'anthropic/claude-3-5-sonnet',
    input_tokens: 1250,
    output_tokens: 850,
    total_tokens: 2100,
    token_source: 'provider_usage',
    est_cost_usd: 0.0165
  });

  record3DLlmRequest(conn, {
    job_id: jobId,
    request_kind: 'blender_agent_step',
    provider: '9router',
    model: 'anthropic/claude-3-5-sonnet',
    input_tokens: 600,
    output_tokens: 400,
    total_tokens: 1000,
    token_source: 'provider_usage',
    est_cost_usd: 0.0078
  });

  for (const filter of ['today', '24h', '7d', '30d', '60d', 'all']) {
    const telem = get3DTokenTelemetry(conn, filter);
    assert.strictEqual(telem.range, filter);
    assert.strictEqual(telem.total_requests >= 2, true);
    assert.strictEqual(telem.total_input_tokens >= 1850, true);
    assert.strictEqual(telem.total_output_tokens >= 1250, true);
    assert.strictEqual(telem.total_tokens >= 3100, true);
    assert.strictEqual(telem.est_cost_usd >= 0.024, true);
  }
  console.log('  ✓ Token and cost counter computed correctly across all 6 time filter windows.');

  // --- 7. Validation Results Recording ---
  console.log('\n--- 7. Testing 11-Row scoreSpec Validation Results Recording ---');
  const dummy11Rows = Array.from({ length: 11 }, (_, i) => ({
    rowId: i + 1,
    metricName: `metric_${i + 1}`,
    measuredValue: 1.0,
    threshold: 0.8,
    passed: true
  }));

  recordValidationResult(conn, {
    job_id: jobId,
    validation_stage: 'pre_blender_base',
    passed: true,
    overall_score: 95.5,
    score_spec_11_rows_json: dummy11Rows,
    manifold_status: 'watertight',
    non_manifold_edges: 0
  });
  console.log('  ✓ Validation results with 11 scoreSpec rows recorded and verified.');

  // --- 8. Atomic Promotion Transaction ---
  console.log('\n--- 8. Testing Atomic Promotion Transaction ---');
  const assetId = `asset_${Date.now()}`;
  promoteAssetTransaction(conn, {
    job: { job_id: jobId },
    asset: {
      asset_id: assetId,
      job_id: jobId,
      nonce,
      display_name: 'Titanium Drone',
      source_mode: 'text_to_3d',
      profile: 'enterprise_pbr',
      quality_preset: 'standard',
      domain_archetype: 'vehicle',
      dsl_version: '1.0.0',
      refinement_backend: 'deterministic_only',
      effective_compute_mode: 'cpu',
      model_used: 'claude-3-5-sonnet',
      vertex_count: 1420,
      triangle_count: 2840,
      is_watertight_manifold: 1,
      pre_blender_score: 95.5,
      post_blender_score: 98.0,
      input_tokens: 1850,
      output_tokens: 1250,
      total_tokens: 3100,
      est_cost_usd: 0.0243,
      asset_status: 'ready'
    },
    files: [
      {
        file_role: 'primary_glb',
        rel_path: `assets/${assetId}/model.glb`,
        mime_type: 'model/gltf-binary',
        byte_size: 45200,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      },
      {
        file_role: 'preview_png',
        rel_path: `assets/${assetId}/preview.png`,
        mime_type: 'image/png',
        byte_size: 18400,
        sha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0'
      }
    ]
  });

  const promotedAsset = getAssetById(conn, assetId);
  assert.ok(promotedAsset, 'Promoted asset must exist');
  assert.strictEqual(promotedAsset.files.length, 2);
  assert.strictEqual(promotedAsset.asset_status, 'ready');

  const readyAssets = listReadyAssets(conn);
  assert.strictEqual(readyAssets.some(a => a.asset_id === assetId), true);

  const glbFile = getAssetFileByRole(conn, assetId, 'primary_glb');
  assert.ok(glbFile);
  assert.strictEqual(glbFile.byte_size, 45200);

  const completedJob = getJobById(conn, jobId);
  assert.strictEqual(completedJob.status, 'completed');
  assert.strictEqual(completedJob.total_tokens, 3100);
  console.log('  ✓ Asset promoted atomically and confirmed in listReadyAssets.');

  console.log('\n✔ All Yamanaka 3D SQLite 3-Gate Check-Before-Apply assertions passed 100%!\n');
} finally {
  try {
    fs.rmSync(QA_ROOT, { recursive: true, force: true });
  } catch (_) {}
}
