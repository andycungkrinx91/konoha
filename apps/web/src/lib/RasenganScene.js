import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  createCosmicOrbTexture,
  createSupernovaLightTexture,
  makeSupernovaBigBang,
  applyPaletteToSupernova
} from './rasengan/supernova.js';

import {
  makeCosmicUniverseStarfield,
  makeEnvironment
} from './rasengan/starfield.js';

import {
  makeCore,
  makeEnergyRibbons,
  makeParticles,
  resetParticle,
  makeRasenshuriken,
  applyPaletteToModel
} from './rasengan/geometry.js';

import {
  updateThemeTransition,
  updatePostLogin,
  updateLoginCycle
} from './rasengan/animator.js';

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
      mode: 'dark',
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

    this.setupScene();
    this.setupLights();
    this.setupComponents();
    this.setupComposer();
    this.setupListeners();

    this.resize();
    this.playImpact();
    this.animate();
  }

  setupScene() {
    this.scene = new THREE.Scene();
    if (!this.options.transparent && !this.isLight) {
      this.scene.background = new THREE.Color(this.options.bgColor);
      this.scene.fog = new THREE.FogExp2(this.options.fogColor, 0.035);
    }

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0.35, 9.6);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: !!this.options.transparent || this.isLight,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, this.options.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.isLight ? 1.05 : 1.22;
  }

  setupLights() {
    this.ambientLight = new THREE.AmbientLight(this.hexColors[0], this.isLight ? 2.0 : 1.4);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.PointLight(this.hexColors[1], this.isLight ? 60 : 100, 18);
    this.keyLight.position.set(2, 2.5, 4);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.PointLight(this.hexColors[2], this.isLight ? 50 : 75, 14);
    this.rimLight.position.set(-3, -1, 2);
    this.scene.add(this.rimLight);
  }

  setupComponents() {
    const env = makeEnvironment(this.scene, this.hexColors, this.isLight, this.options);
    if (env) {
      this.floor = env.floor;
      this.grid = env.grid;
      this.stars = env.stars;
    }

    this.orbTexture = createCosmicOrbTexture();
    const starfield = makeCosmicUniverseStarfield(this.scene, this.orbTexture, this.isLight, this.hexColors);
    this.starfieldGroup = starfield.starfieldGroup;
    this.cosmicStars1 = starfield.cosmicStars1;
    this.cosmicStars2 = starfield.cosmicStars2;
    this.cosmicStars3 = starfield.cosmicStars3;
    this.cosmicStarCount = starfield.cosmicStarCount;
    this.cosmicStars = starfield.cosmicStars;

    const coreObj = makeCore(this.scene, this.hexColors, this.isLight);
    this.coreGroup = coreObj.coreGroup;
    this.core = coreObj.core;
    this.coreGlow = coreObj.coreGlow;
    this.outerGlow = coreObj.outerGlow;

    const ribbonsObj = makeEnergyRibbons(this.scene, this.hexColors, this.isLight, this.coreGroup);
    this.ribbons = ribbonsObj.ribbons;
    this.ringGroup = ribbonsObj.ringGroup;
    this.rings = ribbonsObj.rings;

    const particlesObj = makeParticles(this.scene, this.hexColors, this.isLight);
    this.particles = particlesObj.particles;
    this.particlePositions = particlesObj.particlePositions;
    this.particleVelocities = particlesObj.particleVelocities;
    this.particleSeeds = particlesObj.particleSeeds;
    this.particleCount = particlesObj.particleCount;

    const supernovaObj = makeSupernovaBigBang(this.scene, this.hexColors, this.isLight);
    this.supernovaGroup = supernovaObj.supernovaGroup;
    this.supernovaCore = supernovaObj.supernovaCore;
    this.supernovaRings = supernovaObj.supernovaRings;
    this.supernovaRaysGroup = supernovaObj.supernovaRaysGroup;
    this.supernovaRays = supernovaObj.supernovaRays;
    this.supernovaLightGlow = supernovaObj.supernovaLightGlow;
    this.flash = supernovaObj.flash;

    this.rasenshurikenGroup = makeRasenshuriken({
      scene: this.scene,
      hexColors: this.hexColors,
      isLight: this.isLight,
      isPostLogin: this.isPostLogin,
      isDisposed: () => this.disposed,
      onLoaded: (loaded) => {
        this.rasenshurikenModel = loaded.scene;
        this.modelMaterials = loaded.modelMaterials;
        this.windNode = loaded.windNode;
        this.effectNode = loaded.effectNode;
        this.rasenganNode = loaded.rasenganNode;
        if (this.coreGroup) this.coreGroup.visible = false;
        if (this.ringGroup) this.ringGroup.visible = false;
      }
    });
  }

  setupComposer() {
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
  }

  setupListeners() {
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
  }

  parseColors(colors) {
    const list = Array.isArray(colors) && colors.length > 0 ? colors : ['#0369A1', '#0284C7', '#075985', '#0E7490'];
    const parsed = list.map((c) => new THREE.Color(c));
    while (parsed.length < 4) {
      parsed.push(parsed[0].clone());
    }
    return parsed;
  }

  resetParticle(i, initial = false) {
    resetParticle({
      positions: this.particlePositions,
      velocities: this.particleVelocities,
      seeds: this.particleSeeds
    }, i, initial);
  }

  createCosmicOrbTexture() {
    return createCosmicOrbTexture();
  }

  createSupernovaLightTexture() {
    return createSupernovaLightTexture();
  }

  applyPaletteToModel() {
    applyPaletteToModel(this.modelMaterials, this.hexColors, this.isLight);
  }

  applyPaletteToSupernova() {
    applyPaletteToSupernova({
      supernovaGroup: this.supernovaGroup,
      supernovaCore: this.supernovaCore,
      supernovaRings: this.supernovaRings,
      supernovaRays: this.supernovaRays,
      supernovaLightGlow: this.supernovaLightGlow,
      flash: this.flash
    }, this.hexColors, this.isLight);
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
        m.material.opacity = 0.92;
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
    if (this.flash) this.flash.color.copy(this.hexColors[3]);
    if (this.keyLight) this.keyLight.color.copy(this.hexColors[1]);
    if (this.rimLight) this.rimLight.color.copy(this.hexColors[2]);
    if (this.ambientLight) this.ambientLight.color.copy(this.hexColors[0]);
    if (this.stars?.material) this.stars.material.color.copy(this.hexColors[2]);
  }

  setPostLoginMode(isPostLogin) {
    this.isPostLogin = Boolean(isPostLogin);
    if (this.isPostLogin) {
      if (this.supernovaGroup) this.supernovaGroup.visible = false;
      if (this.flash) this.flash.intensity = 0;
      this.phase = 'COSMIC_ORBIT';
      if (this.rasenshurikenGroup) this.rasenshurikenGroup.scale.setScalar(4.2);
    } else {
      if (this.supernovaGroup) this.supernovaGroup.visible = true;
      this.phase = 'CHARGING';
      this.phaseDuration = 8.0;
      if (this.rasenshurikenGroup) this.rasenshurikenGroup.scale.setScalar(3.2);
    }
  }

  triggerThemeSupernova(newColors, mode = null) {
    this.updatePalette(newColors, mode);
    this.isThemeTransitioning = true;
    this.themeTransitionStartedAt = performance.now();
    this.themeTransitionDuration = 1.0;
    if (this.supernovaGroup) {
      this.supernovaGroup.visible = true;
    }
  }

  playImpact() {
    this.elapsed = 0;
    this.phase = 'CHARGING';
    if (this.rasenshurikenGroup) this.rasenshurikenGroup.visible = true;
    if (this.supernovaCore) {
      this.supernovaCore.scale.setScalar(0.01);
      this.supernovaCore.material.opacity = 0;
    }
    if (this.supernovaRings) {
      this.supernovaRings.forEach((r) => {
        r.scale.setScalar(0.01);
        r.material.opacity = 0;
      });
    }
    if (this.supernovaRays) {
      this.supernovaRays.forEach((r) => {
        r.scale.setScalar(0.01);
        r.material.opacity = 0;
      });
    }
    if (this.flash) this.flash.intensity = 0;
    if (this.coreGroup) this.coreGroup.visible = !this.rasenshurikenModel;
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;
    const rotMultiplier = this.reducedMotion ? 0.08 : 1;

    if (this.starfieldGroup) {
      this.starfieldGroup.rotation.y += dt * 0.008 * rotMultiplier;
      this.starfieldGroup.rotation.x += dt * 0.004 * rotMultiplier;
      this.starfieldGroup.rotation.z += dt * 0.003 * rotMultiplier;

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

    if (this.isThemeTransitioning) {
      updateThemeTransition(this, dt, rotMultiplier);
    }

    if (this.isPostLogin) {
      return updatePostLogin(this, dt, t, rotMultiplier);
    }

    return updateLoginCycle(this, dt, t, rotMultiplier);
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
    this.scene.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material?.dispose?.();
    });
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}
