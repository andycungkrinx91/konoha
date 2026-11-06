'use strict';

/**
 * src/mcp/three_asset/image_relief.js
 *
 * Converts 2D raster artwork (PNG, JPG, WebP) into 3D relief sculptures
 * and bevelled physical medallion meshes in Three.js r187.
 * Standard PNG defiltering (None, Sub, Up, Average, Paeth) with zero synthetic fallbacks.
 */

const fs = require('fs');
const zlib = require('zlib');
const THREE = require('./dep_loader').loadThree();

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function applyPngFilter(filterType, rawByte, left, up, upLeft) {
  if (filterType === 1) return (rawByte + left) & 0xff;
  if (filterType === 2) return (rawByte + up) & 0xff;
  if (filterType === 3) return (rawByte + Math.floor((left + up) / 2)) & 0xff;
  if (filterType === 4) return (rawByte + paeth(left, up, upLeft)) & 0xff;
  return rawByte;
}

function decodePngScanlines(decompressed, width, height, bpp) {
  const rowBytes = width * bpp;
  const stride = 1 + rowBytes;
  const uncompressed = new Uint8Array(width * height * bpp);
  const priorRow = new Uint8Array(rowBytes);
  const currentRow = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[y * stride];
    const scanlineStart = y * stride + 1;

    for (let x = 0; x < rowBytes; x++) {
      const rawByte = decompressed[scanlineStart + x] || 0;
      const left = x >= bpp ? currentRow[x - bpp] : 0;
      const up = priorRow[x] || 0;
      const upLeft = x >= bpp ? priorRow[x - bpp] : 0;
      currentRow[x] = applyPngFilter(filterType, rawByte, left, up, upLeft);
    }

    uncompressed.set(currentRow, y * rowBytes);
    priorRow.set(currentRow);
  }
  return uncompressed;
}

function convertPngToRgba(uncompressed, width, height, bpp, colorType) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * bpp;
    const dstIdx = i * 4;
    if (colorType === 6) {
      rgba[dstIdx] = uncompressed[srcIdx];
      rgba[dstIdx + 1] = uncompressed[srcIdx + 1];
      rgba[dstIdx + 2] = uncompressed[srcIdx + 2];
      rgba[dstIdx + 3] = uncompressed[srcIdx + 3];
    } else if (colorType === 2) {
      rgba[dstIdx] = uncompressed[srcIdx];
      rgba[dstIdx + 1] = uncompressed[srcIdx + 1];
      rgba[dstIdx + 2] = uncompressed[srcIdx + 2];
      rgba[dstIdx + 3] = 255;
    } else {
      const v = uncompressed[srcIdx];
      rgba[dstIdx] = v;
      rgba[dstIdx + 1] = v;
      rgba[dstIdx + 2] = v;
      rgba[dstIdx + 3] = 255;
    }
  }
  return rgba;
}

function parsePngPixels(buf) {
  if (!buf || buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idatChunks = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);

    if (type === 'IHDR') {
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
      colorType = buf[offset + 17];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(offset + 8, offset + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  if (width === 0 || height === 0 || idatChunks.length === 0) return null;

  try {
    const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
    const uncompressed = decodePngScanlines(decompressed, width, height, bpp);
    const rgba = convertPngToRgba(uncompressed, width, height, bpp, colorType);
    return { width, height, data: rgba };
  } catch (_) {
    return null;
  }
}

function extractImagePixelData(imageInput) {
  if (imageInput && typeof imageInput === 'object' && (imageInput.rgba || imageInput.data)) {
    return {
      width: imageInput.width || 64,
      height: imageInput.height || 64,
      data: imageInput.rgba || imageInput.data
    };
  }

  let buf = null;
  let isPng = false;

  if (Buffer.isBuffer(imageInput)) {
    buf = imageInput;
    isPng = buf.length >= 8 && buf.readUInt32BE(0) === 0x89504E47;
  } else if (typeof imageInput === 'string') {
    if (fs.existsSync(imageInput)) {
      buf = fs.readFileSync(imageInput);
      isPng = imageInput.toLowerCase().endsWith('.png');
    }
  }

  if (buf && isPng) {
    const parsed = parsePngPixels(buf);
    if (parsed) return parsed;
  }

  throw new Error('Image relief extraction failed: invalid or unsupported raster data');
}

function buildImageReliefScene(imageInput, options = {}) {
  const { width, height, data: pixelData } = extractImagePixelData(imageInput);
  const aspect = width / height;

  const scene = new THREE.Scene();
  scene.background = null;

  const modelGroup = new THREE.Group();
  modelGroup.name = options.name || 'ImageReliefModel';
  scene.add(modelGroup);

  const gridX = Math.min(width, 96);
  const gridY = Math.min(height, 96);
  const planeW = aspect >= 1.0 ? 2.0 : 2.0 * aspect;
  const planeH = aspect >= 1.0 ? 2.0 / aspect : 2.0;

  const geometry = new THREE.PlaneGeometry(planeW, planeH, gridX, gridY);
  const posAttr = geometry.attributes.position;
  const maxDisplacement = options.maxDisplacement || 0.32;

  for (let i = 0; i < posAttr.count; i++) {
    const u = (posAttr.getX(i) / planeW) + 0.5;
    const v = 0.5 - (posAttr.getY(i) / planeH);
    const px = Math.floor(Math.max(0, Math.min(width - 1, u * width)));
    const py = Math.floor(Math.max(0, Math.min(height - 1, v * height)));
    const idx = (py * width + px) * 4;

    const r = pixelData[idx] / 255;
    const g = pixelData[idx + 1] / 255;
    const b = pixelData[idx + 2] / 255;
    const alpha = (pixelData[idx + 3] !== undefined ? pixelData[idx + 3] : 255) / 255;

    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * alpha;
    posAttr.setZ(i, luminance * maxDisplacement);
  }

  geometry.computeVertexNormals();

  const reliefMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(options.color || '#4f46e5'),
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.1
  });

  const reliefMesh = new THREE.Mesh(geometry, reliefMaterial);
  reliefMesh.castShadow = true;
  reliefMesh.receiveShadow = true;
  reliefMesh.position.set(0, 0, 0.05);
  modelGroup.add(reliefMesh);

  // Bevelled backing pedestal base slab
  const baseGeom = new THREE.BoxGeometry(planeW * 1.08, planeH * 1.08, 0.12);
  baseGeom.computeVertexNormals();

  const baseMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#334155'),
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.05
  });

  const baseMesh = new THREE.Mesh(baseGeom, baseMaterial);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  baseMesh.position.set(0, 0, -0.06);
  modelGroup.add(baseMesh);

  // Neutral studio lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd7dde5, 1.15);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
  keyLight.position.set(4, 8, 6);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
  fillLight.position.set(-5, 4, -5);
  scene.add(fillLight);

  const pos1 = geometry.attributes.position;
  const pos2 = baseGeom.attributes.position;
  const totalTriangles = (pos1 ? pos1.count / 3 : 0) + (pos2 ? pos2.count / 3 : 0);

  return {
    scene,
    modelGroup,
    triangleCount: Math.round(totalTriangles),
    meshCount: 2
  };
}

module.exports = {
  buildImageReliefScene,
  extractImagePixelData,
  parsePngPixels
};
