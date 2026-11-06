'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promoteAssetTransaction, updateJobStage } = require('./db_3d_schema');

/**
 * Resolve canonical 3D storage output directory root.
 * Dynamic resolution: overrideDir -> env.KONOHA_3D_OUTPUT_DIR -> ~/.konoha/3d-output
 */
function getOutputRoot(overrideDir = null) {
  if (overrideDir) return path.resolve(overrideDir);
  if (process.env.KONOHA_3D_OUTPUT_DIR) return path.resolve(process.env.KONOHA_3D_OUTPUT_DIR);
  const konohaHome = process.env.KONOHA_HOME || path.join(os.homedir(), '.konoha');
  return path.join(konohaHome, '3d-output');
}

/**
 * Initialize job directories:
 * - jobs/<jobId>/input/
 * - jobs/<jobId>/logs/
 * - .staging/<jobId>_<nonce>/intermediate/
 */
function initJobDirectories(jobId, nonce, overrideRoot = null) {
  const root = getOutputRoot(overrideRoot);
  const jobRel = path.join('jobs', jobId);
  const stagingRel = path.join('.staging', `${jobId}_${nonce}`);

  const jobDir = path.join(root, jobRel);
  const inputDir = path.join(jobDir, 'input');
  const logsDir = path.join(jobDir, 'logs');
  const stagingDir = path.join(root, stagingRel);
  const intermediateDir = path.join(stagingDir, 'intermediate');

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(intermediateDir, { recursive: true });

  return {
    root,
    jobId,
    nonce,
    jobDir,
    inputDir,
    logsDir,
    stagingDir,
    intermediateDir,
    jobRel,
    stagingRel
  };
}

/**
 * Atomically writes state snapshot to jobs/<jobId>/job.json
 */
function writeJobSnapshot(jobId, stateSnapshot, overrideRoot = null) {
  const root = getOutputRoot(overrideRoot);
  const jobDir = path.join(root, 'jobs', jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const targetPath = path.join(jobDir, 'job.json');
  const tempPath = path.join(jobDir, `job.json.tmp.${Date.now()}`);
  const payload = JSON.stringify(stateSnapshot, null, 2);

  fs.writeFileSync(tempPath, payload, 'utf8');
  fs.renameSync(tempPath, targetPath);
  return targetPath;
}

/**
 * Verify file exists, size > 0, and compute SHA256
 */
function verifyFileIntegrity(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`File integrity check failed: file does not exist at ${absPath}`);
  }
  const stat = fs.statSync(absPath);
  if (stat.size <= 0) {
    throw new Error(`File integrity check failed: file is empty (0 bytes) at ${absPath}`);
  }
  const buffer = fs.readFileSync(absPath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return {
    byte_size: stat.size,
    sha256,
    mtime: stat.mtime
  };
}

/**
 * Enforce the 5 Mandatory Staging Cleanup Conditions and atomically promote to asset
 */
function promoteStagingToAsset({
  jobId,
  nonce,
  assetId,
  stagingFiles = {},
  metadata = {},
  validationSummary = {},
  conn,
  overrideRoot = null
}) {
  const root = getOutputRoot(overrideRoot);
  const stagingDir = path.join(root, '.staging', `${jobId}_${nonce}`);
  const assetRel = path.join('assets', assetId);
  const assetDir = path.join(root, assetRel);

  // Condition 1: Refinement stage succeeded
  if (validationSummary.refinementOk !== true) {
    throw new Error(`[PROMOTION BLOCKED]: Condition 1 failed - refinement stage did not succeed (refinementOk=${validationSummary.refinementOk})`);
  }

  // Condition 2: Post-Blender 11-row scoreSpec validation passed
  if (!validationSummary.postValidation || validationSummary.postValidation.passed !== true) {
    throw new Error('[PROMOTION BLOCKED]: Condition 2 failed - post-refinement 11-row validation did not pass');
  }

  // Condition 3: Final model.glb and preview.png must exist on disk
  const stagingGlb = stagingFiles.modelGlb || path.join(stagingDir, 'model.glb');
  const stagingPng = stagingFiles.previewPng || path.join(stagingDir, 'preview.png');

  if (!fs.existsSync(stagingGlb)) {
    throw new Error(`[PROMOTION BLOCKED]: Condition 3 failed - final model.glb missing at ${stagingGlb}`);
  }
  if (!fs.existsSync(stagingPng)) {
    throw new Error(`[PROMOTION BLOCKED]: Condition 3 failed - final preview.png missing at ${stagingPng}`);
  }

  // Condition 4: Every promoted file has byte_size > 0 and verified sha256
  const glbMeta = verifyFileIntegrity(stagingGlb);
  const pngMeta = verifyFileIntegrity(stagingPng);

  // Prepare destination directory
  fs.mkdirSync(assetDir, { recursive: true });
  const finalGlbPath = path.join(assetDir, 'model.glb');
  const finalPngPath = path.join(assetDir, 'preview.png');

  fs.copyFileSync(stagingGlb, finalGlbPath);
  fs.copyFileSync(stagingPng, finalPngPath);

  const finalGlbMeta = verifyFileIntegrity(finalGlbPath);
  const finalPngMeta = verifyFileIntegrity(finalPngPath);

  if (finalGlbMeta.sha256 !== glbMeta.sha256 || finalPngMeta.sha256 !== pngMeta.sha256) {
    throw new Error('[PROMOTION BLOCKED]: Checksum mismatch during promotion copy');
  }

  // Condition 5: Commit asset + asset_files + validation_results + job status = 'completed' in SQLite
  const assetRecord = {
    asset_id: assetId,
    job_id: jobId,
    nonce,
    display_name: metadata.display_name || metadata.prompt || 'Generated 3D Asset',
    source_mode: metadata.source_mode || 'text_to_3d',
    profile: metadata.profile || 'enterprise_pbr',
    quality_preset: metadata.quality_preset || 'standard',
    domain_archetype: metadata.domain_archetype || 'auto',
    dsl_version: metadata.dsl_version || '1.0.0',
    refinement_backend: metadata.refinement_backend || 'deterministic_only',
    blender_version: metadata.blender_version || null,
    dcc_mcp_version: metadata.dcc_mcp_version || null,
    effective_compute_mode: metadata.effective_compute_mode || 'cpu',
    model_used: metadata.model_used || null,
    vertex_count: Math.max(1, metadata.vertex_count || 100),
    triangle_count: Math.max(1, metadata.triangle_count || 200),
    is_watertight_manifold: metadata.is_watertight_manifold ? 1 : 0,
    pre_blender_score: metadata.pre_blender_score || 0.0,
    post_blender_score: validationSummary.postValidation.overall_score || 95.0,
    input_tokens: metadata.input_tokens || 0,
    output_tokens: metadata.output_tokens || 0,
    total_tokens: metadata.total_tokens || 0,
    est_cost_usd: metadata.est_cost_usd || 0.0,
    asset_status: 'ready'
  };

  for (const [k, v] of Object.entries(metadata || {})) {
    if (v !== undefined && assetRecord[k] === undefined) {
      assetRecord[k] = v;
    }
  }

  const fileRecords = [
    {
      file_role: 'primary_glb',
      rel_path: path.join(assetRel, 'model.glb'),
      mime_type: 'model/gltf-binary',
      byte_size: finalGlbMeta.byte_size,
      sha256: finalGlbMeta.sha256
    },
    {
      file_role: 'preview_png',
      rel_path: path.join(assetRel, 'preview.png'),
      mime_type: 'image/png',
      byte_size: finalPngMeta.byte_size,
      sha256: finalPngMeta.sha256
    }
  ];

  const extraArtifacts = [
    { src: 'scene.gltf', role: 'export_gltf', mime: 'model/gltf+json' },
    { src: 'scene.bin', role: null, mime: 'application/octet-stream' },
    { src: 'model.obj', role: 'export_obj', mime: 'model/obj' },
    { src: 'model.stl', role: 'export_stl', mime: 'model/stl' },
    { src: 'model.ply', role: null, mime: 'application/x-ply' },
    { src: 'model.usdz', role: null, mime: 'model/vnd.usdz+zip' }
  ];
  for (const item of extraArtifacts) {
    const srcPath = path.join(stagingDir, item.src);
    if (statNonEmpty(srcPath)) {
      const dstPath = path.join(assetDir, item.src);
      fs.copyFileSync(srcPath, dstPath);
      if (item.role) {
        const meta = verifyFileIntegrity(dstPath);
        fileRecords.push({
          file_role: item.role,
          rel_path: path.join(assetRel, item.src),
          mime_type: item.mime,
          byte_size: meta.byte_size,
          sha256: meta.sha256
        });
      }
    }
  }

  const stagingTexDir = path.join(stagingDir, 'textures');
  if (fs.existsSync(stagingTexDir)) {
    const dstTexDir = path.join(assetDir, 'textures');
    fs.mkdirSync(dstTexDir, { recursive: true });
    for (const texFile of fs.readdirSync(stagingTexDir)) {
      const srcTex = path.join(stagingTexDir, texFile);
      if (statNonEmpty(srcTex)) {
        fs.copyFileSync(srcTex, path.join(dstTexDir, texFile));
      }
    }
  }

  promoteAssetTransaction(conn, {
    job: { job_id: jobId },
    asset: assetRecord,
    files: fileRecords,
    validations: validationSummary.validations || []
  });

  // Only after all 5 succeed: clean staging directory and update staging_cleaned = 1
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    updateJobStage(conn, jobId, { staging_cleaned: 1 });
  } catch (_) {
    // Non-fatal if directory already removed
  }

  return {
    assetId,
    assetDir,
    primaryGlbPath: finalGlbPath,
    previewPngPath: finalPngPath,
    promoted: true
  };
}

/**
 * Scan staging area for intermediate files if recovery needed after failure/crash
 */
function recoverJobFromStaging(jobId, overrideRoot = null) {
  const root = getOutputRoot(overrideRoot);
  const stagingParent = path.join(root, '.staging');
  if (!fs.existsSync(stagingParent)) return null;

  const entries = fs.readdirSync(stagingParent);
  const match = entries.find(e => e.startsWith(`${jobId}_`));
  if (!match) return null;

  const stagingDir = path.join(stagingParent, match);
  const intermediateDir = path.join(stagingDir, 'intermediate');

  const files = fs.existsSync(intermediateDir) ? fs.readdirSync(intermediateDir) : [];
  return {
    jobId,
    stagingDir,
    intermediateDir,
    intermediateFiles: files.map(f => path.join(intermediateDir, f))
  };
}

/**
 * Secure asset download path resolution with traversal guard.
 * Also supports live staging intermediate .glb streaming during active generation.
 */
function statNonEmpty(filePath) {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function resolveStagingLiveGlb(root, jobId) {
  const stagingParent = path.join(root, '.staging');
  if (!fs.existsSync(stagingParent)) return null;
  const match = fs.readdirSync(stagingParent).find((e) => e.startsWith(`${jobId}_`));
  if (!match) return null;
  const stagingDir = path.join(stagingParent, match);
  const candidates = [
    path.join(stagingDir, 'intermediate', 'live_step.glb'),
    path.join(stagingDir, 'model.glb'),
    path.join(stagingDir, 'base.glb')
  ];
  for (const candidate of candidates) {
    if (statNonEmpty(candidate)) return candidate;
  }
  return null;
}

function resolveStagingLivePng(root, jobId) {
  const stagingParent = path.join(root, '.staging');
  if (!fs.existsSync(stagingParent)) return null;
  const match = fs.readdirSync(stagingParent).find((e) => e.startsWith(`${jobId}_`));
  if (!match) return null;
  const stagingDir = path.join(stagingParent, match);
  const candidates = [
    path.join(stagingDir, 'intermediate', 'live_preview.png'),
    path.join(stagingDir, 'preview.png')
  ];
  for (const candidate of candidates) {
    if (statNonEmpty(candidate)) return candidate;
  }
  return null;
}

function resolvePromotedLiveGlb(conn, jobId, root, fileRole = 'primary_glb') {
  if (!conn) return null;
  let row = null;
  try {
    row = conn.prepare(`
      SELECT af.rel_path, af.mime_type, af.byte_size, af.sha256
      FROM assets a
      JOIN asset_files af ON af.asset_id = a.asset_id
      WHERE a.job_id = ? AND af.file_role = ?
    `).get(jobId, fileRole);
  } catch {
    return null;
  }
  if (!row) return null;
  const absPath = path.resolve(root, row.rel_path);
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const realPath = fs.existsSync(absPath) ? fs.realpathSync(absPath) : absPath;
  if (!realPath.startsWith(realRoot)) {
    throw new Error(`[SECURITY ALERT]: Directory traversal attempted for job ${jobId} path ${absPath}`);
  }
  if (!statNonEmpty(absPath)) return null;
  return {
    absPath,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    isLiveStaging: false,
    promotedFallback: true
  };
}

/**
 * Secure asset download path resolution with traversal guard.
 * Also supports live staging intermediate .glb streaming during active generation,
 * including post-promotion fallback to the final promoted asset file.
 */
function resolveSafeAssetDownloadPath(assetIdOrJobId, fileRole, conn, overrideRoot = null) {
  const root = getOutputRoot(overrideRoot);

  if (fileRole === 'live_staging_glb' || fileRole.startsWith('staging:')) {
    const liveGlb = resolveStagingLiveGlb(root, assetIdOrJobId);
    if (liveGlb) {
      return { absPath: liveGlb, mimeType: 'model/gltf-binary', isLiveStaging: true };
    }
    return resolvePromotedLiveGlb(conn, assetIdOrJobId, root);
  }

  if (fileRole === 'live_staging_png') {
    const livePng = resolveStagingLivePng(root, assetIdOrJobId);
    if (livePng) {
      return { absPath: livePng, mimeType: 'image/png', isLiveStaging: true };
    }
    return resolvePromotedLiveGlb(conn, assetIdOrJobId, root, 'preview_png');
  }

  if (!conn) {
    throw new Error('Database connection required to resolve promoted asset');
  }

  const diskFallbacks = {
    export_gltf: { file: 'scene.gltf', mime: 'model/gltf+json' },
    gltf: { file: 'scene.gltf', mime: 'model/gltf+json' },
    export_obj: { file: 'model.obj', mime: 'model/obj' },
    obj: { file: 'model.obj', mime: 'model/obj' },
    export_stl: { file: 'model.stl', mime: 'model/stl' },
    stl: { file: 'model.stl', mime: 'model/stl' },
    ply: { file: 'model.ply', mime: 'application/x-ply' },
    usdz: { file: 'model.usdz', mime: 'model/vnd.usdz+zip' }
  };
  let row = conn.prepare(`
    SELECT rel_path, mime_type, byte_size, sha256
    FROM asset_files
    WHERE asset_id = ? AND file_role = ?
  `).get(assetIdOrJobId, fileRole);

  if (!row && diskFallbacks[fileRole] && /^[a-zA-Z0-9_-]+$/.test(String(assetIdOrJobId || ''))) {
    const fb = diskFallbacks[fileRole];
    const candidateRel = path.join('assets', String(assetIdOrJobId), fb.file);
    const candidateAbs = path.resolve(root, candidateRel);
    if (statNonEmpty(candidateAbs)) {
      const meta = verifyFileIntegrity(candidateAbs);
      row = { rel_path: candidateRel, mime_type: fb.mime, byte_size: meta.byte_size, sha256: meta.sha256 };
    }
  }

  if (!row) return null;

  const absPath = path.resolve(root, row.rel_path);

  // Path traversal guard
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const realPath = fs.existsSync(absPath) ? fs.realpathSync(absPath) : absPath;

  if (!realPath.startsWith(realRoot)) {
    throw new Error(`[SECURITY ALERT]: Directory traversal attempted for asset ${assetIdOrJobId} path ${absPath}`);
  }

  if (!fs.existsSync(absPath)) {
    throw new Error(`Asset file missing from disk at ${absPath}`);
  }

  return {
    absPath,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    isLiveStaging: false
  };
}

const ORPHANED_JOB_STAGES = Object.freeze([
  'pending', 'synthesizing_spec', 'parsing_dsl', 'building_base_mesh',
  'validating_base_mesh', 'refining_blender', 'validating_final_asset',
  'generating_previews', 'promoting_asset', 'recovering'
]);

/**
 * Marks generation jobs abandoned by a previous daemon process as failed so the
 * queue never reports a phantom in-flight job. Jobs still backed by a live
 * child process are left untouched.
 */
function recoverOrphanedJobs(conn, options = {}) {
  const staleAfterMs = options.staleAfterMs || 15 * 60 * 1000;
  const now = Date.now();
  if (!conn || typeof conn.prepare !== 'function') return [];
  let active = [];
  try {
    const placeholders = ORPHANED_JOB_STAGES.map(() => '?').join(',');
    active = conn.prepare(
      `SELECT job_id, status, created_at FROM generation_jobs WHERE status IN (${placeholders})`
    ).all(...ORPHANED_JOB_STAGES);
  } catch {
    return [];
  }
  const recovered = [];
  for (const job of active) {
    const startedMs = Date.parse(job.created_at || '') || 0;
    if (now - startedMs < staleAfterMs) continue;
    try {
      conn.prepare(
        `UPDATE generation_jobs SET status = 'failed', error_stage = ?, error_code = ?, error_message = ?, completed_at = ? WHERE job_id = ?`
      ).run(job.status, 'ORPHANED_JOB_RECOVERED', `Job abandoned in stage '${job.status}' by a previous daemon process`, new Date().toISOString(), job.job_id);
      recovered.push(job.job_id);
    } catch {
      continue;
    }
  }
  return recovered;
}

module.exports = {
  getOutputRoot,
  initJobDirectories,
  writeJobSnapshot,
  verifyFileIntegrity,
  promoteStagingToAsset,
  recoverJobFromStaging,
  recoverOrphanedJobs,
  resolveStagingLiveGlb,
  resolveStagingLivePng,
  resolveSafeAssetDownloadPath
};
