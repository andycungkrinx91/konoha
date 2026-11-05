'use strict';

/**
 * src/mcp/three_asset/image_analysis.js
 *
 * Reference-image analysis performed ONCE per job (stage 1) and reused by every
 * later iteration: foreground mask, bounding box, aspect ratio, X symmetry and
 * dominant colours. Pure code — no vision model required.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parsePngPixels } = require('./image_relief');
const { decodeRasterToPixels } = require('./raster_decoder');

const MAX_ANALYSIS_EDGE = 768;
const BG_SAMPLE_EDGE = 8;
const BG_TOLERANCE = 24;
const DOMINANT_COLOR_COUNT = 5;

/** Encode an 8-bit grayscale buffer as a PNG (colour type 0). */
function encodeGrayscalePng(width, height, gray) {
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    gray.copy(raw, y * stride + 1, y * width, (y + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, body, crcBuf]);
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

function averagePixelBlock(rgba, width, ...bounds) {
  const [x0, x1, y0, y1] = bounds;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * width + xx) * 4;
      r += rgba[i];
      g += rgba[i + 1];
      b += rgba[i + 2];
      a += rgba[i + 3];
      n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

function downsample(rgba, width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale >= 1) return { rgba, width, height };
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(outW * outH * 4);
  const blockW = width / outW;
  const blockH = height / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * blockH);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * blockH)));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * blockW);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * blockW)));
      const [r, g, b, a] = averagePixelBlock(rgba, width, x0, x1, y0, y1);
      const o = (y * outW + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { rgba: out, width: outW, height: outH };
}

function cornerBackground(rgba, width, height) {
  const edge = Math.max(1, Math.min(BG_SAMPLE_EDGE, Math.floor(Math.min(width, height) / 4)));
  const corners = [
    [0, 0],
    [width - edge, 0],
    [0, height - edge],
    [width - edge, height - edge]
  ];
  const acc = [0, 0, 0];
  let n = 0;
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + edge; y++) {
      for (let x = cx; x < cx + edge; x++) {
        const i = (y * width + x) * 4;
        acc[0] += rgba[i];
        acc[1] += rgba[i + 1];
        acc[2] += rgba[i + 2];
        n++;
      }
    }
  }
  return n ? [acc[0] / n, acc[1] / n, acc[2] / n] : [255, 255, 255];
}

function buildMask(rgba, width, height, bg) {
  const gray = Buffer.alloc(width * height);
  let fg = 0;
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const alpha = rgba[p + 3];
    const delta = Math.max(
      Math.abs(rgba[p] - bg[0]),
      Math.abs(rgba[p + 1] - bg[1]),
      Math.abs(rgba[p + 2] - bg[2])
    );
    const isForeground = alpha > 16 && delta > BG_TOLERANCE;
    gray[i] = isForeground ? 255 : 0;
    if (isForeground) fg++;
  }
  return { gray, foreground: fg };
}

function maskBBox(gray, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width, height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function xSymmetry(gray, width, box) {
  let sum = 0;
  let n = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const mirror = box.x + box.width - 1 - (x - box.x);
      sum += Math.abs(gray[y * width + x] - gray[y * width + mirror]);
      n++;
    }
  }
  if (!n) return null;
  return Math.max(0, Math.min(1, 1 - sum / n / 255));
}

function toHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Deterministic k-means (k-means++ seeding, fixed iterations) over foreground pixels. */
function minCenterDistanceSq(px, centers) {
  let dmin = Infinity;
  for (const c of centers) {
    const d = (px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2;
    if (d < dmin) dmin = d;
  }
  return dmin;
}

function nearestCenterIndex(px, centers) {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centers.length; c++) {
    const d = (px[0] - centers[c][0]) ** 2 + (px[1] - centers[c][1]) ** 2 + (px[2] - centers[c][2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function dominantColors(rgba, width, height, gray, k = DOMINANT_COLOR_COUNT) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (gray[i] === 0) continue;
      const p = i * 4;
      samples.push([rgba[p], rgba[p + 1], rgba[p + 2]]);
    }
  }
  if (!samples.length) return [];

  const centers = [samples[0].slice()];
  while (centers.length < k && centers.length < samples.length) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let s = 0; s < samples.length; s++) {
      const dmin = minCenterDistanceSq(samples[s], centers);
      if (dmin > bestDist) {
        bestDist = dmin;
        bestIdx = s;
      }
    }
    centers.push(samples[bestIdx].slice());
  }

  const counts = Array.from({ length: centers.length }, () => 0);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const px of samples) {
      const best = nearestCenterIndex(px, centers);
      sums[best][0] += px[0];
      sums[best][1] += px[1];
      sums[best][2] += px[2];
      sums[best][3] += 1;
    }
    for (let c = 0; c < centers.length; c++) {
      counts[c] = sums[c][3];
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
  }
  return centers
    .map((c, i) => ({ hex: toHex(c[0], c[1], c[2]), count: counts[i] }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, k)
    .map((entry) => entry.hex);
}

/**
 * Analyse a reference image. Returns structured JSON; on any failure returns
 * `{ error, message }` instead of throwing so callers can degrade gracefully.
 */
async function analyzeReferenceImage(imagePath, options = {}) {
  const opts = options || {};
  try {
    if (!imagePath || !fs.existsSync(imagePath)) {
      return { error: 'missing_image', message: `Reference image not found: ${imagePath}` };
    }

    let decoded;
    try {
      decoded = await decodeRasterToPixels(imagePath);
    } catch (err) {
      return { error: 'decode_failed', message: err.message };
    }
    if (!decoded || !decoded.width || !decoded.height) {
      return { error: 'decode_failed', message: 'Decoder returned no pixels' };
    }

    const small = downsample(Buffer.from(decoded.rgba), decoded.width, decoded.height, MAX_ANALYSIS_EDGE);
    const { rgba, width, height } = small;
    const bg = cornerBackground(rgba, width, height);
    const { gray, foreground } = buildMask(rgba, width, height, bg);
    const bbox = maskBBox(gray, width, height);
    const aspectRatio = bbox.height > 0 ? bbox.width / bbox.height : 1;
    const symmetry = xSymmetry(gray, width, bbox);
    const colors = dominantColors(rgba, width, height, gray);

    const outDir = opts.outputDir || path.dirname(imagePath);
    const maskPath = opts.maskPath
      || path.join(outDir, `${path.basename(imagePath, path.extname(imagePath))}.mask.png`);
    try {
      fs.writeFileSync(maskPath, encodeGrayscalePng(width, height, gray));
    } catch (err) {
      return { error: 'mask_write_failed', message: err.message };
    }

    return {
      reference_mask_path: maskPath,
      mask_width: width,
      mask_height: height,
      foreground_pixel_ratio: width * height ? foreground / (width * height) : 0,
      bbox,
      aspect_ratio: Number(aspectRatio.toFixed(4)),
      height_to_width_ratio: aspectRatio > 0 ? Number((1 / aspectRatio).toFixed(4)) : 1,
      symmetry_x_score: symmetry === null ? null : Number(symmetry.toFixed(4)),
      dominant_colors: colors,
      background_rgb: bg.map((v) => Math.round(v))
    };
  } catch (err) {
    return { error: 'analysis_failed', message: err.message };
  }
}

function readMaskPng(maskPath) {
  try {
    if (!maskPath || !fs.existsSync(maskPath)) return null;
    const png = parsePngPixels(fs.readFileSync(maskPath));
    if (!png) return null;
    const gray = Buffer.alloc(png.width * png.height);
    for (let i = 0; i < png.width * png.height; i++) {
      gray[i] = png.data[i * 4];
    }
    return { width: png.width, height: png.height, gray };
  } catch {
    return null;
  }
}

module.exports = {
  analyzeReferenceImage,
  readMaskPng,
  encodeGrayscalePng,
  MAX_ANALYSIS_EDGE
};
