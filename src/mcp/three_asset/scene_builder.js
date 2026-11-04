'use strict';

/**
 * Procedural Three.js Scene Builder from validated scene specification.
 * Supports CSG booleans via manifold-3d WASM with graceful THREE.Group fallback.
 */

const depLoader = require('./dep_loader');
const geometryQuality = require('./geometry_quality');
const SMOOTH_PRIMITIVES = new Set(['sphere', 'capsule', 'cylinder', 'torus', 'torusKnot', 'cone', 'lathe', 'tube', 'dodecahedron', 'icosahedron']);

let cachedThree = null;
let cachedManifold = null;
let manifoldInitAttempted = false;

async function getThree() {
  if (cachedThree) return cachedThree;
  try {
    cachedThree = await import('three');
  } catch {
    cachedThree = depLoader.loadThree();
  }
  return cachedThree;
}

async function getManifoldWasm() {
  if (manifoldInitAttempted) return cachedManifold;
  manifoldInitAttempted = true;
  let mod;
  try {
    mod = await import('manifold-3d');
  } catch (_dynamicErr) {
    try {
      mod = require('manifold-3d');
    } catch (_staticErr) {
      process.stderr.write('[scene_builder] manifold-3d module unavailable; CSG booleans degrade to grouped geometry\n');
      cachedManifold = null;
      return cachedManifold;
    }
  }
  const init = mod.default || mod;
  const wasm = await init();
  if (typeof wasm.setup === 'function') wasm.setup();
  cachedManifold = wasm;
  return cachedManifold;
}

let cachedRoundedBox = null;
let roundedBoxAttempted = false;

async function getRoundedBoxGeometry() {
  if (roundedBoxAttempted) return cachedRoundedBox;
  roundedBoxAttempted = true;
  try {
    const mod = await import('three/addons/geometries/RoundedBoxGeometry.js');
    cachedRoundedBox = mod.RoundedBoxGeometry || null;
  } catch (_) {
    try {
      const mod = require('three/addons/geometries/RoundedBoxGeometry.js');
      cachedRoundedBox = mod.RoundedBoxGeometry || null;
    } catch (_) {
      cachedRoundedBox = null;
    }
  }
  return cachedRoundedBox;
}

function buildGeometry(THREE, specGeom, polyFactor = 1.0, style = null, RoundedBoxClass = null) {
  const type = (specGeom && specGeom.type) || 'box';
  const p = (specGeom && specGeom.params) || {};

  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(
        p.radius || 1,
        Math.max(8, resolveSegments(p.widthSegments, 16, polyFactor)),
        Math.max(6, resolveSegments(p.heightSegments, 12, polyFactor))
      );
    case 'cylinder':
      return new THREE.CylinderGeometry(
        p.radiusTop !== undefined ? p.radiusTop : 1,
        p.radiusBottom !== undefined ? p.radiusBottom : 1,
        p.height || 1,
        Math.max(6, resolveSegments(p.radialSegments, 16, polyFactor))
      );
    case 'torus':
      return new THREE.TorusGeometry(
        p.radius || 1,
        p.tube || 0.4,
        Math.max(6, resolveSegments(p.radialSegments, 16, polyFactor)),
        Math.max(8, resolveSegments(p.tubularSegments, 64, polyFactor))
      );
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(
        p.radius || 1,
        p.tube || 0.4,
        Math.max(8, resolveSegments(p.tubularSegments, 64, polyFactor)),
        Math.max(6, resolveSegments(p.radialSegments, 16, polyFactor)),
        p.p || 2,
        p.q || 3
      );
    case 'cone':
      return new THREE.ConeGeometry(
        p.radius || 1,
        p.height || 1,
        Math.max(6, resolveSegments(p.radialSegments, 16, polyFactor))
      );
    case 'plane': {
      const segs = Math.max(2, Math.round(8 * Math.sqrt(Math.max(0.25, polyFactor))));
      return new THREE.PlaneGeometry(
        p.width || 1,
        p.height || 1,
        segs,
        segs
      );
    }
    case 'dodecahedron': {
      const detail = Math.min(3, Math.max(0, Math.round(polyFactor - 1)));
      return new THREE.DodecahedronGeometry(
        p.radius || 1,
        p.detail !== undefined ? p.detail : detail
      );
    }
    case 'icosahedron': {
      const detail = Math.min(3, Math.max(0, Math.round(polyFactor - 1)));
      return new THREE.IcosahedronGeometry(
        p.radius || 1,
        p.detail !== undefined ? p.detail : detail
      );
    }
    case 'capsule':
      return new THREE.CapsuleGeometry(
        p.radius || 1,
        p.length || 1,
        Math.max(4, resolveSegments(p.capSegments, 8, polyFactor)),
        Math.max(6, resolveSegments(p.radialSegments, 16, polyFactor))
      );
    case 'lathe': {
      const rawProfile = (p.profile && p.profile.length >= 2) ? p.profile : [[0, 0], [0.5, 0.5], [0, 1.0]];
      const profile = rawProfile.map(pt => new THREE.Vector2(pt[0], pt[1]));
      const segs = Math.max(6, resolveSegments(p.radialSegments, 24, polyFactor));
      return new THREE.LatheGeometry(profile, segs);
    }
    case 'tube': {
      const rawPoints = (p.points && p.points.length >= 2) ? p.points : [[0, 0, 0], [0, 1, 0]];
      const points = rawPoints.map(pt => new THREE.Vector3(pt[0], pt[1], pt[2]));
      const curve = new THREE.CatmullRomCurve3(points);
      const tubSegs = Math.max(8, resolveSegments(p.tubularSegments, 32, polyFactor));
      const radSegs = Math.max(6, resolveSegments(p.radialSegments, 12, polyFactor));
      return new THREE.TubeGeometry(curve, tubSegs, p.radius || 0.1, radSegs, false);
    }
    case 'box':
    default: {
      const w = p.width || 1;
      const h = p.height || 1;
      const d = p.depth || 1;
      const segs = Math.max(1, Math.round(2 * Math.sqrt(Math.max(0.25, polyFactor))));
      const bevel = (style && typeof style.bevel === 'number') ? style.bevel : 0.06;
      if (bevel > 0 && RoundedBoxClass) {
        const radius = Math.min(w, h, d) * bevel;
        const bevelSegments = Math.max(2, Math.min(6, Math.round(1 + polyFactor * 0.5)));
        try {
          return new RoundedBoxClass(w, h, d, bevelSegments, radius);
        } catch { /* intentional best-effort fallback: optional decoration omitted */ }
      }
      return new THREE.BoxGeometry(w, h, d, segs, segs, segs);
    }
  }
}

function buildMaterial(THREE, specMat) {
  const m = specMat || {};
  const isPhysical = m.type !== 'standard';

  const baseOpts = {
    color: new THREE.Color(m.color || '#6366f1'),
    roughness: typeof m.roughness === 'number' ? m.roughness : 0.3,
    metalness: typeof m.metalness === 'number' ? m.metalness : 0.2,
    wireframe: Boolean(m.wireframe)
  };

  if (m.emissive) {
    baseOpts.emissive = new THREE.Color(m.emissive);
    baseOpts.emissiveIntensity = typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 1.0;
  }

  if (isPhysical) {
    if (typeof m.clearcoat === 'number') baseOpts.clearcoat = m.clearcoat;
    if (typeof m.clearcoatRoughness === 'number') baseOpts.clearcoatRoughness = m.clearcoatRoughness;
    if (typeof m.transmission === 'number') baseOpts.transmission = m.transmission;
    if (typeof m.ior === 'number') baseOpts.ior = m.ior;
    if (typeof m.sheen === 'number' && m.sheen > 0) {
      baseOpts.sheen = m.sheen;
      baseOpts.sheenRoughness = typeof m.sheenRoughness === 'number' ? m.sheenRoughness : 0.5;
      baseOpts.sheenColor = new THREE.Color(m.sheenColor || '#ffffff');
    }
    if (typeof m.subsurface === 'number' && m.subsurface > 0) {
      baseOpts.specularIntensity = Math.max(0.2, 1.0 - m.subsurface);
    }
    if (typeof m.opacity === 'number') {
      baseOpts.opacity = m.opacity;
      baseOpts.transparent = m.transparent || m.opacity < 1.0;
    }
    return new THREE.MeshPhysicalMaterial(baseOpts);
  }

  return new THREE.MeshStandardMaterial(baseOpts);
}

function calculateTriangles(geometry) {
  if (!geometry) return 0;
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  if (geometry.attributes && geometry.attributes.position) return Math.floor(geometry.attributes.position.count / 3);
  return 0;
}

function createManifoldPrimitive(wasm, nodeSpec) {
  const M = wasm.Manifold;
  const geom = nodeSpec.geometry || {};
  const type = geom.type || 'box';
  const p = geom.params || {};

  let manifold = null;
  switch (type) {
    case 'sphere':
      manifold = M.sphere(p.radius || 1, Math.max(12, p.widthSegments || 24));
      break;
    case 'cylinder':
      manifold = M.cylinder(
        p.height || 1,
        p.radiusBottom !== undefined ? p.radiusBottom : 1,
        p.radiusTop !== undefined ? p.radiusTop : 1,
        Math.max(12, p.radialSegments || 24),
        true
      );
      break;
    case 'cone':
      manifold = M.cylinder(p.height || 1, p.radius || 1, 0, Math.max(12, p.radialSegments || 24), true);
      break;
    case 'box':
    default:
      manifold = M.cube([p.width || 1, p.height || 1, p.depth || 1], true);
      break;
  }

  const trans = nodeSpec.transform || {};
  const scl = trans.scale || [1, 1, 1];
  const rot = trans.rotation || [0, 0, 0];
  const pos = trans.position || [0, 0, 0];

  if (scl[0] !== 1 || scl[1] !== 1 || scl[2] !== 1) {
    manifold = manifold.scale(scl);
  }
  if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
    const rotDeg = [rot[0] * (180 / Math.PI), rot[1] * (180 / Math.PI), rot[2] * (180 / Math.PI)];
    manifold = manifold.rotate(rotDeg);
  }
  if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
    manifold = manifold.translate(pos);
  }

  return manifold;
}

function manifoldMeshToThreeGeometry(THREE, mMesh) {
  const geom = new THREE.BufferGeometry();
  const numProp = mMesh.numProp || 3;
  const numVert = Math.floor(mMesh.vertProperties.length / numProp);
  const positions = new Float32Array(numVert * 3);

  for (let i = 0; i < numVert; i++) {
    positions[i * 3 + 0] = mMesh.vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = mMesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mMesh.vertProperties[i * numProp + 2];
  }

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (mMesh.triVerts) {
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(mMesh.triVerts), 1));
  }
  geom.computeVertexNormals();
  geometryQuality.ensureUv(geom);
  return geom;
}

async function buildCsgNode(THREE, wasm, nodeSpec, polyFactor) {
  const op = (nodeSpec.csg && nodeSpec.csg.op) || 'union';
  const operands = (nodeSpec.csg && nodeSpec.csg.operands) || [];

  if (op === 'group' || !wasm || operands.length === 0) {
    return buildGroupFallback(THREE, wasm, nodeSpec, polyFactor);
  }

  try {
    let resultManifold = null;
    let baseMaterialSpec = null;

    for (let i = 0; i < operands.length; i++) {
      const opNode = operands[i];
      let operandManifold = null;

      if (opNode.csg) {
        const subResult = await buildCsgNode(THREE, wasm, opNode, polyFactor);
        if (subResult && subResult.isMesh && subResult.userData && subResult.userData.manifold) {
          operandManifold = subResult.userData.manifold;
        } else {
          return buildGroupFallback(THREE, wasm, nodeSpec, polyFactor);
        }
      } else {
        if (!baseMaterialSpec && opNode.material) {
          baseMaterialSpec = opNode.material;
        }
        operandManifold = createManifoldPrimitive(wasm, opNode);
      }

      if (!resultManifold) {
        resultManifold = operandManifold;
      } else {
        if (op === 'subtract') {
          resultManifold = resultManifold.subtract(operandManifold);
        } else if (op === 'intersect') {
          resultManifold = resultManifold.intersect(operandManifold);
        } else {
          resultManifold = resultManifold.add(operandManifold);
        }
      }
    }

    if (!resultManifold || resultManifold.isEmpty()) {
      return buildGroupFallback(THREE, wasm, nodeSpec, polyFactor);
    }

    const mMesh = resultManifold.getMesh();
    const geom = manifoldMeshToThreeGeometry(THREE, mMesh);
    const mat = buildMaterial(THREE, baseMaterialSpec || { color: '#6366f1' });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = nodeSpec.name || `csg_${op}`;
    mesh.userData.manifold = resultManifold;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return { object: mesh, triangles: calculateTriangles(geom), meshCount: 1 };
  } catch (err) {
    process.stderr.write(`[scene_builder] CSG boolean "${op}" fallback to THREE.Group: ${err.message}\n`);
    return buildGroupFallback(THREE, wasm, nodeSpec, polyFactor);
  }
}

async function buildGroupFallback(THREE, wasm, nodeSpec, polyFactor) {
  const group = new THREE.Group();
  group.name = nodeSpec.name || 'group';
  let totalTriangles = 0;
  let meshCount = 0;

  const operands = (nodeSpec.csg && nodeSpec.csg.operands) || [];
  for (const opNode of operands) {
    if (opNode.csg) {
      const sub = await buildCsgNode(THREE, wasm, opNode, polyFactor);
      if (sub && sub.object) {
        group.add(sub.object);
        totalTriangles += sub.triangles;
        meshCount += sub.meshCount;
      }
    } else {
      const geom = buildGeometry(THREE, opNode.geometry, polyFactor);
      const mat = buildMaterial(THREE, opNode.material);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = opNode.name || 'group_item';

      const pos = (opNode.transform && opNode.transform.position) || [0, 0, 0];
      const rot = (opNode.transform && opNode.transform.rotation) || [0, 0, 0];
      const scl = (opNode.transform && opNode.transform.scale) || [1, 1, 1];

      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.scale.set(scl[0], scl[1], scl[2]);

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      totalTriangles += calculateTriangles(geom);
      meshCount += 1;
    }
  }

  return { object: group, triangles: totalTriangles, meshCount };
}

function resolveSegments(explicit, fallback, polyFactor) {
  const base = Number.isFinite(explicit) && explicit > 0 ? explicit : fallback;
  const density = Math.sqrt(Math.max(0.25, polyFactor));
  const scaled = Math.round(base * density);
  const ceiling = Math.max(base * 8, 64);
  return Math.max(6, Math.min(ceiling, scaled));
}

function computePolyFactor(targetPolycount) {
  const tc = Number(targetPolycount) || 8000;
  const factor = Math.sqrt(Math.max(800, tc) / 1000);
  return Math.max(0.8, Math.min(12, factor));
}

async function buildSceneFromSpec(sceneSpec) {
  const THREE = await getThree();
  const wasm = await getManifoldWasm();
  const RoundedBoxClass = await getRoundedBoxGeometry();
  const style = sceneSpec.style || { bevel: 0.06 };
  const scene = new THREE.Scene();
  scene.name = sceneSpec.name || 'Scene';

  const polyFactor = computePolyFactor(sceneSpec.target_polycount);
  let totalTriangles = 0;
  let totalMeshCount = 0;

  for (const nodeSpec of sceneSpec.nodes || []) {
    if (nodeSpec.csg) {
      const csgRes = await buildCsgNode(THREE, wasm, nodeSpec, polyFactor);
      if (csgRes && csgRes.object) {
        scene.add(csgRes.object);
        totalTriangles += csgRes.triangles;
        totalMeshCount += csgRes.meshCount;
      }
      continue;
    }

    if (nodeSpec.geometry && nodeSpec.geometry.type === 'plane') {
      const planeW = Number(nodeSpec.geometry.params && nodeSpec.geometry.params.width) || 1;
      const planeH = Number(nodeSpec.geometry.params && nodeSpec.geometry.params.height) || 1;
      if (Math.max(planeW, planeH) > 1.5) continue;
    }

    const rawGeom = buildGeometry(THREE, nodeSpec.geometry, polyFactor, style, RoundedBoxClass);
    const geomType = (nodeSpec.geometry && nodeSpec.geometry.type) || 'box';
    const geom = await geometryQuality.finalizeGeometry(THREE, rawGeom, {
      smooth: SMOOTH_PRIMITIVES.has(geomType),
      weld: rawGeom.index === null || rawGeom.index === undefined
    });
    const mat = buildMaterial(THREE, nodeSpec.material);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = nodeSpec.name || `mesh_${totalMeshCount}`;

    const pos = (nodeSpec.transform && nodeSpec.transform.position) || [0, 0, 0];
    const rot = (nodeSpec.transform && nodeSpec.transform.rotation) || [0, 0, 0];
    const scl = (nodeSpec.transform && nodeSpec.transform.scale) || [1, 1, 1];

    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.scale.set(scl[0], scl[1], scl[2]);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    scene.add(mesh);
    totalTriangles += calculateTriangles(geom);
    totalMeshCount += 1;
  }

  // Setup lighting
  for (const l of sceneSpec.lights || []) {
    const col = new THREE.Color(l.color || '#ffffff');
    const intensity = typeof l.intensity === 'number' ? l.intensity : 1.5;
    let light;

    if (l.type === 'ambient') {
      light = new THREE.DirectionalLight(col, intensity * 0.6);
      light.position.set(0, 8, 0);
    } else if (l.type === 'point') {
      light = new THREE.PointLight(col, intensity);
      const pos = l.position || [0, 2, 0];
      light.position.set(pos[0], pos[1], pos[2]);
    } else {
      light = new THREE.DirectionalLight(col, intensity);
      const pos = l.position || [2, 4, 3];
      light.position.set(pos[0], pos[1], pos[2]);
    }

    if (light.target && light.target.isObject3D) {
      light.target.position.set(0, 0, -1);
      if (light.target.matrixAutoUpdate !== undefined) light.target.updateMatrix();
      light.add(light.target);
    }

    scene.add(light);
  }

  // Camera setup
  const camSpec = sceneSpec.camera || {};
  const fov = camSpec.fov || 45;
  const camera = new THREE.PerspectiveCamera(fov, 1.0, 0.1, 1000);
  const cPos = camSpec.position || [0, 1.5, 3.5];
  camera.position.set(cPos[0], cPos[1], cPos[2]);

  const target = camSpec.target || [0, 0, 0];
  camera.lookAt(new THREE.Vector3(target[0], target[1], target[2]));

  return {
    scene,
    camera,
    triangleCount: totalTriangles,
    meshCount: totalMeshCount
  };
}

module.exports = {
  buildGeometry,
  buildMaterial,
  buildSceneFromSpec,
  getManifoldWasm
};
