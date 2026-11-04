'use strict';

/**
 * Headless 3D Asset Preview Renderer using Playwright and Three.js r187.
 * Renders high-fidelity 512x512 preview PNG thumbnails of exported GLB models.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function validatePngHeader(buffer) {
  if (!buffer || buffer.length < 8) return false;
  return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}

async function renderPreview(glbPath, outDir, name, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  if (!glbPath || !fs.existsSync(glbPath)) {
    return { previewPath: null, error: 'GLB file does not exist' };
  }

  let server = null;
  let browser = null;

  try {
    const { chromium } = require('playwright');
    const threeDir = path.dirname(path.dirname(require.resolve('three')));

    server = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head>
<style>body { margin:0; background:#eef2f7; overflow:hidden; }</style>
<script type="importmap">
{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }
</script>
</head>
<body>
<canvas id="c" width="512" height="512" style="width:512px;height:512px;"></canvas>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(512, 512);
renderer.setClearColor(0xeef2f7, 1.0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(2.5, 2.0, 3.2);
camera.lookAt(0, 0.5, 0);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
if ('environmentIntensity' in scene) scene.environmentIntensity = 0.5;

scene.add(new THREE.HemisphereLight(0xffffff, 0xd7dde5, 0.45));
const dir1 = new THREE.DirectionalLight(0xffffff, 2.4);
dir1.position.set(4, 8, 6);
scene.add(dir1);

const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
dir2.position.set(-5, 4, -5);
scene.add(dir2);
const loader = new GLTFLoader();
loader.load('/model.glb', (gltf) => {
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitDistance = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.35;
  const viewDir = new THREE.Vector3(0.62, 0.48, 0.78).normalize();
  camera.position.copy(center).addScaledVector(viewDir, fitDistance);
  camera.near = Math.max(fitDistance / 200, 0.01);
  camera.far = fitDistance * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(center);
  for (const light of [dir1, dir2]) {
    light.position.copy(center).addScaledVector(
      light.position.clone().sub(center).normalize(), maxDim * 3 + 2
    );
    light.target.position.copy(center);
    if (!light.target.parent) scene.add(light.target);
  }
  renderer.render(scene, camera);
  window.__READY__ = true;
}, undefined, (e) => {
  window.__ERROR__ = e.message;
});
</script>
</body>
</html>`);
        return;
      }
      if (req.url === '/model.glb') {
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
        res.end(fs.readFileSync(glbPath));
        return;
      }
      if (req.url.startsWith('/three/')) {
        const relPath = req.url.slice('/three/'.length);
        const filePath = path.join(threeDir, relPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--no-sandbox']
    });

    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__READY__ || window.__ERROR__, { timeout: timeoutMs });

    const error = await page.evaluate(() => window.__ERROR__);
    if (error) {
      throw new Error(`WebGL GLTFLoader client error: ${error}`);
    }

    const pngBuf = await page.locator('#c').screenshot();
    if (!validatePngHeader(pngBuf)) {
      throw new Error('Screenshot did not produce valid PNG magic bytes');
    }

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const previewPath = path.join(outDir, `${name}.preview.png`);
    fs.writeFileSync(previewPath, pngBuf);

    return {
      previewPath,
      bytes: pngBuf.length
    };
  } catch (err) {
    process.stderr.write(`[preview_renderer] Preview generation notice: ${err.message}. Proceeding without thumbnail.\n`);
    return {
      previewPath: null,
      error: err.message
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) { /* best-effort fallback: ignored by design */ }
    }
    if (server) {
      try { server.close(); } catch (_) { /* best-effort fallback: ignored by design */ }
    }
  }
}

module.exports = {
  renderPreview,
  validatePngHeader
};
