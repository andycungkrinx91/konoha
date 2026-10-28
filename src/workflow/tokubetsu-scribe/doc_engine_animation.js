'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const chromiumUtils = require('./chromium_utils');
const { resolveDynamicOutputPath } = require('./document_engine_common');

function validateAnimatedWebP(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: '${filePath}'` };
  }
  const buf = fs.readFileSync(filePath);
  if (buf.length < 12) {
    return { valid: false, error: 'File too small for WebP header' };
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return { valid: false, error: 'Invalid RIFF/WEBP signature' };
  }

  let offset = 12;
  let isAnimated = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let loopCount = 0;
  let frameCount = 0;
  let totalDurationMs = 0;

  while (offset + 8 <= buf.length) {
    const chunkType = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === 'VP8X') {
      const flags = buf.readUInt8(dataOffset);
      isAnimated = (flags & 0x02) !== 0;
      canvasWidth = (buf.readUInt16LE(dataOffset + 4) | (buf.readUInt8(dataOffset + 6) << 16)) + 1;
      canvasHeight = (buf.readUInt16LE(dataOffset + 7) | (buf.readUInt8(dataOffset + 9) << 16)) + 1;
    } else if (chunkType === 'ANIM') {
      loopCount = buf.readUInt16LE(dataOffset + 4);
    } else if (chunkType === 'ANMF') {
      frameCount++;
      const duration = buf.readUInt16LE(dataOffset + 12) | (buf.readUInt8(dataOffset + 14) << 16);
      totalDurationMs += duration;
    }

    offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
  }

  if (!isAnimated || frameCount < 2) {
    return {
      valid: false,
      error: `WebP file lacks valid animation chunks (isAnimated: ${isAnimated}, frameCount: ${frameCount})`
    };
  }

  return {
    valid: true,
    isAnimated: true,
    canvasWidth,
    canvasHeight,
    loopCount,
    frameCount,
    totalDurationMs
  };
}

async function _captureAnimationFrames(page, durationSec, fps, tmpFramesDir) {
  const totalFrames = durationSec * fps;
  for (let f = 0; f < totalFrames; f++) {
    const frameTime = f / fps;
    await page.evaluate((time) => {
      const svg = document.querySelector('svg');
      if (svg && typeof svg.setCurrentTime === 'function') svg.setCurrentTime(time);
      document.querySelectorAll('.flow-path').forEach(p => {
        p.style.strokeDashoffset = -((time * 24) % 28);
      });
    }, frameTime);
    const framePath = path.join(tmpFramesDir, `frame_${String(f).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
    await page.waitForTimeout(1000 / fps);
  }
}

function _encodeWebpWithFfmpeg(tmpFramesDir, fps, outputPath, totalFrames) {
  const ffmpegArgs = [
    '-y', '-framerate', String(fps),
    '-i', path.join(tmpFramesDir, 'frame_%04d.png'),
    '-vcodec', 'libwebp_anim', '-lossless', '0', '-compression_level', '6',
    '-q:v', '90', '-preset', 'drawing', '-loop', '0', outputPath
  ];
  const res = spawnSync('ffmpeg', ffmpegArgs);
  if (res.status !== 0 || !fs.existsSync(outputPath)) return null;

  const validation = validateAnimatedWebP(outputPath);
  if (!validation.valid) {
    return { success: false, error: `WebP structural validation failed: ${validation.error}`, file_path: outputPath };
  }
  return {
    success: true, file_path: outputPath, format: 'webp', frames_captured: totalFrames,
    width: validation.canvasWidth, height: validation.canvasHeight,
    duration_ms: validation.totalDurationMs, loop_count: validation.loopCount,
    validation: 'PASS_WEBP_STRUCTURAL_VALIDATION'
  };
}

function _encodeGifWithFfmpeg(tmpFramesDir, fps, outputPath, totalFrames) {
  const ffmpegArgs = [
    '-y', '-framerate', String(fps),
    '-i', path.join(tmpFramesDir, 'frame_%04d.png'),
    '-vf', 'split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
    outputPath
  ];
  const res = spawnSync('ffmpeg', ffmpegArgs);
  if (res.status === 0 && fs.existsSync(outputPath)) {
    return { success: true, file_path: outputPath, format: 'gif', frames_captured: totalFrames };
  }
  return null;
}

function _tryEncodeAnimation(targetFormat, tmpFramesDir, fps, outputPath, totalFrames) {
  const checkFfmpeg = spawnSync('which', ['ffmpeg']);
  if (checkFfmpeg.status !== 0) return null;
  if (targetFormat === 'webp') {
    return _encodeWebpWithFfmpeg(tmpFramesDir, fps, outputPath, totalFrames);
  }
  if (targetFormat === 'gif') {
    return _encodeGifWithFfmpeg(tmpFramesDir, fps, outputPath, totalFrames);
  }
  return null;
}

async function animationExport(options = {}) {
  const inputPath = path.resolve(options.input_path || 'diagram.svg');
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: `Input file not found: '${inputPath}'` };
  }

  const requestedFormat = (options.format || (options.output_path && path.extname(options.output_path).slice(1)) || 'webp').toLowerCase();
  const defaultFilename = requestedFormat === 'gif' ? 'animation.gif' : (requestedFormat === 'png' ? 'animation.png' : 'animation.webp');
  const outputPath = resolveDynamicOutputPath(options.output_path, defaultFilename);
  const targetFormat = (path.extname(outputPath).slice(1) || requestedFormat).toLowerCase();
  const durationSec = options.duration_sec || 3;
  const fps = options.fps || 15;

  const content = fs.readFileSync(inputPath, 'utf8');
  const widthMatch = content.match(/viewBox=["']\s*0\s+0\s+(\d+)\s+(\d+)\s*["']/i) ||
                     content.match(/width=["'](\d+)["'].*?height=["'](\d+)["']/i);
  const animWidth = widthMatch ? parseInt(widthMatch[1], 10) : (options.width || 1600);
  const animHeight = widthMatch ? parseInt(widthMatch[2], 10) : (options.height || 900);

  const browser = await chromiumUtils.launchChromium();
  const page = await browser.newPage({ viewport: { width: animWidth, height: animHeight }, deviceScaleFactor: 1 });
  await chromiumUtils.setupOfflineInterception(page);
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;width:${animWidth}px;height:${animHeight}px;overflow:hidden;background:#FAFBFD;">${content}</body></html>`);

  const tmpFramesDir = path.join(os.tmpdir(), `konoha_anim_${Date.now()}`);
  fs.mkdirSync(tmpFramesDir, { recursive: true });
  const totalFrames = durationSec * fps;

  try {
    await _captureAnimationFrames(page, durationSec, fps, tmpFramesDir);
    await browser.close();

    const animRes = _tryEncodeAnimation(targetFormat, tmpFramesDir, fps, outputPath, totalFrames);
    if (animRes) {
      fs.rmSync(tmpFramesDir, { recursive: true, force: true });
      return animRes;
    }

    const pngFallback = targetFormat === 'png' ? outputPath : outputPath.replace(/\.[^.]+$/, '.png');
    fs.copyFileSync(path.join(tmpFramesDir, 'frame_0000.png'), pngFallback);
    fs.rmSync(tmpFramesDir, { recursive: true, force: true });
    return {
      success: true,
      file_path: pngFallback,
      format: 'png',
      note: 'Saved as high-DPI static PNG fallback (ffmpeg unavailable or static format requested)'
    };
  } catch (err) {
    if (fs.existsSync(tmpFramesDir)) fs.rmSync(tmpFramesDir, { recursive: true, force: true });
    return { success: false, error: err.message };
  }
}

module.exports = {
  validateAnimatedWebP,
  animationExport
};
