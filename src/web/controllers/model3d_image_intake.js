'use strict';

/**
 * Reference-image intake helpers for the 3D maker: output-size normalisation,
 * PNG encoding, magic-byte sniffing and box downsampling. Pure functions only.
 */

const zlib = require('zlib');

function _normalizeOutputSizeInput(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    ...raw,
    aspectRatio: raw.aspectRatio || raw.aspect_ratio,
    longEdge: raw.longEdge !== undefined ? raw.longEdge : raw.long_edge
  };
}

let CRC_TABLE = null;
function _getCrcTable() {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  return CRC_TABLE;
}

function _crc32Buf(buf) {
  const table = _getCrcTable();
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function _averageRgbaBlock(rgba, width, ...bounds) {
  const [x0, x1, y0, y1] = bounds;
  let r = 0, g = 0, b = 0, a = 0, n = 0;
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

function _downsampleRgba(rgba, width, height, maxEdge) {
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
      const [r, g, b, a] = _averageRgbaBlock(rgba, width, x0, x1, y0, y1);
      const o = (y * outW + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { rgba: out, width: outW, height: outH };
}

function _encodeRgbaPng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(_crc32Buf(Buffer.concat([typeBuf, body])), 0);
    return Buffer.concat([len, typeBuf, body, crcBuf]);
  };

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const IMAGE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_MAGIC = [
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], tail: [0x57, 0x45, 0x42, 0x50], tailOffset: 8 }
];

function _sniffImage(buf) {
  for (const spec of IMAGE_MAGIC) {
    if (!spec.bytes.every((b, i) => buf[i] === b)) continue;
    if (spec.tail) {
      const okTail = spec.tail.every((b, i) => buf[spec.tailOffset + i] === b);
      if (!okTail) continue;
    }
    return spec.ext;
  }
  return null;
}

module.exports = {
  IMAGE_UPLOAD_MAX_BYTES,
  normalizeOutputSizeInput: _normalizeOutputSizeInput,
  downsampleRgba: _downsampleRgba,
  encodeRgbaPng: _encodeRgbaPng,
  sniffImage: _sniffImage
};
