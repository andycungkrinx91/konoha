import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function makeCore(scene, hexColors, isLight) {
  const coreGroup = new THREE.Group();
  scene.add(coreGroup);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 48, 32),
    new THREE.MeshBasicMaterial({
      color: hexColors[0],
      transparent: true,
      opacity: isLight ? 0.96 : 0.98
    })
  );
  coreGroup.add(core);

  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.92, 32, 24),
    new THREE.MeshBasicMaterial({
      color: hexColors[1],
      transparent: true,
      opacity: isLight ? 0.45 : 0.24,
      blending: blend,
      depthWrite: false
    })
  );
  coreGroup.add(coreGlow);

  const outerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.22, 32, 24),
    new THREE.MeshBasicMaterial({
      color: hexColors[2],
      transparent: true,
      opacity: isLight ? 0.25 : 0.09,
      blending: blend,
      depthWrite: false
    })
  );
  coreGroup.add(outerGlow);
  coreGroup.scale.setScalar(0.05);

  return { coreGroup, core, coreGlow, outerGlow };
}

export function makeEnergyRibbons(scene, hexColors, isLight, coreGroup) {
  const ribbons = [];
  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

  for (let r = 0; r < 7; r++) {
    const points = [];
    const turns = 2.2 + Math.random() * 1.2;
    const phase = Math.random() * Math.PI * 2;
    for (let i = 0; i <= 220; i++) {
      const t = i / 220;
      const theta = t * Math.PI * 2 * turns + phase;
      const radius = 0.42 + 0.26 * Math.sin(t * Math.PI) + 0.12 * Math.sin(theta * 2.3 + r);
      points.push(new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta * 1.15) * radius, Math.sin(theta * 0.72 + r) * 0.48));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 400, r % 3 === 0 ? 0.018 : 0.009, 5, false),
      new THREE.MeshBasicMaterial({
        color: hexColors[r % hexColors.length],
        transparent: true,
        opacity: isLight ? 0.92 : 0.92,
        blending: blend,
        depthWrite: false
      })
    );
    mesh.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    coreGroup.add(mesh);
    ribbons.push(mesh);
  }

  const ringGroup = new THREE.Group();
  scene.add(ringGroup);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.05 + i * 0.18, 0.012, 8, 120),
      new THREE.MeshBasicMaterial({
        color: hexColors[i % hexColors.length],
        transparent: true,
        opacity: isLight ? 0.75 : 0.65,
        blending: blend
      })
    );
    ring.rotation.set(Math.PI * (0.3 + i * 0.22), Math.PI * (0.2 + i * 0.28), i * 1.1);
    ringGroup.add(ring);
    rings.push(ring);
  }

  return { ribbons, ringGroup, rings };
}

export function resetParticle(particlesData, i, initial = false) {
  const { positions, velocities, seeds } = particlesData;
  const k = i * 3;
  const a = Math.random() * Math.PI * 2;
  const r = 0.7 + Math.random() * 1.2;
  positions[k] = Math.cos(a) * r;
  positions[k + 1] = Math.sin(a) * r;
  positions[k + 2] = (Math.random() - 0.5) * 1.5;
  const speed = 0.3 + Math.random() * 1.5;
  velocities[k] = Math.cos(a) * speed;
  velocities[k + 1] = Math.sin(a) * speed;
  velocities[k + 2] = (Math.random() - 0.5) * speed;
  if (initial && seeds) seeds[i] = Math.random();
}

export function makeParticles(scene, hexColors, isLight, count = 1100) {
  const particlePositions = new Float32Array(count * 3);
  const particleVelocities = new Float32Array(count * 3);
  const particleSeeds = new Float32Array(count);
  const pData = { positions: particlePositions, velocities: particleVelocities, seeds: particleSeeds };

  for (let i = 0; i < count; i++) {
    particleSeeds[i] = Math.random();
    resetParticle(pData, i, true);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
  const particles = new THREE.Points(geo, new THREE.PointsMaterial({
    color: hexColors[1],
    size: isLight ? 0.038 : 0.035,
    transparent: true,
    opacity: isLight ? 0.95 : 0.9,
    blending: blend,
    depthWrite: false,
    sizeAttenuation: true
  }));
  scene.add(particles);

  return { particles, particlePositions, particleVelocities, particleSeeds, particleCount: count };
}

function classifyMaterialColor(name, parent, hexColors, isLight) {
  if (name === 'Object_6' || parent.includes('wind') || parent.includes('Tube_2')) {
    return { color: hexColors[2], opacity: isLight ? 0.94 : 0.96 };
  }
  if (name === 'Object_27' || parent.includes('Sphere UV_14')) {
    return { color: hexColors[0], opacity: isLight ? 0.96 : 0.98 };
  }
  if (name === 'Object_25' || parent.includes('Sphere UV 2_13')) {
    return { color: hexColors[1], opacity: isLight ? 0.86 : 0.76 };
  }
  if (name === 'Object_23' || parent.includes('Sphere UV 1_12')) {
    return { color: hexColors[2], opacity: isLight ? 0.68 : 0.48 };
  }
  if (name === 'Object_17' || parent.includes('Radial_8')) {
    return { color: hexColors[3], opacity: isLight ? 0.88 : 0.80 };
  }
  if (name === 'Object_13' || parent.includes('Plane 1_6')) {
    return { color: hexColors[3], opacity: isLight ? 0.86 : 0.78 };
  }
  if (name === 'Object_15' || parent.includes('Plane 2_7')) {
    return { color: hexColors[2], opacity: isLight ? 0.88 : 0.82 };
  }
  if (name === 'Object_11' || parent.includes('Plane_5')) {
    return { color: hexColors[0], opacity: isLight ? 0.90 : 0.85 };
  }
  return { color: hexColors[1], opacity: isLight ? 0.88 : 0.85 };
}

export function applyPaletteToModel(modelMaterials, hexColors, isLight) {
  if (!modelMaterials || modelMaterials.length === 0) return;
  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

  for (const item of modelMaterials) {
    const mat = item.material;
    mat.blending = blend;
    mat.depthWrite = false;
    mat.transparent = true;

    const { color, opacity } = classifyMaterialColor(item.name, item.parentName, hexColors, isLight);
    mat.color.copy(color);
    mat.opacity = opacity;
    mat.needsUpdate = true;
  }
}

function disposeGltfScene(scene) {
  scene?.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
    else obj.material?.dispose?.();
  });
}

function collectModelMaterials(scene) {
  const modelMaterials = [];
  scene.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    node.material = node.material.clone();
    node.material.transparent = true;
    node.material.depthWrite = false;
    node.material.side = THREE.DoubleSide;
    modelMaterials.push({
      name: node.name,
      material: node.material,
      parentName: node.parent?.name || ''
    });
  });
  return modelMaterials;
}

function handleGltfLoaded(gltf, config, rasenshurikenGroup) {
  const { hexColors, isLight, isDisposed, onLoaded } = config;
  if (isDisposed()) {
    disposeGltfScene(gltf.scene);
    return;
  }

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const center = new THREE.Vector3();
  box.getCenter(center);
  gltf.scene.position.sub(center);

  const modelMaterials = collectModelMaterials(gltf.scene);
  applyPaletteToModel(modelMaterials, hexColors, isLight);
  rasenshurikenGroup.add(gltf.scene);

  if (onLoaded) {
    onLoaded({
      scene: gltf.scene,
      modelMaterials,
      windNode: gltf.scene.getObjectByName('wind_0'),
      effectNode: gltf.scene.getObjectByName('effect_3'),
      rasenganNode: gltf.scene.getObjectByName('rasengan_11')
    });
  }
}

export function makeRasenshuriken(config) {
  const { isPostLogin, scene } = config;
  const rasenshurikenGroup = new THREE.Group();
  rasenshurikenGroup.position.set(0, 0, 0);
  rasenshurikenGroup.rotation.x = 0.52;
  rasenshurikenGroup.scale.setScalar(isPostLogin ? 4.2 : 3.2);
  scene.add(rasenshurikenGroup);

  try {
    const loader = new GLTFLoader();
    loader.load(
      '/rasenshuriken/scene.gltf',
      (gltf) => handleGltfLoaded(gltf, config, rasenshurikenGroup),
      undefined,
      (err) => {
        console.warn('Rasenshuriken glTF loading fallback:', err?.message || err);
      }
    );
  } catch (e) {
    console.warn('GLTFLoader error:', e?.message || e);
  }

  return rasenshurikenGroup;
}
