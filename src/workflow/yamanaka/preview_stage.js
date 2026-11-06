'use strict';

/**
 * Preview fallback for runs that finish without Blender.
 *
 * Promotion requires a real preview.png on disk, so a deterministic mesh that cannot be
 * refined still has to produce one. The WebGL renderer already turns a GLB into a PNG, so
 * the fallback reuses it instead of adding a second rasteriser. When even that fails the
 * caller gets null and promotion blocks as before — a missing preview is never faked.
 */

const fs = require('fs');
const path = require('path');
const { renderPreview } = require('../../mcp/three_asset/preview_renderer');

const PREVIEW_NAME = 'preview';

/**
 * Renders `<stagingDir>/preview.png` from `glbPath`.
 * @returns {Promise<string|null>} absolute preview path, or null when nothing was produced.
 */
async function ensureStagingPreview(glbPath, stagingDir, options = {}) {
  if (!glbPath || !fs.existsSync(glbPath) || !stagingDir) return null;
  const target = path.join(stagingDir, `${PREVIEW_NAME}.png`);
  if (fs.existsSync(target)) return target;

  const rendered = await renderPreview(glbPath, stagingDir, PREVIEW_NAME, {
    computeMode: options.computeMode,
    timeoutMs: options.timeoutMs
  });
  if (!rendered || !rendered.previewPath) return null;
  if (rendered.previewPath === target) return target;

  // renderPreview names the file `<name>.preview.png`; promotion expects exactly preview.png.
  try {
    fs.renameSync(rendered.previewPath, target);
    return target;
  } catch (_) {
    fs.copyFileSync(rendered.previewPath, target);
    fs.unlinkSync(rendered.previewPath);
    return target;
  }
}

module.exports = { ensureStagingPreview, PREVIEW_NAME };
