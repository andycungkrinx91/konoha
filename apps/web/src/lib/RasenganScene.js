import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Procedural Rasengan scene built with Three.js.
 * Enhanced with dynamic theme palette colors, mode awareness (NormalBlending on light,
 * AdditiveBlending on dark), zero-leak lifecycle management, and visibility throttling.
 */
export class RasenganScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      bloom: true,
      pixelRatioCap: 1.75,
      colors: ['#0369A1', '#0284C7', '#075985', '#0E7490'],
      bgColor: '#020611',
      fogColor: '#030b1b',
      transparent: true,
      mode: 'dark', // 'dark' | 'light'
      onPhaseChange: null,
      autoLoop: true,
      phaseDuration: 8.0,
      isPostLogin: false,
      ...options
    };

    this.mode = this.options.mode || 'dark';
    this.isLight = this.mode === 'light';
    this.hexColors = this.parseColors(this.options.colors);

    this.isPostLogin = Boolean(this.options.isPostLogin);
    this.isThemeTransitioning = false;
    this.themeTransitionElapsed = 0;
    this.themeTransitionDuration = 1.0;

    this.lastTime = performance.now();
    this.elapsed = 0;
    this.phase = this.isPostLogin ? 'COSMIC_ORBIT' : 'CHARGING';
    this.phaseDuration = this.options.phaseDuration;
    this.disposed = false;
    this.isTabHidden = typeof document !== 'undefined' && document.hidden;
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    this.scene = new THREE.Scene();
    if (!this.options.transparent && !this.isLight) {
      this.scene.background = new THREE.Color(this.options.bgColor);
      this.scene.fog = new THREE.FogExp2(this.options.fogColor, 0.035);
    }

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0.35, 9.6);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: !!this.options.transparent || this.isLight,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, this.options.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.isLight ? 1.05 : 1.22;

    this.ambientLight = new THREE.AmbientLight(this.hexColors[0], this.isLight ? 2.0 : 1.4);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.PointLight(this.hexColors[1], this.isLight ? 60 : 100, 18);
    this.keyLight.position.set(2, 2.5, 4);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.PointLight(this.hexColors[2], this.isLight ? 50 : 75, 14);
    this.rimLight.position.set(-3, -1, 2);
    this.scene.add(this.rimLight);

    this.makeEnvironment();
    this.makeCosmicUniverseStarfield();
    this.makeCore();
    this.makeEnergyRibbons();
    this.makeParticles();
    this.makeSupernovaBigBang();
    this.makeRasenshuriken();

    if (this.options.bloom && !this.isLight) {
      try {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.25, 0.65, 0.12);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      } catch (_) {
        this.composer = null;
      }
    }

    this.onResize = this.resize.bind(this);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }

    this.onVisibilityChange = () => {
      this.isTabHidden = typeof document !== 'undefined' && document.hidden;
      if (!this.isTabHidden) {
        this.lastTime = performance.now();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    this.resize();
    this.playImpact();
    this.animate();
  }

  parseColors(colors) {
    const list = Array.isArray(colors) && colors.length > 0 ? colors : ['#0369A1', '#0284C7', '#075985', '#0E7490'];
    const parsed = list.map(c => new THREE.Color(c));
    while (parsed.length < 4) {
      parsed.push(parsed[0].clone());
    }
    return parsed;
  }

  updatePalette(colors, mode = null) {
    if (colors && colors.length > 0) {
      this.hexColors = this.parseColors(colors);
    }
    if (mode && (mode === 'light' || mode === 'dark')) {
      this.mode = mode;
      this.isLight = this.mode === 'light';
    }

    this.applyPaletteToModel();
    this.applyPaletteToSupernova();

    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    if (this.core) {
      this.core.material.color.copy(this.hexColors[0]);
      this.core.material.opacity = this.isLight ? 0.96 : 0.98;
    }
    if (this.coreGlow) {
      this.coreGlow.material.color.copy(this.hexColors[1]);
      this.coreGlow.material.blending = blend;
      this.coreGlow.material.opacity = this.isLight ? 0.45 : 0.24;
      this.coreGlow.material.needsUpdate = true;
    }
    if (this.outerGlow) {
      this.outerGlow.material.color.copy(this.hexColors[2]);
      this.outerGlow.material.blending = blend;
      this.outerGlow.material.opacity = this.isLight ? 0.25 : 0.09;
      this.outerGlow.material.needsUpdate = true;
    }
    if (this.ribbons) {
      this.ribbons.forEach((m, idx) => {
        m.material.color.copy(this.hexColors[idx % this.hexColors.length]);
        m.material.blending = blend;
        m.material.opacity = this.isLight ? 0.92 : 0.92;
        m.material.needsUpdate = true;
      });
    }
    if (this.rings) {
      this.rings.forEach((r, idx) => {
        r.material.color.copy(this.hexColors[idx % this.hexColors.length]);
        r.material.blending = blend;
        r.material.opacity = this.isLight ? 0.75 : 0.65;
        r.material.needsUpdate = true;
      });
    }
    if (this.particles) {
      this.particles.material.color.copy(this.hexColors[1]);
      this.particles.material.blending = blend;
      this.particles.material.opacity = this.isLight ? 0.95 : 0.9;
      this.particles.material.needsUpdate = true;
    }
    if (this.flash) {
      this.flash.color.copy(this.hexColors[3]);
    }
    if (this.keyLight) {
      this.keyLight.color.copy(this.hexColors[1]);
    }
    if (this.rimLight) {
      this.rimLight.color.copy(this.hexColors[2]);
    }
    if (this.ambientLight) {
      this.ambientLight.color.copy(this.hexColors[0]);
    }
    if (this.stars && this.stars.material) {
      this.stars.material.color.copy(this.hexColors[2]);
    }
  }

  setPostLoginMode(isPostLogin) {
    this.isPostLogin = Boolean(isPostLogin);
    if (this.isPostLogin) {
      if (this.supernovaGroup) this.supernovaGroup.visible = false;
      if (this.flash) this.flash.intensity = 0;
      this.phase = 'COSMIC_ORBIT';
      if (this.rasenshurikenGroup) {
        this.rasenshurikenGroup.scale.setScalar(4.2);
      }
    } else {
      if (this.supernovaGroup) this.supernovaGroup.visible = true;
      this.phase = 'CHARGING';
      this.phaseDuration = 8.0;
      if (this.rasenshurikenGroup) {
        this.rasenshurikenGroup.scale.setScalar(3.2);
      }
    }
  }

  triggerThemeSupernova(newColors, mode = null) {
    this.updatePalette(newColors, mode);
    this.isThemeTransitioning = true;
    this.themeTransitionStartedAt = performance.now();
    this.themeTransitionDuration = 1.0; // exactly 1 second Big Bang burst
    if (this.supernovaGroup) {
      this.supernovaGroup.visible = true;
    }
  }

  createCosmicOrbTexture() {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const nx = (x - half + 0.5) / half;
        const ny = (y - half + 0.5) / half;
        const r = Math.sqrt(nx * nx + ny * ny);

        if (r >= 1.0) {
          data[idx + 3] = 0;
          continue;
        }

        // Pure circular/spherical smooth orb with radiant core and Gaussian falloff
        // Strictly circular symmetry: NO spikes, NO star rays, NO square artifacts
        const core = Math.exp(-r * r * 8.0);
        const halo = Math.pow(Math.max(0, 1.0 - r), 2.2);
        const intensity = Math.min(1.0, core * 0.85 + halo * 0.65);

        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.floor(intensity * 255);
      }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  createSupernovaLightTexture() {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const nx = (x - half + 0.5) / half;
        const ny = (y - half + 0.5) / half;
        const r = Math.sqrt(nx * nx + ny * ny);

        if (r >= 1.0) {
          data[idx + 3] = 0;
          continue;
        }

        // Intense radiant solar burst with blinding white core
        const core = Math.exp(-r * 2.8);
        const halo = Math.pow(Math.max(0, 1.0 - r), 1.35);
        const glow = Math.min(1.0, core * 1.3 + halo * 0.7);

        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.floor(glow * 255);
      }
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return texture;
  }

  makeCosmicUniverseStarfield() {
    this.starfieldGroup = new THREE.Group();
    this.scene.add(this.starfieldGroup);

    this.orbTexture = this.createCosmicOrbTexture();
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    const createLayer = (count, size) => {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const k = i * 3;
        // Full-screen viewing frustum coverage from deep cosmos to near foreground
        let x = (Math.random() - 0.5) * 88;
        let y = (Math.random() - 0.5) * 60;
        let z = -45 + Math.random() * 52; // from z = -45 up to z = 7.0 in front of camera

        // Gently displace stars from Rasenshuriken core center
        if (x * x + y * y < 2.5 && Math.abs(z) < 2.5) {
          x += (x >= 0 ? 2.0 : -2.0);
          y += (y >= 0 ? 2.0 : -2.0);
        }

        positions[k] = x;
        positions[k + 1] = y;
        positions[k + 2] = z;

        const c = (i % 5 === 0)
          ? new THREE.Color(this.isLight ? '#0f172a' : '#ffffff')
          : this.hexColors[i % this.hexColors.length].clone();

        if (this.isLight && i % 5 !== 0) {
          c.multiplyScalar(0.42);
        }

        colors[k] = c.r;
        colors[k + 1] = c.g;
        colors[k + 2] = c.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const points = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          size,
          map: this.orbTexture,
          vertexColors: true,
          transparent: true,
          opacity: this.isLight ? 0.82 : 0.92,
          blending: blend,
          depthWrite: false,
          sizeAttenuation: true
        })
      );
      this.starfieldGroup.add(points);
      return points;
    };

    // 1. Distant tiny cosmic orbs (3,000 points)
    this.cosmicStars1 = createLayer(3000, this.isLight ? 0.08 : 0.07);
    // 2. Midground field orbs (2,000 points)
    this.cosmicStars2 = createLayer(2000, this.isLight ? 0.14 : 0.12);
    // 3. Radiant glowing orbs (1,000 points)
    this.cosmicStars3 = createLayer(1000, this.isLight ? 0.24 : 0.20);

    this.cosmicStarCount = 6000;
    this.cosmicStars = this.cosmicStars2; // backwards-compat alias
  }

  makeEnvironment() {
    if (this.options.transparent || this.isLight) return;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x030a16, roughness: 0.3, metalness: 0.6 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(80, 80, this.hexColors[0].getHex(), 0x082344);
    grid.position.y = -2.48;
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    this.scene.add(grid);

    const starPositions = new Float32Array(750 * 3);
    for (let i = 0; i < 750; i++) {
      starPositions[i * 3] = (Math.random() - 0.5) * 35;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 22;
      starPositions[i * 3 + 2] = -Math.random() * 18 - 2;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: this.hexColors[2], size: 0.018, transparent: true, opacity: 0.65 })
    );
    this.scene.add(this.stars);
  }

  makeCore() {
    this.coreGroup = new THREE.Group();
    this.scene.add(this.coreGroup);

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 48, 32),
      new THREE.MeshBasicMaterial({
        color: this.hexColors[0],
        transparent: true,
        opacity: this.isLight ? 0.96 : 0.98
      })
    );
    this.coreGroup.add(this.core);

    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    this.coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 32, 24),
      new THREE.MeshBasicMaterial({
        color: this.hexColors[1],
        transparent: true,
        opacity: this.isLight ? 0.45 : 0.24,
        blending: blend,
        depthWrite: false
      })
    );
    this.coreGroup.add(this.coreGlow);

    this.outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 32, 24),
      new THREE.MeshBasicMaterial({
        color: this.hexColors[2],
        transparent: true,
        opacity: this.isLight ? 0.25 : 0.09,
        blending: blend,
        depthWrite: false
      })
    );
    this.coreGroup.add(this.outerGlow);
    this.coreGroup.scale.setScalar(0.05);
  }

  makeEnergyRibbons() {
    this.ribbons = [];
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

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
          color: this.hexColors[r % this.hexColors.length],
          transparent: true,
          opacity: this.isLight ? 0.92 : 0.92,
          blending: blend,
          depthWrite: false
        })
      );
      mesh.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
      this.coreGroup.add(mesh);
      this.ribbons.push(mesh);
    }

    this.ringGroup = new THREE.Group();
    this.scene.add(this.ringGroup);
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.05 + i * 0.18, 0.012, 8, 120),
        new THREE.MeshBasicMaterial({
          color: this.hexColors[i % this.hexColors.length],
          transparent: true,
          opacity: this.isLight ? 0.75 : 0.65,
          blending: blend
        })
      );
      ring.rotation.set(Math.PI * (0.3 + i * 0.22), Math.PI * (0.2 + i * 0.28), i * 1.1);
      this.ringGroup.add(ring);
      this.rings.push(ring);
    }
  }

  makeParticles() {
    const count = 1100;
    this.particleCount = count;
    this.particlePositions = new Float32Array(count * 3);
    this.particleVelocities = new Float32Array(count * 3);
    this.particleSeeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.particleSeeds[i] = Math.random();
      this.resetParticle(i, true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3).setUsage(THREE.DynamicDrawUsage));
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: this.hexColors[1],
      size: this.isLight ? 0.038 : 0.035,
      transparent: true,
      opacity: this.isLight ? 0.95 : 0.9,
      blending: blend,
      depthWrite: false,
      sizeAttenuation: true
    }));
    this.scene.add(this.particles);
  }

  resetParticle(i, initial = false) {
    const k = i * 3;
    const a = Math.random() * Math.PI * 2;
    const r = 0.7 + Math.random() * 1.2;
    this.particlePositions[k] = Math.cos(a) * r;
    this.particlePositions[k + 1] = Math.sin(a) * r;
    this.particlePositions[k + 2] = (Math.random() - 0.5) * 1.5;
    const speed = 0.3 + Math.random() * 1.5;
    this.particleVelocities[k] = Math.cos(a) * speed;
    this.particleVelocities[k + 1] = Math.sin(a) * speed;
    this.particleVelocities[k + 2] = (Math.random() - 0.5) * speed;
    if (initial) this.particleSeeds[i] = Math.random();
  }

  makeSupernovaBigBang() {
    this.supernovaGroup = new THREE.Group();
    this.scene.add(this.supernovaGroup);

    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    // 1. Central Relativistic Plasma Starburst Fireball
    this.supernovaCore = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 32, 24),
      new THREE.MeshBasicMaterial({
        color: this.hexColors[3],
        transparent: true,
        opacity: 0,
        blending: blend,
        depthWrite: false
      })
    );
    this.supernovaGroup.add(this.supernovaCore);

    // 2. Multi-Ring Relativistic Shockwaves (4 concentric rings with staggered angles)
    this.supernovaRings = [];
    for (let r = 0; r < 4; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.2 + r * 0.45, 0.042, 8, 96),
        new THREE.MeshBasicMaterial({
          color: this.hexColors[(r + 1) % this.hexColors.length],
          transparent: true,
          opacity: 0,
          blending: blend,
          depthWrite: false
        })
      );
      ring.rotation.set(
        Math.PI * 0.2 + r * 0.35,
        Math.PI * 0.15 + r * 0.25,
        r * 0.8
      );
      ring.userData = {
        baseRotX: ring.rotation.x,
        baseRotY: ring.rotation.y,
        baseRotZ: ring.rotation.z,
        delay: r * 0.08,
        speed: 2.2 + r * 0.5
      };
      this.supernovaGroup.add(ring);
      this.supernovaRings.push(ring);
    }

    // 3. Coronal Starburst Rays (32 volumetric 3D energy rays blasting in all directions)
    this.supernovaRaysGroup = new THREE.Group();
    this.supernovaGroup.add(this.supernovaRaysGroup);
    this.supernovaRays = [];

    for (let i = 0; i < 32; i++) {
      // Golden spiral distribution on sphere
      const phi = Math.acos(1 - 2 * (i + 0.5) / 32);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi)
      );

      const rayLength = 2.5 + (i % 5) * 0.6;
      const pts = [
        new THREE.Vector3(0, 0, 0),
        dir.clone().multiplyScalar(rayLength)
      ];
      const rayGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const rayMat = new THREE.LineBasicMaterial({
        color: this.hexColors[i % 2 === 0 ? 3 : 2],
        transparent: true,
        opacity: 0,
        blending: blend,
        linewidth: 2
      });

      const ray = new THREE.Line(rayGeo, rayMat);
      ray.userData = {
        dir: dir.clone(),
        baseLength: rayLength,
        speed: 1.5 + (i % 3) * 0.5
      };
      this.supernovaRaysGroup.add(ray);
      this.supernovaRays.push(ray);
    }

    // 4. Stellar Flash Light
    this.flash = new THREE.PointLight(this.hexColors[3], 0, 20);
    this.flash.position.set(0, 0, 2);
    this.scene.add(this.flash);

    // 5. Radiant Supernova Core Light Flare (localized to central 3D core, never full-screen)
    const lightGeo = new THREE.PlaneGeometry(6, 6);
    const lightMat = new THREE.MeshBasicMaterial({
      map: this.createSupernovaLightTexture(),
      color: this.hexColors[3],
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.supernovaLightGlow = new THREE.Mesh(lightGeo, lightMat);
    this.supernovaLightGlow.position.set(0, 0, 0.2);
    this.supernovaGroup.add(this.supernovaLightGlow);
  }

  applyPaletteToSupernova() {
    if (!this.supernovaGroup) return;
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    if (this.supernovaLightGlow && this.supernovaLightGlow.material) {
      this.supernovaLightGlow.material.color.copy(this.hexColors[3]);
      this.supernovaLightGlow.material.needsUpdate = true;
    }

    if (this.supernovaCore && this.supernovaCore.material) {
      this.supernovaCore.material.color.copy(this.hexColors[3]);
      this.supernovaCore.material.blending = blend;
      this.supernovaCore.material.needsUpdate = true;
    }

    if (this.supernovaRings) {
      this.supernovaRings.forEach((ring, idx) => {
        ring.material.color.copy(this.hexColors[(idx + 1) % this.hexColors.length]);
        ring.material.blending = blend;
        ring.material.needsUpdate = true;
      });
    }

    if (this.supernovaRays) {
      this.supernovaRays.forEach((ray, idx) => {
        ray.material.color.copy(this.hexColors[idx % 2 === 0 ? 3 : 2]);
        ray.material.blending = blend;
        ray.material.needsUpdate = true;
      });
    }

    if (this.flash) {
      this.flash.color.copy(this.hexColors[3]);
    }

    const starLayers = [this.cosmicStars1, this.cosmicStars2, this.cosmicStars3].filter(Boolean);
    starLayers.forEach((stars) => {
      if (!stars.geometry?.attributes?.color) return;
      const colors = stars.geometry.attributes.color.array;
      const count = colors.length / 3;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        const c = (i % 5 === 0)
          ? new THREE.Color(this.isLight ? '#0f172a' : '#ffffff')
          : this.hexColors[i % this.hexColors.length].clone();

        if (this.isLight && i % 5 !== 0) {
          c.multiplyScalar(0.42);
        }
        colors[k] = c.r;
        colors[k + 1] = c.g;
        colors[k + 2] = c.b;
      }
      stars.geometry.attributes.color.needsUpdate = true;
      stars.material.blending = blend;
      stars.material.needsUpdate = true;
    });
  }

  makeRasenshuriken() {
    this.rasenshurikenGroup = new THREE.Group();
    this.rasenshurikenGroup.position.set(0, 0, 0);
    this.rasenshurikenGroup.rotation.x = 0.52;
    // Login page: 3.2 (clean & smaller!); post-login: 4.2
    this.rasenshurikenGroup.scale.setScalar(this.isPostLogin ? 4.2 : 3.2);
    this.scene.add(this.rasenshurikenGroup);

    this.modelMaterials = [];
    this.windNode = null;
    this.effectNode = null;
    this.rasenganNode = null;
    this.rasenshurikenModel = null;

    try {
      const loader = new GLTFLoader();
      loader.load(
        '/rasenshuriken/scene.gltf',
        (gltf) => {
          if (this.disposed) {
            gltf.scene?.traverse((obj) => {
              obj.geometry?.dispose?.();
              if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
              else obj.material?.dispose?.();
            });
            return;
          }

          this.rasenshurikenModel = gltf.scene;

          // Compute exact bounding box and center at local origin
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const center = new THREE.Vector3();
          box.getCenter(center);
          gltf.scene.position.sub(center);

          // Locate structural sub-nodes for individual rotational animations
          this.windNode = gltf.scene.getObjectByName('wind_0');
          this.effectNode = gltf.scene.getObjectByName('effect_3');
          this.rasenganNode = gltf.scene.getObjectByName('rasengan_11');

          // Collect materials and configure properties
          this.modelMaterials = [];
          gltf.scene.traverse((node) => {
            if (node.isMesh && node.material) {
              node.material = node.material.clone();
              node.material.transparent = true;
              node.material.depthWrite = false;
              node.material.side = THREE.DoubleSide;
              this.modelMaterials.push({
                name: node.name,
                material: node.material,
                parentName: node.parent?.name || ''
              });
            }
          });

          this.applyPaletteToModel();
          this.rasenshurikenGroup.add(gltf.scene);

          // Once the 3D glTF Rasenshuriken is loaded, smoothly hide procedural core
          if (this.coreGroup) {
            this.coreGroup.visible = false;
          }
          if (this.ringGroup) {
            this.ringGroup.visible = false;
          }
        },
        undefined,
        (err) => {
          console.warn('Rasenshuriken glTF loading fallback:', err?.message || err);
        }
      );
    } catch (e) {
      console.warn('GLTFLoader error:', e?.message || e);
    }
  }

  applyPaletteToModel() {
    if (!this.modelMaterials || this.modelMaterials.length === 0) return;
    const blend = this.isLight ? THREE.NormalBlending : THREE.AdditiveBlending;

    for (const item of this.modelMaterials) {
      const mat = item.material;
      const name = item.name;
      const parent = item.parentName;

      mat.blending = blend;
      mat.depthWrite = false;
      mat.transparent = true;

      // 4-Color Gradient Mapping across Rasenshuriken structural layers:
      // Stop 0 (hexColors[0]): Deep core chakra base
      // Stop 1 (hexColors[1]): Inner swirling vortex chakra
      // Stop 2 (hexColors[2]): Outer wind shuriken blades & energy shield
      // Stop 3 (hexColors[3]): Razor-sharp tip accents & radial shockwave aura
      if (name === 'Object_6' || parent.includes('wind') || parent.includes('Tube_2')) {
        // Outer 4 Wind Shuriken Blades
        mat.color.copy(this.hexColors[2]);
        mat.opacity = this.isLight ? 0.94 : 0.96;
      } else if (name === 'Object_27' || parent.includes('Sphere UV_14')) {
        // Inner dense Rasengan sphere core
        mat.color.copy(this.hexColors[0]);
        mat.opacity = this.isLight ? 0.96 : 0.98;
      } else if (name === 'Object_25' || parent.includes('Sphere UV 2_13')) {
        // Middle Rasengan sphere
        mat.color.copy(this.hexColors[1]);
        mat.opacity = this.isLight ? 0.86 : 0.76;
      } else if (name === 'Object_23' || parent.includes('Sphere UV 1_12')) {
        // Outer Rasengan boundary sphere
        mat.color.copy(this.hexColors[2]);
        mat.opacity = this.isLight ? 0.68 : 0.48;
      } else if (name === 'Object_17' || parent.includes('Radial_8')) {
        // Radial shockwave aura disc
        mat.color.copy(this.hexColors[3]);
        mat.opacity = this.isLight ? 0.88 : 0.80;
      } else if (name === 'Object_13' || parent.includes('Plane 1_6')) {
        // Outer vortex plane
        mat.color.copy(this.hexColors[3]);
        mat.opacity = this.isLight ? 0.86 : 0.78;
      } else if (name === 'Object_15' || parent.includes('Plane 2_7')) {
        // Diagonal energy plane
        mat.color.copy(this.hexColors[2]);
        mat.opacity = this.isLight ? 0.88 : 0.82;
      } else if (name === 'Object_11' || parent.includes('Plane_5')) {
        // Swirling vortex plane
        mat.color.copy(this.hexColors[0]);
        mat.opacity = this.isLight ? 0.90 : 0.85;
      } else if (name === 'Object_9' || parent.includes('Plane_4')) {
        // Spiral energy trails
        mat.color.copy(this.hexColors[1]);
        mat.opacity = this.isLight ? 0.92 : 0.88;
      } else if (name === 'Object_20' || parent.includes('Tube 1_10')) {
        // Vortex tube
        mat.color.copy(this.hexColors[1]);
        mat.opacity = this.isLight ? 0.88 : 0.85;
      } else {
        mat.color.copy(this.hexColors[1]);
        mat.opacity = this.isLight ? 0.88 : 0.85;
      }
      mat.needsUpdate = true;
    }
  }

  playImpact() {
    this.elapsed = 0;
    this.phase = 'CHARGING';
    if (this.rasenshurikenGroup) {
      this.rasenshurikenGroup.visible = true;
    }
    if (this.supernovaCore) {
      this.supernovaCore.scale.setScalar(0.01);
      this.supernovaCore.material.opacity = 0;
    }
    if (this.supernovaRings) {
      this.supernovaRings.forEach(r => {
        r.scale.setScalar(0.01);
        r.material.opacity = 0;
      });
    }
    if (this.supernovaRays) {
      this.supernovaRays.forEach(r => {
        r.scale.setScalar(0.01);
        r.material.opacity = 0;
      });
    }
    if (this.flash) {
      this.flash.intensity = 0;
    }
    if (this.coreGroup) this.coreGroup.visible = !this.rasenshurikenModel;
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;
    const rotMultiplier = this.reducedMotion ? 0.08 : 1;

    // Continuously rotate and sparkle the 6,000 full-screen 3D stars in the universe
    if (this.starfieldGroup) {
      this.starfieldGroup.rotation.y += dt * 0.008 * rotMultiplier;
      this.starfieldGroup.rotation.x += dt * 0.004 * rotMultiplier;
      this.starfieldGroup.rotation.z += dt * 0.003 * rotMultiplier;

      // Real-time dynamic sparkling & twinkling across full screen
      if (this.cosmicStars1?.material) {
        this.cosmicStars1.material.opacity = (this.isLight ? 0.72 : 0.85) + Math.sin(t * 1.8) * 0.12;
      }
      if (this.cosmicStars2?.material) {
        this.cosmicStars2.material.opacity = (this.isLight ? 0.68 : 0.80) + Math.sin(t * 2.7 + 1.2) * 0.16;
      }
      if (this.cosmicStars3?.material) {
        this.cosmicStars3.material.opacity = (this.isLight ? 0.62 : 0.78) + Math.sin(t * 3.6 + 2.5) * 0.20;
      }
    }

    // 1. Theme Change 1-Second Big Bang Mode (runs on the SAME Rasenshuriken!)
    if (this.isThemeTransitioning) {
      const p = Math.min(1.0, (performance.now() - this.themeTransitionStartedAt) / (this.themeTransitionDuration * 1000));
      const lightPeak = Math.max(0, 1.0 - p * 1.3);

      if (this.supernovaGroup) this.supernovaGroup.visible = true;
      if (this.supernovaLightGlow) {
        this.supernovaLightGlow.scale.setScalar(0.4 + p * 2.2);
        this.supernovaLightGlow.material.opacity = Math.max(0, 1.0 - p * 1.25) * 0.9;
      }
      if (this.supernovaCore) {
        this.supernovaCore.scale.setScalar(0.2 + p * 5.5);
        this.supernovaCore.material.opacity = Math.max(0, 1.0 - p * 1.3) * (this.isLight ? 0.88 : 0.95);
      }
      if (this.supernovaRings) {
        this.supernovaRings.forEach(ring => {
          ring.scale.setScalar(Math.max(0.1, p * (4.2 + ring.userData.speed)));
          ring.material.opacity = Math.max(0, 1.0 - p * 1.2) * (this.isLight ? 0.85 : 0.95);
          ring.rotation.x += dt * 2.0;
          ring.rotation.y += dt * 2.5;
        });
      }
      if (this.supernovaRaysGroup && this.supernovaRays) {
        this.supernovaRaysGroup.rotation.y += dt * 4.0;
        this.supernovaRays.forEach(ray => {
          ray.scale.setScalar(0.2 + p * 3.8);
          ray.material.opacity = Math.max(0, 1.0 - p * 1.2);
        });
      }
      if (this.flash) {
        this.flash.intensity = lightPeak * 45;
      }
      // Rapid spinning during 1s supernova theme transition
      if (this.windNode) {
        this.windNode.rotation.y += dt * 14.0 * rotMultiplier;
      }
      if (this.rasenganNode) {
        this.rasenganNode.rotation.y -= dt * 10.0 * rotMultiplier;
      }
      if (this.rasenshurikenGroup) {
        this.rasenshurikenGroup.rotation.y += dt * 8.0 * rotMultiplier;
        this.rasenshurikenGroup.rotation.z += dt * 3.5 * rotMultiplier;
        this.rasenshurikenGroup.scale.setScalar(this.isPostLogin ? 4.2 : 3.2);
      }

      if (p >= 1.0) {
        this.isThemeTransitioning = false;
        if (this.supernovaGroup) this.supernovaGroup.visible = !this.isPostLogin;
        if (this.supernovaLightGlow) this.supernovaLightGlow.material.opacity = 0;
        if (this.flash) this.flash.intensity = 0;
        if (this.rasenshurikenGroup) {
          this.rasenshurikenGroup.scale.setScalar(this.isPostLogin ? 4.2 : 3.2);
        }
      }
    }

    // 2. Post-Login Mode: No Big Bang, just slowly spin like planets with thousand of stars
    if (this.isPostLogin) {
      this.phase = 'COSMIC_ORBIT';
      if (!this.isThemeTransitioning) {
        if (this.supernovaGroup) this.supernovaGroup.visible = false;
        if (this.flash) this.flash.intensity = 0;
      }

      if (this.rasenshurikenGroup) {
        this.rasenshurikenGroup.scale.setScalar(4.2);
        this.rasenshurikenGroup.position.y = Math.sin(t * 0.4) * 0.08;
        this.rasenshurikenGroup.position.x = Math.cos(t * 0.3) * 0.05;
        this.rasenshurikenGroup.rotation.x = 0.48 + Math.sin(t * 0.35) * 0.02;
        this.rasenshurikenGroup.rotation.z = Math.sin(t * 0.25) * 0.015;

        // Slow planetary rotation like celestial bodies in deep space
        if (this.windNode && !this.isThemeTransitioning) {
          this.windNode.rotation.y += dt * 1.0 * rotMultiplier;
        }
        if (this.rasenganNode) {
          this.rasenganNode.rotation.y -= dt * 0.8 * rotMultiplier;
          this.rasenganNode.rotation.x += dt * 0.4 * rotMultiplier;
          this.rasenganNode.rotation.z += dt * 0.2 * rotMultiplier;
        }
        if (this.effectNode) {
          this.effectNode.rotation.y += dt * 0.6 * rotMultiplier;
          this.effectNode.scale.setScalar(1.0 + Math.sin(t * 1.5) * 0.02);
        }
      }

      // Gentle 3D camera drift in deep space
      this.camera.position.x = Math.sin(t * 0.2) * 0.12;
      this.camera.position.y = 0.35 + Math.sin(t * 0.28) * 0.08;
      this.camera.position.z = 9.6 + Math.sin(t * 0.16) * 0.12;
      this.camera.lookAt(0, 0, 0);

      // Core group scale
      this.coreGroup.scale.setScalar(0.4);
      this.coreGroup.rotation.y += dt * 0.6 * rotMultiplier;

      // Particles slowly drift like cosmic stardust
      const positions = this.particlePositions;
      for (let i = 0; i < this.particleCount; i++) {
        const k = i * 3;
        const velScale = 0.08 * dt * rotMultiplier;
        positions[k] += this.particleVelocities[k] * velScale;
        positions[k + 1] += this.particleVelocities[k + 1] * velScale;
        positions[k + 2] += this.particleVelocities[k + 2] * velScale;
        if (Math.hypot(positions[k], positions[k + 1]) > 3.0 || Math.abs(positions[k + 2]) > 3.5) {
          this.resetParticle(i);
        }
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.material.opacity = this.isLight ? 0.6 : 0.75;
      this.particles.material.size = this.isLight ? 0.028 : 0.022;

      if (this.bloom) {
        this.bloom.strength = 1.15;
      }

      return this.phase;
    }

    // 3. Login Page Mode: Exactly 8.0s duration, scale 4.8 (MORE BIGGER!)
    const dur = 8.0;
    const chargeEnd = dur * (3.6 / 8.0);      // 3.6s
    const singularityEnd = dur * (4.5 / 8.0); // 4.5s
    const blastEnd = dur * (6.6 / 8.0);       // 6.6s
    const recoveryEnd = dur;                   // 8.0s

    let coreScale = 0.1;
    let particleSpread = 1;
    let supernovaOpacity = 0;
    let flash = 0;

    if (t < chargeEnd) {
      this.phase = 'CHARGING';
      const p = t / chargeEnd;
      coreScale = 0.1 + 0.9 * Math.pow(p, 1.4);
      particleSpread = 0.5 + p * 0.5;
      this.coreGlow.material.opacity = this.isLight ? (0.25 + p * 0.3) : (0.15 + p * 0.22);
    } else if (t < singularityEnd) {
      this.phase = 'SINGULARITY';
      const p = (t - chargeEnd) / (singularityEnd - chargeEnd);
      coreScale = Math.max(0.65, 1.0 - p * 0.35 + Math.sin(t * 24) * 0.03);
      particleSpread = Math.max(0.3, 1.0 - p * 0.6);
      supernovaOpacity = p * 0.7;
      flash = 0.2 + p * 0.5;
    } else if (t < blastEnd) {
      this.phase = 'SUPERNOVA';
      const p = (t - singularityEnd) / (blastEnd - singularityEnd);
      coreScale = Math.max(0.04, 0.7 * (1 - p * 0.7) + 0.04);
      particleSpread = 1.0 + p * 4.5;
      supernovaOpacity = Math.max(0, 1.0 - p * 1.3);
      flash = Math.max(0, 1.0 - p * 1.8) * 3.5;
    } else {
      this.phase = 'RECOVERY';
      const p = Math.min(1, (t - blastEnd) / (recoveryEnd - blastEnd));
      coreScale = 0.4 + p * 0.6;
      particleSpread = 5.5 * (1 - p) + 1.0;
      supernovaOpacity = 0;
      flash = 0;
      if (t >= recoveryEnd) {
        if (this.options.autoLoop) {
          this.elapsed = 0;
        }
      }
    }

    if (this.options.onPhaseChange && this.lastReportedPhase !== this.phase) {
      this.lastReportedPhase = this.phase;
      this.options.onPhaseChange(this.phase);
    }

    // 3D glTF Rasenshuriken dynamic rotational & hovering animation on login (scale 3.2, clean & smaller!)
    if (this.rasenshurikenGroup) {
      const shurikenScale = this.phase === 'SUPERNOVA'
        ? Math.max(1.8, 3.2 * (1.0 + Math.sin((t - singularityEnd) * 1.2) * 0.15))
        : this.phase === 'SINGULARITY'
          ? Math.max(2.2, 3.2 - (t - chargeEnd) * 0.5)
          : 3.2;

      this.rasenshurikenGroup.scale.setScalar(shurikenScale);
      this.rasenshurikenGroup.position.y = Math.sin(t * 1.2) * 0.05;
      this.rasenshurikenGroup.rotation.x = 0.52 + Math.sin(t * 0.8) * 0.018;
      this.rasenshurikenGroup.rotation.z = Math.sin(t * 0.6) * 0.012;

      // Outer 4 Wind Blades rotate slower and smoother (majestic aerodynamic rotation)
      if (this.windNode && !this.isThemeTransitioning) {
        const windSpeed = (this.phase === 'SUPERNOVA' ? 4.8 : this.phase === 'SINGULARITY' ? 3.6 : 2.6);
        this.windNode.rotation.y += dt * windSpeed * rotMultiplier;
      }

      // Central Rasengan spheres rotate smoothly across multiple axes
      if (this.rasenganNode) {
        this.rasenganNode.rotation.y -= dt * 2.2 * rotMultiplier;
        this.rasenganNode.rotation.x += dt * 1.0 * rotMultiplier;
        this.rasenganNode.rotation.z += dt * 0.6 * rotMultiplier;
      }

      // Surrounding vortex aura and effect planes
      if (this.effectNode) {
        this.effectNode.rotation.y += dt * 1.8 * rotMultiplier;
        const pulse = 1.0 + Math.sin(t * 2.5) * 0.025;
        this.effectNode.scale.set(pulse, 1.0, pulse);
      }
    }

    // Supernova Big Bang Objects Animation on login
    if (!this.isThemeTransitioning) {
      if (this.supernovaLightGlow) {
        if (this.phase === 'SUPERNOVA') {
          const p = (t - singularityEnd) / (blastEnd - singularityEnd);
          this.supernovaLightGlow.scale.setScalar(0.4 + p * 2.0);
          this.supernovaLightGlow.material.opacity = Math.max(0, 1.0 - p * 1.2) * 0.9;
        } else {
          this.supernovaLightGlow.scale.setScalar(0.01);
          this.supernovaLightGlow.material.opacity = 0;
        }
      }

      if (this.supernovaCore) {
        if (this.phase === 'SUPERNOVA') {
          const p = (t - singularityEnd) / (blastEnd - singularityEnd);
          this.supernovaCore.scale.setScalar(0.2 + p * 5.2);
          this.supernovaCore.material.opacity = supernovaOpacity * (this.isLight ? 0.88 : 0.95);
        } else if (this.phase === 'SINGULARITY') {
          const p = (t - chargeEnd) / (singularityEnd - chargeEnd);
          this.supernovaCore.scale.setScalar(0.1 + p * 0.5);
          this.supernovaCore.material.opacity = supernovaOpacity * 0.7;
        } else {
          this.supernovaCore.scale.setScalar(0.01);
          this.supernovaCore.material.opacity = 0;
        }
      }

      if (this.supernovaRings) {
        this.supernovaRings.forEach(ring => {
          if (this.phase === 'SUPERNOVA') {
            const p = (t - singularityEnd) / (blastEnd - singularityEnd);
            const ringScale = Math.max(0.05, (p - ring.userData.delay) * (4.2 + ring.userData.speed));
            ring.scale.setScalar(ringScale);
            ring.material.opacity = Math.max(0, 1.0 - p * 1.2) * (this.isLight ? 0.8 : 0.9);
            ring.rotation.x = ring.userData.baseRotX + t * 0.8 * rotMultiplier;
            ring.rotation.y = ring.userData.baseRotY + t * 1.1 * rotMultiplier;
          } else {
            ring.scale.setScalar(0.01);
            ring.material.opacity = 0;
          }
        });
      }

      if (this.supernovaRaysGroup && this.supernovaRays) {
        if (this.phase === 'SUPERNOVA') {
          const p = (t - singularityEnd) / (blastEnd - singularityEnd);
          this.supernovaRaysGroup.rotation.y += dt * 0.9 * rotMultiplier;
          this.supernovaRaysGroup.rotation.z += dt * 0.6 * rotMultiplier;
          this.supernovaRays.forEach(ray => {
            ray.scale.setScalar(0.1 + p * (3.0 + ray.userData.speed));
            ray.material.opacity = Math.max(0, 1.0 - p * 1.3) * (this.isLight ? 0.75 : 0.85);
          });
        } else {
          this.supernovaRays.forEach(ray => {
            ray.scale.setScalar(0.01);
            ray.material.opacity = 0;
          });
        }
      }

      this.flash.intensity = flash * 45;
    }

    this.coreGroup.scale.setScalar(coreScale);
    this.coreGroup.rotation.y += dt * (this.phase === 'CHARGING' ? 1.2 : 2.0) * rotMultiplier;
    this.coreGroup.rotation.x += dt * 0.4 * rotMultiplier;
    this.ringGroup.rotation.x += dt * 0.2 * rotMultiplier;
    this.ringGroup.rotation.y -= dt * 0.35 * rotMultiplier;

    this.rings.forEach((ring, i) => {
      ring.scale.setScalar(0.65 + coreScale * 0.6 + Math.sin(t * 2.5 + i) * 0.03);
      ring.material.opacity = this.isLight ? (0.35 + coreScale * 0.45) : (0.22 + coreScale * 0.5);
    });

    this.coreGlow.material.opacity = this.isLight ? Math.min(0.65, 0.25 + coreScale * 0.35) : Math.min(0.55, 0.15 + coreScale * 0.35);
    this.outerGlow.material.opacity = this.isLight ? Math.min(0.35, 0.1 + coreScale * 0.2) : Math.min(0.22, 0.04 + coreScale * 0.12);

    // Particle dynamics: gathering during CHARGING, collapsing in SINGULARITY, blasting in SUPERNOVA
    const positions = this.particlePositions;
    for (let i = 0; i < this.particleCount; i++) {
      const k = i * 3;
      const velScale = (this.phase === 'SUPERNOVA' ? 2.2 : this.phase === 'CHARGING' ? -0.06 : 0.15) * dt * rotMultiplier;
      positions[k] += this.particleVelocities[k] * velScale * particleSpread;
      positions[k + 1] += this.particleVelocities[k + 1] * velScale * particleSpread;
      positions[k + 2] += this.particleVelocities[k + 2] * velScale;
      const limit = 2.2 + particleSpread * 0.8;
      if (Math.hypot(positions[k], positions[k + 1]) > limit || Math.abs(positions[k + 2]) > 3.5) {
        this.resetParticle(i);
      }
      if (this.phase === 'CHARGING') {
        positions[k] *= 1 - dt * 0.08;
        positions[k + 1] *= 1 - dt * 0.08;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.material.opacity = this.phase === 'SUPERNOVA' ? 0.98 : (this.isLight ? 0.75 + coreScale * 0.2 : 0.55 + coreScale * 0.3);
    this.particles.material.size = this.phase === 'SUPERNOVA' ? 0.042 : (this.isLight ? 0.035 : 0.024);

    if (this.stars) {
      this.stars.rotation.y += dt * 0.0015 * rotMultiplier;
    }

    this.camera.position.x = Math.sin(t * 0.5) * 0.04;
    this.camera.position.y = 0.35 + Math.sin(t * 0.8) * 0.025;
    this.camera.position.z = this.phase === 'SUPERNOVA' ? 9.6 - flash * 0.15 : 9.6;
    this.camera.lookAt(0, 0, 0);

    if (this.bloom) {
      this.bloom.strength = this.phase === 'SUPERNOVA' ? 1.85 : this.phase === 'SINGULARITY' ? 1.4 : 1.15;
    }

    return this.phase;
  }

  resize() {
    if (!this.renderer || !this.canvas) return;
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
  }

  animate() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    if (this.isTabHidden) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;
    this.update(dt);
    if (this.composer && !this.isLight) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    if (typeof document !== 'undefined' && this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.scene.traverse(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose?.();
    });
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}
