<script>
  import { onMount } from 'svelte';
  import { apiRequest } from '#lib/api.js';
  import { toast } from '#lib/state/toast.svelte.ts';
  import PageHero from './PageHero.svelte';
  import TokenCostCard from './TokenCostCard.svelte';
  import GenerateParamsCard from './GenerateParamsCard.svelte';
  import RecentAssetsCard from './RecentAssetsCard.svelte';
  import RefinePanel from './RefinePanel.svelte';
  import SynthesisModal from './SynthesisModal.svelte';

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

  // Output Size State (Preview & Inspection Render)
  let outputSize = $state({
    width: 1024,
    height: 576,
    aspect_ratio: '16:9',
    orientation: 'landscape',
    long_edge: 1024,
    source: 'preset'
  });
  let outputSizeWarning = $state(null);
  let resolvedArchetype = $state(null);
  let archetypeMode = $state(null);

  // Live Job & Modal State
  let modalOpen = $state(false);
  let synthesisProgress = $state(0);
  let synthesisError = $state(null);
  let progressInterval = null;

  let currentJobId = $state(null);
  let currentAssetId = $state(null);
  let currentGlbUrl = $state(null);
  let pendingLiveGlbUrl = null;
  let liveKey = $state(0);
  let currentStep = $state(0);
  let activeTool = $state('');
  let activeNarrative = $state('');
  let eventSource = $state(null);
  let turnaroundRequested = $state(false);

  const TURNAROUND_PROMPT_PATTERN = /\b(turnaround|orthographic|front view|side view|back view|top view|reference sheet|model sheet)\b/i;

  // Geometry metrics
  let triangleCount = $state(0);
  let vertexCount = $state(0);
  let isWatertight = $state(true);

  // Recent Assets List (Infinite Scroll)
  let recentAssets = $state([]);
  let loadingAssets = $state(false);
  let assetsPage = $state(1);
  let assetsTotal = $state(0);
  const ASSET_PAGE_SIZE = 12;

  let hasMoreAssets = $derived(recentAssets.length < assetsTotal);

  let archetypes = $state([]);
  let profiles = $state([]);
  let computeModes = $state([]);
  let qualityLevels = $state([]);

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

  const STAGE_WEIGHTS = {
    job_started: 0,
    stage_started: 5,
    llm_synthesis_attempt: 10,
    llm_synthesis_complete: 35,
    base_mesh_ready: 40,
    inspect: 95,
    job_completed: 100,
    job_failed: 100
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

  function startProgressCreep() {
    stopProgressCreep();
    progressInterval = setInterval(() => {
      if (isGenerating && synthesisProgress < 95) {
        synthesisProgress = Math.min(95, synthesisProgress + 1);
      }
    }, 1000);
  }

  function stopProgressCreep() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
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
      const saved = typeof window !== 'undefined' ? localStorage.getItem('konoha_3d_selected_model') : null;
      if (saved !== null && (saved === '' || saved === '__custom__' || modelsCatalog.some((m) => m.id === saved))) {
        selectedModel = saved;
      } else if (!selectedModel) {
        selectedModel = '';
      }
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

  async function loadRecentAssets(page = 1, append = false) {
    loadingAssets = true;
    try {
      const target = Math.max(1, Number(page) || 1);
      const data = await apiRequest(`/api/v1/3d/assets?limit=${ASSET_PAGE_SIZE}&offset=${(target - 1) * ASSET_PAGE_SIZE}`);
      const fetched = data.assets || [];
      assetsTotal = Number(data.total) || (append ? recentAssets.length + fetched.length : fetched.length);
      if (append) {
        recentAssets = [...recentAssets, ...fetched];
      } else {
        recentAssets = fetched;
      }
      assetsPage = target;
    } catch (_) {} finally {
      loadingAssets = false;
    }
  }

  function handleLoadMoreAssets() {
    if (loadingAssets || !hasMoreAssets) return;
    loadRecentAssets(assetsPage + 1, true);
  }

  function selectAsset(asset) {
    if (!asset || !asset.asset_id) return;
    // Reset stale state so a previous failure cannot bleed into the new preview.
    synthesisError = null;
    currentAssetId = asset.asset_id;
    currentGlbUrl = `/api/v1/3d/assets/${asset.asset_id}/download/glb`;
    triangleCount = asset.triangle_count || 0;
    vertexCount = asset.vertex_count || 0;
    isWatertight = Boolean(asset.is_watertight_manifold);
    resolvedArchetype = asset.domain_archetype || null;
    liveKey = Date.now();
    modalOpen = true;
  }

  function handleRefinedAsset(asset) {
    loadRecentAssets(1, false);
    loadTelemetry(telemetryPeriod);
    if (asset && asset.asset_id) selectAsset(asset);
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
        body: JSON.stringify({
          data_base64: dataBase64,
          filename: file.name,
          output_size: outputSize
        })
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
    modalOpen = true;
    synthesisProgress = 0;
    synthesisError = null;
    currentStep = 0;
    activeTool = 'yamanaka.langgraph.init';
    activeNarrative = 'Initializing LangGraph 3D workflow and staging directory...';
    turnaroundRequested = TURNAROUND_PROMPT_PATTERN.test(prompt);

    startProgressCreep();

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
          model: selectedModel && selectedModel.trim() !== '' ? selectedModel.trim() : null,
          target_polycount: Number(targetPolycount),
          texture_resolution: Number(textureResolution),
          output_size: outputSize,
          enable_pbr: enablePbr,
          source_mode: imagePath ? 'image_to_3d' : sourceMode,
          image_path: imagePath || null
        })
      });

      if (res.output_size) {
        outputSize = { ...outputSize, ...res.output_size };
      }
      if (res.output_size_warning !== undefined) {
        outputSizeWarning = res.output_size_warning;
      }

      currentJobId = res.job_id;
      pendingLiveGlbUrl = res.live_glb_url;
      currentGlbUrl = null;

      connectJobStream(res.stream_url);
    } catch (err) {
      isGenerating = false;
      stopProgressCreep();
      synthesisError = err.message || String(err);
      toast.error('Failed to start generation: ' + (err.message || err));
    }
  }

  function connectJobStream(streamUrl) {
    if (typeof window === 'undefined') return;
    eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload || !payload.event) return;

        if (payload.resolved_archetype || payload.archetype) {
          resolvedArchetype = payload.resolved_archetype || payload.archetype;
        }
        if (payload.archetype_mode || payload.mode) {
          archetypeMode = payload.archetype_mode || payload.mode;
        }

        if (payload.event === 'base_mesh_ready') {
          currentStep = Math.max(1, currentStep);
          activeNarrative = 'Base mesh exported — staging generated GLB...';
          synthesisProgress = Math.max(synthesisProgress, STAGE_WEIGHTS.base_mesh_ready);
          if (pendingLiveGlbUrl) {
            currentGlbUrl = pendingLiveGlbUrl;
          }
          liveKey = Date.now();
        } else if (payload.event === 'llm_synthesis_attempt') {
          activeNarrative = `Synthesizing with ${payload.model} (attempt ${payload.attempt}/${payload.total_targets})...`;
          synthesisProgress = Math.max(synthesisProgress, STAGE_WEIGHTS.llm_synthesis_attempt);
        } else if (payload.event === 'llm_synthesis_progress') {
          activeNarrative = `LLM ${payload.model || ''} streaming scene specification (${payload.contentLength || 0} chars)...`;
        } else if (payload.event === 'llm_synthesis_complete') {
          activeNarrative = `LLM synthesized ${payload.nodes || 0} scene nodes with ${payload.model || 'configured model'}.`;
          synthesisProgress = Math.max(synthesisProgress, STAGE_WEIGHTS.llm_synthesis_complete);
        } else if (payload.event === 'blender_agent_action') {
          currentStep = payload.step_number || 1;
          activeTool = payload.tool_used || '';
          activeNarrative = `${payload.step_name || payload.tool_used} finished in ${payload.elapsed_ms || 0} ms`;
          const stepWeight = Math.min(94, 40 + 10 * currentStep);
          synthesisProgress = Math.max(synthesisProgress, stepWeight);
          if (!currentGlbUrl && pendingLiveGlbUrl) {
            currentGlbUrl = pendingLiveGlbUrl;
          }
          liveKey = Date.now();
        } else if (payload.event === 'inspect') {
          activeNarrative = 'Inspecting mesh geometry and silhouette coverage...';
          synthesisProgress = Math.max(synthesisProgress, STAGE_WEIGHTS.inspect);
        } else if (payload.event === 'job_completed') {
          stopProgressCreep();
          synthesisProgress = 100;
          isGenerating = false;
          currentAssetId = payload.asset_id;
          currentGlbUrl = `/api/v1/3d/assets/${payload.asset_id}/download/glb`;
          pendingLiveGlbUrl = null;
          liveKey = Date.now();
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          toast.success('3D Model synthesized and promoted successfully!');
          loadTelemetry(telemetryPeriod);
          loadRecentAssets(1, false);
        } else if (payload.event === 'job_failed') {
          stopProgressCreep();
          isGenerating = false;
          synthesisError = payload.error || 'Generation halted by workflow.';
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          toast.error(`Generation halted: ${payload.error}`);
        }
      } catch (_) {}
    };

    eventSource.onerror = () => {
      // EventSource reconnects automatically
    };
  }

  onMount(() => {
    loadTelemetry('today');
    loadModels();
    loadRecentAssets(1, false);
    return () => {
      stopProgressCreep();
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

  <!-- 2. Generative Parameters (full width) -->
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
    bind:outputSize
    {outputSizeWarning}
    {resolvedArchetype}
    {archetypeMode}
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

  <!-- Summary Strip: View 3D Model / Open Synthesis -->
  {#if currentAssetId || isGenerating}
    <div
      class="glass-card-3d p-4 rounded-[5px] border flex flex-wrap items-center justify-between gap-3"
      style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
    >
      <div class="flex items-center gap-3">
        <div class="w-2.5 h-2.5 rounded-full {isGenerating ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}"></div>
        <div>
          <span class="text-xs font-bold block" style="color: var(--color-text);">
            {isGenerating ? 'Synthesis in progress...' : 'Active 3D Asset'}
          </span>
          {#if currentAssetId && !isGenerating}
            <span class="text-[10px] font-mono text-muted-themed">
              ID: {currentAssetId}
            </span>
          {/if}
        </div>
      </div>
      <button
        type="button"
        onclick={() => { modalOpen = true; }}
        class="btn-3d px-4 py-2 rounded-[5px] text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border"
        style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
      >
        <svg class="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span>View 3D Model</span>
      </button>
    </div>
  {/if}

  <!-- 3. Refine (fork) panel for the selected asset -->
  {#if currentAssetId && !isGenerating}
    <RefinePanel assetId={currentAssetId} onRefined={handleRefinedAsset} />
  {/if}

  <!-- 4. Recent 3D Assets (full width at the bottom, infinite scroll) -->
  <RecentAssetsCard
    assets={recentAssets}
    total={assetsTotal}
    loading={loadingAssets}
    hasMore={hasMoreAssets}
    onLoadMore={handleLoadMoreAssets}
    currentAssetId={currentAssetId}
    onSelect={selectAsset}
  />
</div>

<!-- Click-to-Open Modal for 3D Synthesis Progress & Lazy Viewport -->
<SynthesisModal
  open={modalOpen}
  {isGenerating}
  progress={synthesisProgress}
  statusText={activeNarrative}
  assetId={currentAssetId}
  glbUrl={currentGlbUrl}
  glbKey={liveKey}
  stats={{ triangleCount, vertexCount, isWatertight }}
  error={synthesisError}
  onClose={() => { modalOpen = false; }}
  onRetry={startGeneration}
  onRefined={(newAssetId) => {
    currentAssetId = newAssetId;
    currentGlbUrl = `/api/v1/3d/assets/${newAssetId}/download/glb`;
    liveKey += 1;
    fetchAssets();
  }}
/>