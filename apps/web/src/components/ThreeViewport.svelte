<script>
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import { ensureValidToken } from '#lib/api.js';

  let {
    glbUrl = null,
    liveKey = 0,
    height = '500px',
    meshCount = 0,
    triangleCount = 0,
    vertexCount = 0,
    isWatertight = true,
    turnaroundMode = false
  } = $props();

  let containerRef = $state(null);
  let containerResizeObserver = null;
  let loading = $state(false);
  let errorMessage = $state(null);

  // Viewport display controls
  let wireframe = $state(false);
  let autoRotate = $state(false);
  let lightingPreset = $state('studio'); // 'studio' | 'sunset' | 'cyberpunk'
  let fourViewEnabled = $state(false);
  let gridHelper = null;

  const TURNAROUND_VIEWS = [
    { key: 'front', label: 'FRONT', dir: [0, 0, 1] },
    { key: 'side', label: 'SIDE', dir: [1, 0, 0] },
    { key: 'back', label: 'BACK', dir: [0, 0, -1] },
    { key: 'top', label: 'TOP', dir: [0, 1, 0] }
  ];

  let scene, camera, renderer, controls, animationFrameId;
  let sceneReady = $state(false);
  let currentModel = null;
  let keyLight, fillLight, rimLight, ambientLight;

  // The container has an explicit CSS height (px, vh, clamp, ...) so measure it
  // instead of parsing the prop; falls back to the numeric prop value.
  function measureHeight(fallback = 500) {
    const measured = containerRef ? containerRef.clientHeight : 0;
    if (measured > 0) return measured;
    const parsed = parseInt(height, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function initThree() {
    if (!containerRef) return;

    const width = containerRef.clientWidth || 600;
    const heightPx = measureHeight();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    camera = new THREE.PerspectiveCamera(45, width / heightPx, 0.1, 1000);
    camera.position.set(0, 1.5, 3.5);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, heightPx);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;

    containerRef.innerHTML = '';
    containerRef.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 2.0;

    // Grid Floor
    gridHelper = new THREE.GridHelper(10, 20, 0x0284c7, 0x1e293b);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    // Setup Lighting
    ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(5, 10, 7);
    scene.add(keyLight);

    fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    rimLight = new THREE.DirectionalLight(0x818cf8, 1.5);
    rimLight.position.set(0, 8, -8);
    scene.add(rimLight);

    applyLightingPreset(lightingPreset);

    function animate() {
      animationFrameId = requestAnimationFrame(animate);
      controls.autoRotate = autoRotate && !fourViewEnabled;
      controls.update();
      if (fourViewEnabled) {
        renderTurnaround();
      } else {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        renderer.render(scene, camera);
      }
    }
    animate();

    window.addEventListener('resize', handleResize);
    // Container-driven resize (modal reflow, responsive height) — window resize alone misses it.
    if (typeof ResizeObserver !== 'undefined' && containerRef) {
      containerResizeObserver = new ResizeObserver(() => handleResize());
      containerResizeObserver.observe(containerRef);
    }
    sceneReady = true;
  }

  function twoViewSize() {
    const w = containerRef.clientWidth || 600;
    const h = measureHeight();
    return { w, h };
  }

  function renderTurnaround() {
    const { w, h } = twoViewSize();
    const plotW = Math.floor(w / 4);
    gridHelper.visible = false;
    renderer.setScissorTest(true);
    scene.background = new THREE.Color(0xd4d4d8);
    TURNAROUND_VIEWS.forEach((view, index) => {
      const left = index * plotW;
      const width = index === TURNAROUND_VIEWS.length - 1 ? w - left : plotW;
      camera.position.set(view.dir[0] * 4.2, view.dir[1] * 4.2 + (view.dir[1] === 0 ? 1.0 : 0), view.dir[2] * 4.2);
      camera.lookAt(new THREE.Vector3(0, 0.7, 0));
      camera.updateMatrixWorld();
      renderer.setViewport(left, 0, width, h);
      renderer.setScissor(left, 0, width, h);
      renderer.render(scene, camera);
    });
    renderer.setScissorTest(false);
    gridHelper.visible = true;
    scene.background = new THREE.Color(0x0f172a);
    applyLightingPreset(lightingPreset);
    camera.position.set(0, 1.5, 3.5);
    controls.update();
  }

  function toggleFourView() {
    fourViewEnabled = !fourViewEnabled;
    controls.enabled = !fourViewEnabled;
    if (!fourViewEnabled) {
      applyLightingPreset(lightingPreset);
      resetCamera();
    }
  }

  function handleResize() {
    if (!containerRef || !renderer || !camera) return;
    const width = containerRef.clientWidth;
    const heightPx = measureHeight();
    camera.aspect = width / heightPx;
    camera.updateProjectionMatrix();
    renderer.setSize(width, heightPx);
  }

  function applyLightingPreset(preset) {
    if (!keyLight || !fillLight || !rimLight || !ambientLight) return;
    if (preset === 'studio') {
      scene.background = new THREE.Color(0x0f172a);
      ambientLight.color.setHex(0xffffff);
      ambientLight.intensity = 0.8;
      keyLight.color.setHex(0xffffff);
      keyLight.intensity = 2.0;
      fillLight.color.setHex(0x38bdf8);
      fillLight.intensity = 1.0;
    } else if (preset === 'sunset') {
      scene.background = new THREE.Color(0x1a0b1e);
      ambientLight.color.setHex(0xffedd5);
      ambientLight.intensity = 0.6;
      keyLight.color.setHex(0xf97316);
      keyLight.intensity = 2.4;
      fillLight.color.setHex(0xc084fc);
      fillLight.intensity = 1.2;
    } else if (preset === 'cyberpunk') {
      scene.background = new THREE.Color(0x060913);
      ambientLight.color.setHex(0x06b6d4);
      ambientLight.intensity = 0.5;
      keyLight.color.setHex(0x06b6d4);
      keyLight.intensity = 2.2;
      fillLight.color.setHex(0xf43f5e);
      fillLight.intensity = 1.8;
    }
  }

  function toggleWireframe() {
    wireframe = !wireframe;
    if (!currentModel) return;
    currentModel.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.wireframe = wireframe);
        } else {
          child.material.wireframe = wireframe;
        }
      }
    });
  }

  function resetCamera() {
    if (!camera || !controls) return;
    camera.position.set(0, 1.5, 3.5);
    controls.target.set(0, 0.7, 0);
    controls.update();
  }

  function attachModel(gltf, preserveCamera) {
    const previousCamera = preserveCamera && camera && controls
      ? { position: camera.position.clone(), target: controls.target.clone() }
      : null;

    if (currentModel) {
      scene.remove(currentModel);
      disposeObjectTree(currentModel);
    }
    currentModel = gltf.scene;

    const bbox = new THREE.Box3().setFromObject(currentModel);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.8 / maxDim;

    currentModel.scale.set(scale, scale, scale);
    currentModel.position.sub(center.multiplyScalar(scale));
    currentModel.position.y += (size.y * scale) / 2;

    currentModel.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (!wireframe || !child.material) return;
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => { mat.wireframe = true; });
      } else {
        child.material.wireframe = true;
      }
    });

    scene.add(currentModel);
    handleResize();

    if (previousCamera) {
      camera.position.copy(previousCamera.position);
      controls.target.copy(previousCamera.target);
      controls.update();
    } else {
      resetCamera();
    }
  }

  function disposeObjectTree(root) {
    root.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (!child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
    });
  }

  async function loadGlb(url, preserveCamera = false) {
    if (!url || !scene || !containerRef) return;
    loading = true;
    errorMessage = null;

    const fetchUrl = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
    try {
      const token = await ensureValidToken();
      const response = await fetch(fetchUrl, {
        credentials: 'same-origin',
        headers: token ? { 'X-Konoha-Web-Token': token } : {}
      });
      if (!response.ok) {
        throw new Error(`fetch for "${fetchUrl}" responded with ${response.status}: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      const loader = new GLTFLoader();
      loader.parse(buffer, '', (gltf) => {
        attachModel(gltf, preserveCamera);
        loading = false;
      }, (err) => {
        loading = false;
        errorMessage = `Failed to load 3D model: ${err?.message || 'Parse error'}`;
      });
    } catch (err) {
      loading = false;
      errorMessage = `Failed to load 3D model: ${err?.message || 'Network or parse error'}`;
    }
  }

  $effect(() => {
    const url = glbUrl;
    const key = liveKey;
    if (url && sceneReady && scene) {
      loadGlb(url, Boolean(currentModel) && key > 0);
    }
  });

  $effect(() => {
    applyLightingPreset(lightingPreset);
  });

  $effect(() => {
    const shouldEnable = Boolean(turnaroundMode);
    if (shouldEnable !== fourViewEnabled) {
      fourViewEnabled = shouldEnable;
      if (controls) controls.enabled = !shouldEnable;
    }
  });

  onMount(() => {
    initThree();
  });

  onDestroy(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
      if (containerResizeObserver) {
        containerResizeObserver.disconnect();
        containerResizeObserver = null;
      }
    }
    if (renderer) renderer.dispose();
  });
</script>

<div class="relative w-full rounded-[5px] overflow-hidden border" style="height: {height}; border-color: var(--color-border); background-color: #0f172a;">
  <!-- Viewport DOM Container -->
  <div bind:this={containerRef} class="w-full h-full cursor-grab active:cursor-grabbing"></div>

  <!-- Loading Overlay -->
  {#if loading}
    <div class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs z-20">
      <div class="w-10 h-10 border-4 border-accent-themed border-t-transparent rounded-full animate-spin"></div>
      <span class="mt-3 text-xs font-bold text-accent-themed uppercase tracking-widest">Hot-Reloading Viewport...</span>
    </div>
  {/if}

  <!-- Error Message -->
  {#if errorMessage}
    <div class="absolute inset-0 flex items-center justify-center bg-red-950/70 p-6 z-20">
      <div class="text-center max-w-md">
        <p class="text-xs font-bold text-status-danger">{errorMessage}</p>
      </div>
    </div>
  {/if}

  <!-- Top-Right Controls Toolbar -->
  <div class="absolute top-3 right-3 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md p-1.5 rounded-[5px] border border-slate-700/60 z-10 shadow-lg">
    <!-- 4-View Turnaround Toggle -->
    <button
      type="button"
      onclick={toggleFourView}
      class="px-2 py-1 text-[11px] font-bold rounded transition-all cursor-pointer {fourViewEnabled ? 'bg-action-primary text-surface-contrast font-bold' : 'text-muted-themed hover:text-foreground-themed bg-surface-muted'}"
      title="Toggle 4-View Orthographic Turnaround (Front / Side / Back / Top)"
    >
      4-View
    </button>

    <!-- Auto-Rotate Toggle -->
    <button
      type="button"
      onclick={() => autoRotate = !autoRotate}
      class="px-2 py-1 text-[11px] font-bold rounded transition-all cursor-pointer {autoRotate ? 'bg-action-primary text-surface-contrast font-bold' : 'text-muted-themed hover:text-foreground-themed bg-surface-muted'}"
      title="Toggle Turntable Auto-Rotation"
    >
      Rotate
    </button>

    <!-- Wireframe Toggle -->
    <button
      type="button"
      onclick={toggleWireframe}
      class="px-2 py-1 text-[11px] font-bold rounded transition-all cursor-pointer {wireframe ? 'bg-action-primary text-surface-contrast font-bold' : 'text-muted-themed hover:text-foreground-themed bg-surface-muted'}"
      title="Toggle Mesh Wireframe Mode"
    >
      Wireframe
    </button>

    <!-- Lighting Preset Selector -->
    <select
      bind:value={lightingPreset}
      class="px-2 py-1 text-[11px] font-bold rounded bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer focus:outline-hidden"
    >
      <option value="studio">Studio</option>
      <option value="sunset">Sunset</option>
      <option value="cyberpunk">Cyberpunk</option>
    </select>

    <!-- Camera Reset -->
    <button
      type="button"
      onclick={resetCamera}
      class="px-2 py-1 text-[11px] font-bold rounded bg-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer"
      title="Reset Viewport Camera"
    >
      Reset
    </button>
  </div>

  <!-- Turnaround View Labels -->
  {#if fourViewEnabled}
    <div class="absolute top-3 left-3 right-44 flex gap-1 z-10 pointer-events-none">
      {#each TURNAROUND_VIEWS as view}
        <span class="flex-1 text-center text-[10px] font-bold tracking-widest text-foreground-themed bg-surface-tint backdrop-blur-xs py-0.5 rounded-[3px]">{view.label}</span>
      {/each}
    </div>
  {/if}

  <!-- Bottom-Left Geometry Badges -->
  <div class="absolute bottom-3 left-3 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-[5px] border border-slate-700/60 z-10 text-[11px] font-mono text-slate-300">
    <div class="flex items-center gap-1.5">
      <span class="w-2 h-2 rounded-full {isWatertight ? 'bg-status-success animate-pulse' : 'bg-status-warning'}"></span>
      <span class="font-bold">{isWatertight ? 'Watertight Manifold' : 'Mesh Warning'}</span>
    </div>
    <span class="text-muted-themed">|</span>
    <span><strong>{(triangleCount || 0).toLocaleString()}</strong> Δ tris</span>
    <span class="text-muted-themed">|</span>
    <span><strong>{(vertexCount || 0).toLocaleString()}</strong> vertices</span>
  </div>
</div>
