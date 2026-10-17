import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Procedural Rasengan scene built with Three.js.
 * Ported 100% faithfully from ~/Downloads/rasengan-threejs/src/RasenganScene.js,
 * enhanced with dynamic theme palette colors and optional onPhaseChange callback.
 */
export class RasenganScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      bloom: true,
      pixelRatioCap: 1.75,
      colors: ['#11aaff', '#45eaff', '#075dff', '#9beeff', '#167aff'],
      bgColor: '#020611',
      fogColor: '#030b1b',
      onPhaseChange: null,
      autoLoop: true,
      phaseDuration: 8.8,
      ...options
    };
    this.lastTime = performance.now();
    this.elapsed = 0;
    this.phase = 'CHARGING';
    this.phaseDuration = this.options.phaseDuration;
    this.disposed = false;
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.bgColor);
    this.scene.fog = new THREE.FogExp2(this.options.fogColor, 0.035);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0.35, 9.6);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, this.options.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;

    this.ambientLight = new THREE.AmbientLight(0x174b8c, 1.4);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.PointLight(0x168eff, 100, 18);
    this.keyLight.position.set(2, 2.5, 4);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.PointLight(0x08d9ff, 75, 14);
    this.rimLight.position.set(-3, -1, 2);
    this.scene.add(this.rimLight);

    this.makeEnvironment();
    this.makeCore();
    this.makeEnergyRibbons();
    this.makeParticles();
    this.makeGlass();
    this.makeShockwave();
    this.makeCrackOverlay();

    if (this.options.bloom) {
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
    this.resize();
    this.playImpact();
    this.animate();
  }

  updatePalette(colors, bgColor = null) {
    if (!colors || colors.length === 0) return;
    const hexColors = colors.map(c => new THREE.Color(c));
    if (bgColor) {
      this.scene.background = new THREE.Color(bgColor);
      this.scene.fog.color = new THREE.Color(bgColor);
    }
    if (this.core) {
      this.core.material.color.copy(hexColors[1] || hexColors[0]);
    }
    if (this.coreGlow) {
      this.coreGlow.material.color.copy(hexColors[0]);
    }
    if (this.outerGlow) {
      this.outerGlow.material.color.copy(hexColors[2] || hexColors[0]);
    }
    if (this.ribbons) {
      this.ribbons.forEach((m, idx) => {
        m.material.color.copy(hexColors[idx % hexColors.length]);
      });
    }
    if (this.rings) {
      this.rings.forEach((r, idx) => {
        r.material.color.copy(hexColors[idx % hexColors.length]);
      });
    }
    if (this.particles) {
      this.particles.material.color.copy(hexColors[1] || hexColors[0]);
    }
    if (this.keyLight) {
      this.keyLight.color.copy(hexColors[0]);
    }
    if (this.rimLight) {
      this.rimLight.color.copy(hexColors[2] || hexColors[0]);
    }
  }

  makeEnvironment() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x030a16, roughness: 0.3, metalness: 0.6 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(80, 80, 0x0a4d85, 0x082344);
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
      new THREE.PointsMaterial({ color: 0x4abfff, size: 0.018, transparent: true, opacity: 0.65 })
    );
    this.scene.add(this.stars);
  }

  makeCore() {
    this.coreGroup = new THREE.Group();
    this.scene.add(this.coreGroup);

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x8beaff })
    );
    this.coreGroup.add(this.core);

    this.coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x008dff, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.coreGroup.add(this.coreGlow);

    this.outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x006aff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.coreGroup.add(this.outerGlow);
    this.coreGroup.scale.setScalar(0.05);
  }

  makeEnergyRibbons() {
    this.ribbons = [];
    const colors = [0x11aaff, 0x45eaff, 0x075dff, 0x9beeff, 0x167aff];
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
        new THREE.MeshBasicMaterial({ color: colors[r % colors.length], transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false })
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
        new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending })
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
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x54dfff, size: 0.035, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
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

  makeGlass() {
    this.glassGroup = new THREE.Group();
    this.scene.add(this.glassGroup);
    this.shards = [];
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x9bdcff, metalness: 0.15, roughness: 0.12, transmission: 0.35,
      transparent: true, opacity: 0.78, thickness: 0.25, ior: 1.35,
      emissive: 0x0b4d9e, emissiveIntensity: 0.65, side: THREE.DoubleSide
    });
    for (let i = 0; i < 54; i++) {
      const angle = (i / 54) * Math.PI * 2 + (Math.random() - 0.5) * 0.13;
      const radius = 1.2 + Math.random() * 1.15;
      const w = 0.13 + Math.random() * 0.3;
      const h = 0.2 + Math.random() * 0.52;
      const shape = new THREE.Shape();
      shape.moveTo(0, h * 0.65);
      shape.lineTo(w * 0.5, -h * 0.35);
      shape.lineTo(-w * (0.3 + Math.random() * 0.4), -h * 0.5);
      shape.closePath();
      const geometry = new THREE.ShapeGeometry(shape);
      const shard = new THREE.Mesh(geometry, material.clone());
      shard.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, (Math.random() - 0.5) * 1.1);
      shard.rotation.set(Math.random() * 3, Math.random() * 3, angle);
      shard.userData = {
        home: shard.position.clone(),
        homeRotation: shard.rotation.clone(),
        velocity: new THREE.Vector3(Math.cos(angle) * (1 + Math.random() * 2), Math.sin(angle) * (1 + Math.random() * 2), (Math.random() - 0.5) * 2),
        spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        delay: Math.random() * 0.42,
        seed: Math.random()
      };
      shard.visible = false;
      this.glassGroup.add(shard);
      this.shards.push(shard);
    }
  }

  makeShockwave() {
    this.shockwave = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.035, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0x42dcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.shockwave.rotation.x = 0.3;
    this.shockwave.scale.setScalar(0.01);
    this.scene.add(this.shockwave);
    this.flash = new THREE.PointLight(0x55dfff, 0, 16);
    this.flash.position.set(0, 0, 2);
    this.scene.add(this.flash);
  }

  makeCrackOverlay() {
    this.crackGroup = new THREE.Group();
    this.scene.add(this.crackGroup);
    const mat = new THREE.LineBasicMaterial({ color: 0x7deaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
    for (let ray = 0; ray < 18; ray++) {
      let angle = (ray / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.14;
      let x = 0;
      let y = 0;
      const points = [new THREE.Vector3(x, y, 0)];
      const length = 1.4 + Math.random() * 1.05;
      const steps = 4 + Math.floor(Math.random() * 4);
      for (let s = 0; s < steps; s++) {
        angle += (Math.random() - 0.5) * 0.42;
        const d = (length / steps) * (0.75 + Math.random() * 0.5);
        x += Math.cos(angle) * d;
        y += Math.sin(angle) * d;
        points.push(new THREE.Vector3(x, y, 0));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), mat.clone());
      line.position.z = 0.95;
      line.visible = false;
      this.crackGroup.add(line);
      for (let b = 0; b < 2; b++) {
        const index = 1 + Math.floor(Math.random() * (points.length - 1));
        const p = points[index];
        const branchAngle = angle + (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.8);
        const branchEnd = p.clone().add(new THREE.Vector3(Math.cos(branchAngle) * (0.2 + Math.random() * 0.5), Math.sin(branchAngle) * (0.2 + Math.random() * 0.5), 0));
        const branch = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, branchEnd]), mat.clone());
        branch.position.z = 0.96;
        branch.visible = false;
        this.crackGroup.add(branch);
      }
    }
  }

  playImpact() {
    this.elapsed = 0;
    this.phase = 'CHARGING';
    this.shards.forEach(s => {
      s.visible = false;
      s.position.copy(s.userData.home);
      s.rotation.copy(s.userData.homeRotation);
    });
    this.crackGroup.children.forEach(c => {
      c.visible = false;
      c.material.opacity = 0;
    });
    this.shockwave.scale.setScalar(0.01);
    this.shockwave.material.opacity = 0;
    this.flash.intensity = 0;
    this.coreGroup.visible = true;
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;
    // Normalized phase timeline relative to total duration
    const dur = this.phaseDuration;
    const chargeEnd = dur * (2.6 / 8.8);
    const crackEnd = dur * (3.35 / 8.8);
    const blastEnd = dur * (5.6 / 8.8);
    const recoveryEnd = dur;

    let coreScale = 0.05;
    let particleSpread = 1;
    let crackOpacity = 0;
    let flash = 0;

    if (t < chargeEnd) {
      this.phase = 'CHARGING';
      const p = t / chargeEnd;
      coreScale = 0.05 + 0.88 * p * p;
      particleSpread = 0.65 + p * 0.35;
      this.coreGlow.material.opacity = 0.15 + p * 0.22;
    } else if (t < crackEnd) {
      this.phase = 'GLASS FRACTURE';
      coreScale = 0.93 + Math.sin(t * 35) * 0.035;
      crackOpacity = Math.min(1, (t - chargeEnd) / (dur * 0.02)) * 0.95;
      flash = 0.3;
    } else if (t < blastEnd) {
      this.phase = 'EXPLOSION';
      const p = (t - crackEnd) / (blastEnd - crackEnd);
      coreScale = Math.max(0.04, 1.02 * (1 - p) + 0.04);
      particleSpread = 1 + p * 5;
      crackOpacity = Math.max(0, 1 - p * 1.6);
      flash = Math.max(0, 1 - p * 3) * 3;
      const shockP = Math.min(1, p * 1.5);
      this.shockwave.scale.setScalar(0.01 + shockP * 4.8);
      this.shockwave.material.opacity = Math.max(0, 1 - shockP) * 0.85;
    } else {
      this.phase = 'RECOVERY';
      const p = Math.min(1, (t - blastEnd) / (recoveryEnd - blastEnd));
      coreScale = 0.04 + p * 0.42;
      particleSpread = 5.5 * (1 - p) + 1;
      crackOpacity = 0;
      if (t > recoveryEnd) {
        if (this.options.autoLoop) {
          this.elapsed = 0;
        }
      }
    }

    if (this.options.onPhaseChange && this.lastReportedPhase !== this.phase) {
      this.lastReportedPhase = this.phase;
      this.options.onPhaseChange(this.phase);
    }

    this.coreGroup.scale.setScalar(coreScale);
    this.coreGroup.rotation.y += dt * (this.phase === 'CHARGING' ? 1.8 : 3.5);
    this.coreGroup.rotation.x += dt * 0.6;
    this.ringGroup.rotation.x += dt * 0.3;
    this.ringGroup.rotation.y -= dt * 0.55;

    this.rings.forEach((ring, i) => {
      ring.scale.setScalar(0.65 + coreScale * 0.6 + Math.sin(t * 3 + i) * 0.04);
      ring.material.opacity = 0.22 + coreScale * 0.5;
    });

    this.coreGlow.material.opacity = Math.min(0.55, 0.15 + coreScale * 0.35);
    this.outerGlow.material.opacity = Math.min(0.22, 0.04 + coreScale * 0.12);
    this.flash.intensity = flash * 85;

    this.crackGroup.children.forEach(c => {
      c.visible = crackOpacity > 0.01;
      c.material.opacity = crackOpacity;
    });

    this.shards.forEach(s => {
      const u = s.userData;
      if (t >= crackEnd + u.delay && t < blastEnd + 0.2) s.visible = true;
      if (t >= crackEnd + u.delay && t < blastEnd) {
        const p = Math.min(1, (t - crackEnd - u.delay) / (blastEnd - crackEnd));
        s.position.copy(u.home).addScaledVector(u.velocity, p * 1.65);
        s.rotation.x = u.homeRotation.x + u.spin.x * p;
        s.rotation.y = u.homeRotation.y + u.spin.y * p;
        s.rotation.z = u.homeRotation.z + u.spin.z * p;
        s.material.opacity = 0.8 * (1 - p * 0.45);
      } else if (t >= blastEnd) {
        s.visible = false;
      }
    });

    const positions = this.particlePositions;
    for (let i = 0; i < this.particleCount; i++) {
      const k = i * 3;
      const velScale = (this.phase === 'EXPLOSION' ? 2.8 : this.phase === 'CHARGING' ? -0.12 : 0.25) * dt;
      positions[k] += this.particleVelocities[k] * velScale * particleSpread;
      positions[k + 1] += this.particleVelocities[k + 1] * velScale * particleSpread;
      positions[k + 2] += this.particleVelocities[k + 2] * velScale;
      const limit = 1.8 + particleSpread * 0.75;
      if (Math.hypot(positions[k], positions[k + 1]) > limit || Math.abs(positions[k + 2]) > 3) {
        this.resetParticle(i);
      }
      if (this.phase === 'CHARGING') {
        positions[k] *= 1 - dt * 0.12;
        positions[k + 1] *= 1 - dt * 0.12;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.material.opacity = this.phase === 'EXPLOSION' ? 0.98 : 0.55 + coreScale * 0.3;
    this.particles.material.size = this.phase === 'EXPLOSION' ? 0.045 : 0.025;

    this.stars.rotation.y += dt * 0.002;
    this.camera.position.x = Math.sin(t * 0.7) * 0.055;
    this.camera.position.y = 0.35 + Math.sin(t * 1.2) * 0.035;
    this.camera.position.z = this.phase === 'EXPLOSION' ? 9.6 - flash * 0.12 : 9.6;
    this.camera.lookAt(0, 0, 0);

    if (this.bloom) {
      this.bloom.strength = this.phase === 'EXPLOSION' ? 1.75 : this.phase === 'CHARGING' ? 1.05 + coreScale * 0.4 : 1.2;
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
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;
    this.update(dt);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
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
