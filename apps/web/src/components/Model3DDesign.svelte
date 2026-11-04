<script>
  import { onMount } from 'svelte';
  import { apiRequest } from '#lib/api.js';
  import { toast } from '#lib/state/toast.svelte.ts';
  import PageHero from './PageHero.svelte';
  import ThreeViewport from './ThreeViewport.svelte';
  import BlenderPipelineGraph from './BlenderPipelineGraph.svelte';
  import TokenCostCard from './TokenCostCard.svelte';
  import RecentAssetsCard from './RecentAssetsCard.svelte';
  import GenerateParamsCard from './GenerateParamsCard.svelte';

  // Telemetry State
  let telemetryPeriod = $state('today'); // 'today' | '24h' | '7d' | '30d' | '60d' | 'all'
  let telemetry = $state({ total_requests: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0, est_cost_usd: 0.0 });
  let loadingTelemetry = $state(false);

  // Models Catalog
  let modelsCatalog = $state([]);
  let selectedModel = $state('');

  // Generation Form State
  let prompt = $state('Cyberpunk quantum mainframe server terminal with glowing holographic rings');
  let negativePrompt = $state('low poly, distorted, non-manifold, roblox, flat shading');
  let archetype = $state('auto');
  let profile = $state('enterprise_pbr');
  let qualityPreset = $state('normal');
  let requestedComputeMode = $state('auto');
  let imagePath = $state(null);
  let sourceMode = $state('text_to_3d');
  let imagePreviewUrl = $state(null);
  let imageFileName = $state('');
  let isUploadingImage = $state(false);
  let targetPolycount = $state(12000);
  let textureResolution = $state(2048);
  let enablePbr = $state(true);
  let isGenerating = $state(false);

  // Live Job Progress State
  let currentJobId = $state(null);
  let currentAssetId = $state(null);
  let currentGlbUrl = $state(null);
  let pendingLiveGlbUrl = null;
  let liveKey = $state(0);
  let currentStep = $state(0);
  let activeTool = $state('');
  let activeNarrative = $state('');
  let eventSource = $state(null);
  let livePngUrl = $state(null);
  let blenderSteps = $state([]);
  let llmProgress = $state(null);
  let blenderRuntime = $state(null);
  let turnaroundRequested = $state(false);
  let generatorStatus = $state(null);

  const TURNAROUND_PROMPT_PATTERN = /\b(turnaround|orthographic|front view|side view|back view|top view|reference sheet|model sheet)\b/i;

  // Geometry metrics
  let triangleCount = $state(0);
  let vertexCount = $state(0);
  let isWatertight = $state(true);

  // Recent Assets List
  let recentAssets = $state([]);
  let loadingAssets = $state(false);

  let archetypes = $state([]);
  let profiles = $state([]);
  let computeModes = $state([]);
  let qualityLevels = $state([]);

  const ASSET_PAGE_SIZE = 6;
  let assetsPage = $state(1);
  let assetsTotal = $state(0);

  const COMPUTE_MODE_LABELS = {
    auto: 'Auto (Detect GPU or Fallback to CPU)',
    gpu: 'Force GPU (Automatic CPU Fallback if absent)',
    cpu: 'Force CPU Engine'
  };

  const PROFILE_LABELS = {
    enterprise_pbr: 'Enterprise PBR (Dielectric + Metallic + Micro-Bevel)',
    realistic: 'Photorealistic Physical (Subsurface + Transmission)',
    premium_stylized: 'Premium Stylized (Vibrant Clearcoat)',
    stylized: 'Stylized Surface Shading',
    draft: 'Rapid Engineering Draft'
  };

  function humanizeCatalogId(id) {
    return String(id || '')
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  }

  function toOptions(ids, labelMap = {}) {
    return (ids || []).map((id) => ({ id, label: labelMap[id] || humanizeCatalogId(id) }));
  }

  const TIME_PERIODS = [
    { id: 'today', label: 'Today' },
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: '60d', label: '60d' },
    { id: 'all', label: 'All' }
  ];

  const AGENTIC_STEPS = [
    { id: 1, name: 'Workspace Import & Hierarchy Analysis', tool: 'dcc.blender.import_glb' },
    { id: 2, name: 'Organic Subdivision / Micro-Chamfer Bevel', tool: 'dcc.blender.modify_mesh' },
    { id: 3, name: 'Smart UV Projection & Island Packing', tool: 'dcc.blender.uv_unwrap' },
    { id: 4, name: 'Principled BSDF & Procedural Fur Shader', tool: 'dcc.blender.set_materials' },
    { id: 5, name: 'Studio Lighting, Compute Device & Camera Rig', tool: 'dcc.blender.setup_studio' },
    { id: 6, name: 'Production GLB Export & Turnaround Render', tool: 'dcc.blender.export_glb' }
  ];

  function stepTiming(stepNumber) {
    return blenderSteps.find((st) => st.step_number === stepNumber) || null;
  }

  async function loadGeneratorStatus() {
    try {
      const data = await apiRequest('/api/v1/3d/setup/status');
      const components = (data.toolchain && data.toolchain.components) || {};
      blenderRuntime = {
        blender: components.blender || null,
        dcc: components.dcc_mcp_blender || null,
        live_session: data.live_session || null
      };
      generatorStatus = data;
    } catch (_) {
      blenderRuntime = null;
    }
  }

  async function loadTelemetry(period) {
    telemetryPeriod = period;
    loadingTelemetry = true;
    try {
      const data = await apiRequest(`/api/v1/3d/telemetry?period=${period}`);
      telemetry = data;
    } catch (_) {
      // best-effort fallback
    } finally {
      loadingTelemetry = false;
    }
  }

  async function loadModels() {
    try {
      const data = await apiRequest('/api/v1/3d/setup/models');
      modelsCatalog = data.models || [];
      selectedModel = data.client_default_model || modelsCatalog[0]?.id || '';
      const catalogs = data.catalogs || {};
      archetypes = toOptions(catalogs.archetypes);
      profiles = toOptions(catalogs.profiles, PROFILE_LABELS);
      computeModes = toOptions(catalogs.compute_modes, COMPUTE_MODE_LABELS);
      qualityLevels = Array.isArray(catalogs.quality_levels) ? catalogs.quality_levels : [];
      syncCatalogDefaults();
    } catch (_) {}
  }

  function syncCatalogDefaults() {
    if (!archetypes.some((a) => a.id === archetype)) {
      archetype = archetypes.find((a) => a.id === 'auto')?.id || archetypes[0]?.id || '';
    }
    if (!profiles.some((p) => p.id === profile)) {
      profile = profiles[0]?.id || '';
    }
    if (!computeModes.some((c) => c.id === requestedComputeMode)) {
      requestedComputeMode = computeModes.find((c) => c.id === 'auto')?.id || computeModes[0]?.id || 'auto';
    }
    const level = qualityLevels.find((entry) => entry.id === qualityPreset) || qualityLevels[0];
    if (level) {
      qualityPreset = level.id;
      targetPolycount = level.targetPolycount;
    }
  }

  async function loadRecentAssets(page = assetsPage) {
    loadingAssets = true;
    const target = Math.max(1, Number(page) || 1);
    try {
      const data = await apiRequest(`/api/v1/3d/assets?limit=${ASSET_PAGE_SIZE}&offset=${(target - 1) * ASSET_PAGE_SIZE}`);
      recentAssets = data.assets || [];
      assetsTotal = Number(data.total) || recentAssets.length;
      const lastPage = Math.max(1, Math.ceil(assetsTotal / ASSET_PAGE_SIZE));
      if (target > lastPage) {
        assetsPage = lastPage;
        await loadRecentAssets(lastPage);
        return;
      }
      assetsPage = target;
      if (!currentGlbUrl && target === 1 && recentAssets.length > 0) {
        selectAsset(recentAssets[0]);
      }
    } catch (_) {} finally {
      loadingAssets = false;
    }
  }

  function selectAsset(asset) {
    currentAssetId = asset.asset_id;
    currentGlbUrl = `/api/v1/3d/assets/${asset.asset_id}/download/glb`;
    triangleCount = asset.triangle_count || 0;
    vertexCount = asset.vertex_count || 0;
    isWatertight = Boolean(asset.is_watertight_manifold);
    liveKey = Date.now();
  }

  async function handleImageUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error('Unsupported image type. Use PNG, JPEG, or WebP.');
      event.target.value = '';
      return;
    }
    isUploadingImage = true;
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read the selected file'));
        reader.readAsDataURL(file);
      });
      const res = await apiRequest('/api/v1/3d/upload-image', {
        method: 'POST',
        body: JSON.stringify({ data_base64: dataBase64, filename: file.name })
      });
      imagePath = res.image_path;
      imagePreviewUrl = URL.createObjectURL(file);
      imageFileName = file.name;
      sourceMode = 'image_to_3d';
      toast.success('Reference image uploaded');
    } catch (err) {
      toast.error('Upload failed: ' + (err.message || err));
      imagePath = null;
      imagePreviewUrl = null;
      imageFileName = '';
    } finally {
      isUploadingImage = false;
      event.target.value = '';
    }
  }

  function clearImage() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePath = null;
    imagePreviewUrl = null;
    imageFileName = '';
    if (sourceMode === 'image_to_3d') sourceMode = 'text_to_3d';
  }

  async function startGeneration() {
    if (isGenerating) return;
    if (sourceMode === 'image_to_3d' && !imagePath) {
      toast.error('Upload a reference image before generating from an image.');
      return;
    }
    if (sourceMode === 'text_to_3d' && !prompt.trim()) {
      toast.error('Describe the model you want to generate.');
      return;
    }
    isGenerating = true;
    currentStep = 0;
    activeTool = 'yamanaka.langgraph.init';
    activeNarrative = 'Initializing LangGraph 3D workflow and staging directory...';
    blenderSteps = [];
    llmProgress = null;
    livePngUrl = null;
    turnaroundRequested = TURNAROUND_PROMPT_PATTERN.test(prompt);

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    try {
      const res = await apiRequest('/api/v1/3d/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          negative_prompt: negativePrompt.trim(),
          archetype,
          profile,
          quality_preset: qualityPreset,
          requested_compute_mode: requestedComputeMode,
          model: selectedModel || null,
          target_polycount: Number(targetPolycount),
          texture_resolution: Number(textureResolution),
          enable_pbr: enablePbr,
          image_path: sourceMode === 'image_to_3d' ? imagePath : undefined
        })
      });

      currentJobId = res.job_id;
      pendingLiveGlbUrl = res.live_glb_url;
      livePngUrl = res.live_png_url || null;
      currentGlbUrl = null;

      connectJobStream(res.stream_url);
    } catch (err) {
      isGenerating = false;
      toast.error('Failed to start generation: ' + (err.message || err));
    }
  }

  function connectJobStream(streamUrl) {
    if (typeof window === 'undefined') return;
    eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'base_mesh_ready') {
          currentStep = Math.max(1, currentStep);
          activeNarrative = 'Base mesh exported — stream generated GLB into WebGL viewport...';
          if (pendingLiveGlbUrl) {
            currentGlbUrl = pendingLiveGlbUrl;
          }
          liveKey = Date.now();
        } else if (payload.event === 'llm_synthesis_attempt') {
          activeNarrative = `Synthesizing with ${payload.model} (attempt ${payload.attempt}/${payload.total_targets})...`;
        } else if (payload.event === 'llm_synthesis_progress') {
          llmProgress = payload;
          activeNarrative = `LLM ${payload.model || ''} streaming scene specification (${payload.contentLength || 0} chars)...`;
        } else if (payload.event === 'llm_synthesis_complete') {
          llmProgress = { ...(llmProgress || {}), model: payload.model, nodes: payload.nodes, tokens: payload.tokens };
          activeNarrative = `LLM synthesized ${payload.nodes || 0} scene nodes with ${payload.model || 'configured model'}.`;
        } else if (payload.event === 'blender_agent_action') {
          currentStep = payload.step_number;
          activeTool = payload.tool_used;
          activeNarrative = `${payload.step_name || payload.tool_used} finished in ${payload.elapsed_ms || 0} ms`;
          blenderSteps = [...blenderSteps.filter((st) => st.step_number !== payload.step_number), payload]
            .sort((a, b) => a.step_number - b.step_number);
          if (!currentGlbUrl && pendingLiveGlbUrl) {
            currentGlbUrl = pendingLiveGlbUrl;
          }
          if (livePngUrl) {
            livePngUrl = `${livePngUrl.split('?')[0]}?_t=${Date.now()}`;
          }
          liveKey = Date.now();
        } else if (payload.event === 'job_completed') {
          currentAssetId = payload.asset_id;
          currentGlbUrl = `/api/v1/3d/assets/${payload.asset_id}/download/glb`;
          pendingLiveGlbUrl = null;
          liveKey = Date.now();
          isGenerating = false;
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          toast.success('3D Model synthesized and promoted successfully!');
          loadTelemetry(telemetryPeriod);
          loadRecentAssets();
        } else if (payload.event === 'job_failed') {
          isGenerating = false;
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          toast.error(`Generation halted: ${payload.error}`);
        }
      } catch (_) {}
    };

    eventSource.onerror = () => {
      // Reconnect handled automatically by EventSource
    };
  }

  onMount(() => {
    loadTelemetry('today');
    loadModels();
    loadRecentAssets();
    loadGeneratorStatus();
    return () => {
      if (eventSource) eventSource.close();
    };
  });
</script>

<div class="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
  <!-- 1. Top Real Token & Cost Telemetry (full width) -->
  <TokenCostCard
    telemetry={telemetry}
    period={telemetryPeriod}
    periods={TIME_PERIODS}
    loading={loadingTelemetry}
    onSelectPeriod={loadTelemetry}
  />

  <!-- 2. Agentic Blender Editing Pipeline Graph (full width, directly under Token Card) -->
  <BlenderPipelineGraph
    steps={AGENTIC_STEPS}
    {currentStep}
    {activeTool}
    {activeNarrative}
    timings={blenderSteps}
    isRunning={isGenerating}
  />

  <!-- 3. Generative Parameters (left, lg:col-span-5) + Recent 3D Assets (right, lg:col-span-7) -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <div class="lg:col-span-5">
      <GenerateParamsCard
        {modelsCatalog}
        bind:selectedModel
        bind:prompt
        bind:sourceMode
        {imagePath}
        {imagePreviewUrl}
        {imageFileName}
        {isUploadingImage}
        bind:targetPolycount
        bind:textureResolution
        bind:enablePbr
        bind:archetype
        bind:profile
        bind:qualityPreset
        {qualityLevels}
        {archetypes}
        {profiles}
        bind:requestedComputeMode
        {computeModes}
        {isGenerating}
        onUploadImage={handleImageUpload}
        onClearImage={clearImage}
        onGenerate={startGeneration}
      />
    </div>
    <div class="lg:col-span-7">
      <RecentAssetsCard
        assets={recentAssets}
        total={assetsTotal}
        page={assetsPage}
        pageSize={ASSET_PAGE_SIZE}
        loading={loadingAssets}
        onPageChange={loadRecentAssets}
        currentAssetId={currentAssetId}
        onSelect={selectAsset}
      />
    </div>
  </div>

  <!-- Interactive Viewport + Downloads (full width, bottom, height 640px) -->
  <!-- Three.js Viewport -->
  <div class="glass-card-3d p-4 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
    <ThreeViewport
      glbUrl={currentGlbUrl}
      liveKey={liveKey}
      height="640px"
      triangleCount={triangleCount}
      vertexCount={vertexCount}
      isWatertight={isWatertight}
      turnaroundMode={turnaroundRequested}
    />

    <!-- Live Blender 5.x Agentic Render Stream -->
    {#if livePngUrl || blenderRuntime}
      <div class="mt-4 p-3 rounded-[5px] border" style="border-color: var(--color-border); background-color: var(--color-surface);">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-accent-themed">
            Live Blender Agentic Render Stream
          </h4>
          <div class="flex items-center gap-2 text-[10px] font-mono text-muted-themed">
            {#if blenderRuntime?.blender}
              <span>Blender {blenderRuntime.blender.version || 'unknown'}</span>
            {/if}
            {#if blenderRuntime?.dcc}
              <span>· dcc-mcp-blender {blenderRuntime.dcc.version || 'not installed'}</span>
            {/if}
          </div>
        </div>
        {#if livePngUrl}
          <a href={livePngUrl} target="_blank" rel="noreferrer" class="block">
            <img
              src={livePngUrl}
              alt="Blender live render"
              class="w-full rounded-[4px] border object-contain bg-surface-muted"
              style="border-color: var(--color-border); max-height: 360px;"
            />
          </a>
          <p class="mt-1 text-[10px] text-muted-themed">Rendered by Blender at each refinement step. Click to open the full-resolution frame.</p>
        {:else}
          <p class="text-[11px] text-muted-themed">The live Blender render appears here the moment the first refinement step finishes.</p>
        {/if}
        {#if llmProgress}
          <p class="mt-2 text-[10px] font-mono text-accent-themed">
            LLM {llmProgress.model || 'configured model'} · {llmProgress.nodes || llmProgress.contentLength || 0} {llmProgress.nodes ? 'nodes' : 'chars'}
            {#if llmProgress.tokens}· {llmProgress.tokens.total_tokens} tokens{/if}
          </p>
        {/if}
      </div>
    {/if}

    <!-- Production Asset Downloads Bar -->
    {#if currentAssetId}
      <div class="mt-4 pt-4 border-t flex flex-wrap items-center justify-between gap-3" style="border-color: var(--color-border);">
        <span class="text-xs font-bold" style="color: var(--color-text);">Export Formats:</span>
        <div class="flex items-center gap-2">
          <a
            href="/api/v1/3d/assets/{currentAssetId}/download/glb"
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold btn-primary-themed transition-all"
          >
            Download GLB
          </a>
          <a
            href="/api/v1/3d/assets/{currentAssetId}/download/usdz"
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          >
            USDZ
          </a>
          <a
            href="/api/v1/3d/assets/{currentAssetId}/download/obj"
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          >
            OBJ
          </a>
          <a
            href="/api/v1/3d/assets/{currentAssetId}/download/stl"
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          >
            STL
          </a>
          <a
            href="/api/v1/3d/assets/{currentAssetId}/download/ply"
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          >
            PLY
          </a>
        </div>
      </div>
    {/if}
  </div>

</div>
