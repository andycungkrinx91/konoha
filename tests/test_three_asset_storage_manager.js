#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { getConnection, setupSchema } = require('../src/db');
const { createJobRecord } = require('../src/mcp/three_asset/db_3d_schema');
const {
  getOutputRoot,
  initJobDirectories,
  writeJobSnapshot,
  verifyFileIntegrity,
  promoteStagingToAsset,
  recoverJobFromStaging,
  resolveSafeAssetDownloadPath
} = require('../src/mcp/three_asset/storage_manager');

console.log('Running test_three_asset_storage_manager.js...');

const QA_ROOT = path.join(os.tmpdir(), `konoha-qa-storage-${Date.now()}`);
fs.mkdirSync(QA_ROOT, { recursive: true });

const testDbPath = path.join(QA_ROOT, 'test_storage.db');
const testOutputDir = path.join(QA_ROOT, '3d-output');
process.env.KONOHA_DB_PATH = testDbPath;
process.env.KONOHA_3D_OUTPUT_DIR = testOutputDir;

const conn = getConnection(testDbPath);
setupSchema(conn);

try {
  // Output root resolution
  console.log('\n--- 1. Testing Output Root Resolution ---');
  const root = getOutputRoot();
  assert.strictEqual(root, path.resolve(testOutputDir));
  console.log('  ✓ getOutputRoot dynamically resolved environment path.');

  // Directory initialization
  console.log('\n--- 2. Testing Job Directories Initialization ---');
  const jobId = `job_stor_${Date.now()}`;
  const nonce = `nonce_stor_${Date.now()}`;
  const jobDirs = initJobDirectories(jobId, nonce);

  assert.strictEqual(fs.existsSync(jobDirs.inputDir), true);
  assert.strictEqual(fs.existsSync(jobDirs.logsDir), true);
  assert.strictEqual(fs.existsSync(jobDirs.intermediateDir), true);
  console.log('  ✓ initJobDirectories created input, logs, and staging intermediate dirs.');

  // Atomic state snapshot
  console.log('\n--- 3. Testing Atomic State Snapshot ---');
  const snapPath = writeJobSnapshot(jobId, { status: 'building_base_mesh', step: 2 });
  assert.strictEqual(fs.existsSync(snapPath), true);
  const snapContent = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  assert.strictEqual(snapContent.step, 2);
  console.log('  ✓ writeJobSnapshot atomically persisted job.json.');

  // File integrity verification
  console.log('\n--- 4. Testing File Integrity Verification ---');
  const testFile = path.join(jobDirs.inputDir, 'test.bin');
  fs.writeFileSync(testFile, Buffer.from('hello world 3d'));
  const meta = verifyFileIntegrity(testFile);
  assert.strictEqual(meta.byte_size, 14);
  assert.strictEqual(meta.sha256, crypto.createHash('sha256').update('hello world 3d').digest('hex'));
  console.log('  ✓ verifyFileIntegrity calculated size and sha256 accurately.');

  // Staging Promotion - Mandatory Cleanup Conditions
  console.log('\n--- 5. Testing Staging Promotion Cleanup Conditions ---');
  createJobRecord(conn, {
    job_id: jobId,
    nonce,
    source_mode: 'text_to_3d',
    status: 'pending',
    prompt: 'Space exploration rover',
    profile: 'enterprise_pbr',
    quality_preset: 'high',
    requested_compute_mode: 'auto',
    effective_compute_mode: 'cpu',
    dsl_version: '1.0.0',
    dsl_payload_json: '{}',
    domain_archetype: 'vehicle',
    staging_rel_dir: jobDirs.stagingRel
  });

  const dummyGlb = path.join(jobDirs.stagingDir, 'model.glb');
  const dummyPng = path.join(jobDirs.stagingDir, 'preview.png');
  fs.writeFileSync(dummyGlb, Buffer.from('glTF binary mock data'));
  fs.writeFileSync(dummyPng, Buffer.from('PNG mock image data'));

  // Condition 1 Failure: refinementOk != true
  assert.throws(
    () => {
      promoteStagingToAsset({
        jobId,
        nonce,
        assetId: `ast_${Date.now()}`,
        validationSummary: { refinementOk: false, postValidation: { passed: true } },
        conn
      });
    },
    /Condition 1 failed/,
    'Must fail if refinement did not succeed'
  );

  // Condition 2 Failure: postValidation.passed != true
  assert.throws(
    () => {
      promoteStagingToAsset({
        jobId,
        nonce,
        assetId: `ast_${Date.now()}`,
        validationSummary: { refinementOk: true, postValidation: { passed: false } },
        conn
      });
    },
    /Condition 2 failed/,
    'Must fail if postValidation did not pass'
  );

  // Successful promotion when all 5 conditions hold
  const assetId = `ast_success_${Date.now()}`;
  const promotionRes = promoteStagingToAsset({
    jobId,
    nonce,
    assetId,
    metadata: {
      prompt: 'Space exploration rover',
      vertex_count: 500,
      triangle_count: 1000
    },
    validationSummary: {
      refinementOk: true,
      postValidation: { passed: true, overall_score: 96.5 }
    },
    conn
  });

  assert.strictEqual(promotionRes.promoted, true);
  assert.strictEqual(fs.existsSync(promotionRes.primaryGlbPath), true);
  assert.strictEqual(fs.existsSync(promotionRes.previewPngPath), true);
  assert.strictEqual(fs.existsSync(jobDirs.stagingDir), false, 'Staging directory must be removed after successful promotion');
  console.log('  ✓ Staging files atomically promoted and staging directory cleaned.');

  // Safe download resolution and traversal guard
  console.log('\n--- 6. Testing Safe Asset Download Path Resolution ---');
  const resolved = resolveSafeAssetDownloadPath(assetId, 'primary_glb', conn);
  assert.ok(resolved);
  assert.strictEqual(resolved.absPath, promotionRes.primaryGlbPath);
  assert.strictEqual(resolved.mimeType, 'model/gltf-binary');

  // Traversal attack test
  assert.throws(
    () => {
      conn.prepare(`
        INSERT INTO asset_files (file_id, asset_id, file_role, rel_path, mime_type, byte_size, sha256, created_at)
        VALUES ('hack_file', ?, 'export_gltf', '../../../../etc/passwd', 'text/plain', 10, 'fake', datetime('now'))
      `).run(assetId);
      resolveSafeAssetDownloadPath(assetId, 'export_gltf', conn);
    },
    /Directory traversal attempted/,
    'Must reject traversal attempts outside storage root'
  );
  console.log('  ✓ Safe asset download path resolution enforces directory containment.');

  console.log('\n✔ All Yamanaka 3D storage and staging lifecycle tests passed 100%!\n');
} finally {
  try {
    fs.rmSync(QA_ROOT, { recursive: true, force: true });
  } catch (_) {}
}
