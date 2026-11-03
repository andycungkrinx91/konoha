'use strict';

/**
 * Headless Three.js Multi-Format Exporter.
 * Supports GLB, GLTF, OBJ, STL, and PLY with binary glTF 2.0 header validation.
 */

const fs = require('fs');
const path = require('path');
const { ensureHeadlessShim } = require('./headless_shim');
const depLoader = require('./dep_loader');

async function getGLTFExporter() {
  ensureHeadlessShim();
  try {
    const mod = await import('three/addons/exporters/GLTFExporter.js');
    return mod.GLTFExporter;
  } catch {
    const mod = depLoader.loadAddon('exporters/GLTFExporter.js');
    return mod.GLTFExporter;
  }
}

function validateGlbHeader(buffer) {
  if (!buffer || buffer.byteLength < 20) {
    throw new Error(`Invalid GLB file size: ${buffer ? buffer.byteLength : 0} bytes (expected >= 20)`);
  }

  const magic = buffer.toString('utf8', 0, 4);
  if (magic !== 'glTF') {
    throw new Error(`Invalid GLB magic bytes: expected 'glTF', got '${magic}'`);
  }

  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported glTF binary version: expected 2, got ${version}`);
  }

  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.byteLength) {
    throw new Error(`GLB header length mismatch: header declared ${declaredLength}, actual is ${buffer.byteLength}`);
  }

  return { magic, version, length: declaredLength };
}

async function exportScene(scene, outputPath, options = {}) {
  const GLTFExporter = await getGLTFExporter();
  const exporter = new GLTFExporter();
  const isBinary = options.binary !== false && (options.format !== 'gltf');

  const exportOpts = {
    binary: isBinary,
    embedImages: true,
    animations: options.animations || [],
    onlyVisible: true
  };

  const rawResult = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result),
      (err) => reject(err),
      exportOpts
    );
  });

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let finalBuffer;
  if (isBinary) {
    if (rawResult instanceof ArrayBuffer) {
      finalBuffer = Buffer.from(rawResult);
    } else if (Buffer.isBuffer(rawResult)) {
      finalBuffer = rawResult;
    } else {
      throw new Error(`Unexpected GLTFExporter binary result type: ${typeof rawResult}`);
    }

    validateGlbHeader(finalBuffer);
    fs.writeFileSync(outputPath, finalBuffer);
  } else {
    const jsonStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
    finalBuffer = Buffer.from(jsonStr, 'utf8');
    fs.writeFileSync(outputPath, finalBuffer);
  }

  return {
    bytes: finalBuffer.byteLength,
    outputPath,
    format: isBinary ? 'glb' : 'gltf',
    headerValid: isBinary,
    buffer: finalBuffer
  };
}

async function exportFormats(scene, outDir, name, requestedFormats = ['glb'], options = {}) {
  ensureHeadlessShim();
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const formats = Array.isArray(requestedFormats) && requestedFormats.length > 0
    ? requestedFormats.map(f => String(f).toLowerCase().trim())
    : ['glb'];

  const results = {};

  // Always produce primary GLB
  const glbPath = path.join(outDir, `${name}.glb`);
  const glbRes = await exportScene(scene, glbPath, { ...options, binary: true });
  results.glb = glbRes.outputPath;

  for (const fmt of formats) {
    if (fmt === 'gltf' && !results.gltf) {
      const gltfPath = path.join(outDir, `${name}.gltf`);
      const gltfRes = await exportScene(scene, gltfPath, { ...options, binary: false, format: 'gltf' });
      results.gltf = gltfRes.outputPath;
    } else if (fmt === 'obj' && !results.obj) {
      try {
        const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
        const objText = new OBJExporter().parse(scene);
        const objPath = path.join(outDir, `${name}.obj`);
        fs.writeFileSync(objPath, objText, 'utf8');
        results.obj = objPath;
      } catch (err) {
        process.stderr.write(`[exporter] OBJ export error: ${err.message}\n`);
      }
    } else if (fmt === 'stl' && !results.stl) {
      try {
        const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
        const stlData = new STLExporter().parse(scene, { binary: true });
        const stlPath = path.join(outDir, `${name}.stl`);
        const buf = stlData.buffer ? Buffer.from(stlData.buffer, stlData.byteOffset, stlData.byteLength) : Buffer.from(stlData);
        fs.writeFileSync(stlPath, buf);
        results.stl = stlPath;
      } catch (err) {
        process.stderr.write(`[exporter] STL export error: ${err.message}\n`);
      }
    } else if (fmt === 'ply' && !results.ply) {
      try {
        const { PLYExporter } = await import('three/addons/exporters/PLYExporter.js');
        const plyData = await new Promise(resolve => {
          new PLYExporter().parse(scene, (res) => resolve(res), { binary: true });
        });
        const plyPath = path.join(outDir, `${name}.ply`);
        const buf = plyData instanceof ArrayBuffer ? Buffer.from(plyData) : (Buffer.isBuffer(plyData) ? plyData : Buffer.from(plyData));
        fs.writeFileSync(plyPath, buf);
        results.ply = plyPath;
      } catch (err) {
        process.stderr.write(`[exporter] PLY export error: ${err.message}\n`);
      }
    }
  }

  return results;
}

module.exports = {
  validateGlbHeader,
  exportScene,
  exportFormats
};
