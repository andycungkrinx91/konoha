import * as THREE from 'three';

function generateStarLayer(layerOpts, orbTexture, isLight, hexColors) {
  const { count, size } = layerOpts;
  const blend = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const k = i * 3;
    let x = (Math.random() - 0.5) * 88;
    let y = (Math.random() - 0.5) * 60;
    const z = -45 + Math.random() * 52;

    if (x * x + y * y < 2.5 && Math.abs(z) < 2.5) {
      x += (x >= 0 ? 2.0 : -2.0);
      y += (y >= 0 ? 2.0 : -2.0);
    }

    positions[k] = x;
    positions[k + 1] = y;
    positions[k + 2] = z;

    const c = (i % 5 === 0)
      ? new THREE.Color(isLight ? '#0f172a' : '#ffffff')
      : hexColors[i % hexColors.length].clone();

    if (isLight && i % 5 !== 0) {
      c.multiplyScalar(0.42);
    }

    colors[k] = c.r;
    colors[k + 1] = c.g;
    colors[k + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size,
      map: orbTexture,
      vertexColors: true,
      transparent: true,
      opacity: isLight ? 0.82 : 0.92,
      blending: blend,
      depthWrite: false,
      sizeAttenuation: true
    })
  );
}

export function makeCosmicUniverseStarfield(scene, orbTexture, isLight, hexColors) {
  const starfieldGroup = new THREE.Group();
  scene.add(starfieldGroup);

  const cosmicStars1 = generateStarLayer({ count: 3000, size: isLight ? 0.08 : 0.07 }, orbTexture, isLight, hexColors);
  starfieldGroup.add(cosmicStars1);

  const cosmicStars2 = generateStarLayer({ count: 2000, size: isLight ? 0.14 : 0.12 }, orbTexture, isLight, hexColors);
  starfieldGroup.add(cosmicStars2);

  const cosmicStars3 = generateStarLayer({ count: 1000, size: isLight ? 0.24 : 0.20 }, orbTexture, isLight, hexColors);
  starfieldGroup.add(cosmicStars3);

  return {
    starfieldGroup,
    cosmicStars1,
    cosmicStars2,
    cosmicStars3,
    cosmicStarCount: 6000,
    cosmicStars: cosmicStars2
  };
}

export function makeEnvironment(scene, hexColors, isLight, options = {}) {
  if (options.transparent || isLight) return null;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x030a16, roughness: 0.3, metalness: 0.6 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.5;
  scene.add(floor);

  const grid = new THREE.GridHelper(80, 80, hexColors[0].getHex(), 0x082344);
  grid.position.y = -2.48;
  grid.material.transparent = true;
  grid.material.opacity = 0.2;
  scene.add(grid);

  const starPositions = new Float32Array(750 * 3);
  for (let i = 0; i < 750; i++) {
    starPositions[i * 3] = (Math.random() - 0.5) * 35;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 22;
    starPositions[i * 3 + 2] = -Math.random() * 18 - 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: hexColors[2], size: 0.018, transparent: true, opacity: 0.65 })
  );
  scene.add(stars);

  return { floor, grid, stars };
}
