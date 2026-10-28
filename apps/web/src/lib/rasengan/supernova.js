import * as THREE from 'three';

export function createCosmicOrbTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  const total = size * size;

  for (let i = 0; i < total; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const idx = i * 4;
    const nx = (x - half + 0.5) / half;
    const ny = (y - half + 0.5) / half;
    const r = Math.sqrt(nx * nx + ny * ny);

    if (r >= 1.0) {
      data[idx + 3] = 0;
      continue;
    }

    const core = Math.exp(-r * r * 8.0);
    const halo = Math.pow(Math.max(0, 1.0 - r), 2.2);
    const intensity = Math.min(1.0, core * 0.85 + halo * 0.65);

    data[idx] = 255;
    data[idx + 1] = 255;
    data[idx + 2] = 255;
    data[idx + 3] = Math.floor(intensity * 255);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export function createSupernovaLightTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  const total = size * size;

  for (let i = 0; i < total; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const idx = i * 4;
    const nx = (x - half + 0.5) / half;
    const ny = (y - half + 0.5) / half;
    const r = Math.sqrt(nx * nx + ny * ny);

    if (r >= 1.0) {
      data[idx + 3] = 0;
      continue;
    }

    const core = Math.exp(-r * 2.8);
    const halo = Math.pow(Math.max(0, 1.0 - r), 1.35);
    const glow = Math.min(1.0, core * 1.3 + halo * 0.7);

    data[idx] = 255;
    data[idx + 1] = 255;
    data[idx + 2] = 255;
    data[idx + 3] = Math.floor(glow * 255);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function buildSupernovaRings(supernovaGroup, hexColors, blend) {
  const rings = [];
  for (let r = 0; r < 4; r++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.2 + r * 0.45, 0.042, 8, 96),
      new THREE.MeshBasicMaterial({
        color: hexColors[(r + 1) % hexColors.length],
        transparent: true,
        opacity: 0,
        blending: blend,
        depthWrite: false
      })
    );
    ring.rotation.set(Math.PI * 0.2 + r * 0.35, Math.PI * 0.15 + r * 0.25, r * 0.8);
    ring.userData = {
      baseRotX: ring.rotation.x,
      baseRotY: ring.rotation.y,
      baseRotZ: ring.rotation.z,
      delay: r * 0.08,
      speed: 2.2 + r * 0.5
    };
    supernovaGroup.add(ring);
    rings.push(ring);
  }
  return rings;
}

function buildSupernovaRays(supernovaGroup, hexColors, blend) {
  const raysGroup = new THREE.Group();
  supernovaGroup.add(raysGroup);
  const rays = [];

  for (let i = 0; i < 32; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / 32);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );
    const rayLength = 2.5 + (i % 5) * 0.6;
    const pts = [new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(rayLength)];
    const rayGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const rayMat = new THREE.LineBasicMaterial({
      color: hexColors[i % 2 === 0 ? 3 : 2],
      transparent: true,
      opacity: 0,
      blending: blend,
      linewidth: 2
    });
    const ray = new THREE.Line(rayGeo, rayMat);
    ray.userData = { dir: dir.clone(), baseLength: rayLength, speed: 1.5 + (i % 3) * 0.5 };
    raysGroup.add(ray);
    rays.push(ray);
  }
  return { raysGroup, rays };
}

export function makeSupernovaBigBang(scene, hexColors, isLight) {
  const supernovaGroup = new THREE.Group();
  scene.add(supernovaGroup);

  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
  const supernovaCore = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 32, 24),
    new THREE.MeshBasicMaterial({
      color: hexColors[3],
      transparent: true,
      opacity: 0,
      blending: blend,
      depthWrite: false
    })
  );
  supernovaGroup.add(supernovaCore);

  const supernovaRings = buildSupernovaRings(supernovaGroup, hexColors, blend);
  const { raysGroup: supernovaRaysGroup, rays: supernovaRays } = buildSupernovaRays(supernovaGroup, hexColors, blend);

  const flash = new THREE.PointLight(hexColors[3], 0, 20);
  flash.position.set(0, 0, 2);
  scene.add(flash);

  const lightGeo = new THREE.PlaneGeometry(6, 6);
  const lightMat = new THREE.MeshBasicMaterial({
    map: createSupernovaLightTexture(),
    color: hexColors[3],
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const supernovaLightGlow = new THREE.Mesh(lightGeo, lightMat);
  supernovaLightGlow.position.set(0, 0, 0.2);
  supernovaGroup.add(supernovaLightGlow);

  return {
    supernovaGroup,
    supernovaCore,
    supernovaRings,
    supernovaRaysGroup,
    supernovaRays,
    supernovaLightGlow,
    flash
  };
}

export function applyPaletteToSupernova(components, hexColors, isLight) {
  const { supernovaGroup, supernovaCore, supernovaRings, supernovaRays, supernovaLightGlow, flash } = components;
  if (!supernovaGroup) return;

  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
  if (supernovaCore?.material) {
    supernovaCore.material.color.copy(hexColors[3]);
    supernovaCore.material.blending = blend;
    supernovaCore.material.needsUpdate = true;
  }
  if (supernovaLightGlow?.material) {
    supernovaLightGlow.material.color.copy(hexColors[3]);
    supernovaLightGlow.material.needsUpdate = true;
  }
  if (flash) flash.color.copy(hexColors[3]);

  if (supernovaRings) {
    supernovaRings.forEach((ring, idx) => {
      ring.material.color.copy(hexColors[(idx + 1) % hexColors.length]);
      ring.material.blending = blend;
      ring.material.needsUpdate = true;
    });
  }

  if (supernovaRays) {
    supernovaRays.forEach((ray, idx) => {
      ray.material.color.copy(hexColors[idx % 2 === 0 ? 3 : 2]);
      ray.material.blending = blend;
      ray.material.needsUpdate = true;
    });
  }
}
