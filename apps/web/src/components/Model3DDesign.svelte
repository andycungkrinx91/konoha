<script>
  import { onMount } from 'svelte';
  import { apiRequest } from '#lib/api.js';
  import { toast } from '#lib/state/toast.svelte.ts';
  import PageHero from './PageHero.svelte';
  import ThreeViewport from './ThreeViewport.svelte';

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
  let archetype = $state('saas');
  let profile = $state('enterprise_pbr');
  let qualityPreset = $state('standard');
  let requestedComputeMode = $state('auto');
  let imagePath = $state(null);
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
    { id: 2, name: 'Weighted Normals & Micro-Chamfer Beveling', tool: 'dcc.blender.modify_mesh' },
    { id: 3, name: 'Smart UV Projection & Island Packing', tool: 'dcc.blender.uv_unwrap' },
    { id: 4, name: 'Principled BSDF Physical Shader Synthesis', tool: 'dcc.blender.set_materials' },
    { id: 5, name: 'Studio 3-Point Lighting & Camera Framing', tool: 'dcc.blender.setup_studio' },
    { id: 6, name: 'Final GLB Production Export & Integrity Verification', tool: 'dcc.blender.export_glb' }
  ];

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
      syncCatalogDefaults();
    } catch (_) {}
  }

  function syncCatalogDefaults() {
    if (!archetypes.some((a) => a.id === archetype)) {
      archetype = archetypes.find((a) => a.id === 'saas')?.id || archetypes[0]?.id || '';
    }
    if (!profiles.some((p) => p.id === profile)) {
      profile = profiles[0]?.id || '';
    }
    if (!computeModes.some((c) => c.id === requestedComputeMode)) {
      requestedComputeMode = computeModes.find((c) => c.id === 'auto')?.id || computeModes[0]?.id || 'auto';
    }
  }

  async function loadRecentAssets() {
    loadingAssets = true;
    try {
      const data = await apiRequest('/api/v1/3d/assets?limit=8');
      recentAssets = data.assets || [];
      if (!currentGlbUrl && recentAssets.length > 0) {
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

  async function startGeneration() {
    if (isGenerating || !prompt.trim()) return;
    isGenerating = true;
    currentStep = 0;
    activeTool = 'yamanaka.langgraph.init';
    activeNarrative = 'Initializing LangGraph 3D workflow and staging directory...';

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
          model: selectedModel || null
        })
      });

      currentJobId = res.job_id;
      pendingLiveGlbUrl = res.live_glb_url;
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
        } else if (payload.event === 'blender_agent_action') {
          currentStep = payload.step_number;
          activeTool = payload.tool_used;
          activeNarrative = payload.narrative;
          if (!currentGlbUrl && pendingLiveGlbUrl) {
            currentGlbUrl = pendingLiveGlbUrl;
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
    return () => {
      if (eventSource) eventSource.close();
    };
  });
</script>

<div class="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
  <!-- Top-of-Page Real 3D Token & Cost Counter Bar (Mandatory Invariant) -->
  <div class="glass-card-3d p-4 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b" style="border-color: var(--color-border);">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
        <h2 class="text-xs font-extrabold uppercase tracking-widest text-cyan-600 dark:text-cyan-400">
          Real 3D Token & Cost Counter
        </h2>
      </div>

      <!-- 6 Filter Window Tabs -->
      <div class="flex items-center gap-1 bg-slate-900/10 dark:bg-slate-900/60 p-1 rounded-[5px] border border-slate-700/20">
        {#each TIME_PERIODS as tp}
          <button
            type="button"
            onclick={() => loadTelemetry(tp.id)}
            class="px-2.5 py-1 text-[11px] font-bold rounded-[3px] transition-all cursor-pointer {telemetryPeriod === tp.id ? 'bg-cyan-500 text-slate-950 font-extrabold shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-cyan-500'}"
          >
            {tp.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- 4 Stats Tiles -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
      <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Total Requests</span>
        <p class="text-lg font-black mt-0.5" style="color: var(--color-text);">{(telemetry.total_requests || 0).toLocaleString()}</p>
      </div>
      <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Total Input Tokens</span>
        <p class="text-lg font-black mt-0.5" style="color: var(--color-text);">{(telemetry.total_input_tokens || 0).toLocaleString()}</p>
      </div>
      <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Total Output Tokens</span>
        <p class="text-lg font-black mt-0.5" style="color: var(--color-text);">{(telemetry.total_output_tokens || 0).toLocaleString()}</p>
      </div>
      <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">EST. Cost (USD)</span>
        <p class="text-lg font-black mt-0.5 text-emerald-600 dark:text-emerald-400">
          ${(telemetry.est_cost_usd || 0.0).toFixed(4)}
        </p>
      </div>
    </div>
  </div>

  <!-- Studio Main Split: Left Controls / Right Interactive Viewport -->
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
    <!-- Left Column: Unified Model Selector & Generator Form (5 Cols) -->
    <div class="lg:col-span-5 space-y-6">
      <div class="glass-card-3d p-6 rounded-[5px] border space-y-4" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
        <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
          <h2 class="text-sm font-extrabold" style="color: var(--color-text);">Generative Parameters</h2>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
            LangGraph.js Engine
          </span>
        </div>

        <!-- Unified Model Selector Across 8+ Clients + 9router Catalog -->
        <div class="space-y-1">
          <label for="synthesizer-model-select" class="text-xs font-bold block" style="color: var(--color-text);">
            Synthesizer Model Router (Inherited Priority)
          </label>
          <select
            id="synthesizer-model-select"
            bind:value={selectedModel}
            class="w-full text-xs font-mono p-2.5 rounded-[5px] border focus:outline-hidden"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          >
            {#each modelsCatalog as m}
              <option value={m.id}>{m.id} ({m.model_name || m.bridge || 'Active'})</option>
            {/each}
          </select>
        </div>

        <!-- Prompt Textarea -->
        <div class="space-y-1">
          <label for="prompt-desc-input" class="text-xs font-bold block" style="color: var(--color-text);">
            Prompt Description
          </label>
          <textarea
            id="prompt-desc-input"
            bind:value={prompt}
            rows="3"
            placeholder="Describe the 3D asset in detail..."
            class="w-full text-xs p-2.5 rounded-[5px] border focus:outline-hidden resize-none"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          ></textarea>
        </div>

        <!-- Archetype & Profile Row -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="archetype-select" class="text-xs font-bold block" style="color: var(--color-text);">Domain Archetype</label>
            <select
              id="archetype-select"
              bind:value={archetype}
              class="w-full text-xs p-2 rounded-[5px] border focus:outline-hidden"
              style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
            >
              {#each archetypes as a}
                <option value={a.id}>{a.label}</option>
              {/each}
            </select>
          </div>

          <div class="space-y-1">
            <label for="profile-select" class="text-xs font-bold block" style="color: var(--color-text);">Style & Materials</label>
            <select
              id="profile-select"
              bind:value={profile}
              class="w-full text-xs p-2 rounded-[5px] border focus:outline-hidden"
              style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
            >
              {#each profiles as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <!-- Compute Engine Selector (Auto | Force GPU with Auto CPU Fallback | Force CPU) -->
        <div class="space-y-1">
          <label for="compute-mode-select" class="text-xs font-bold block" style="color: var(--color-text);">Compute Mode</label>
          <select
            id="compute-mode-select"
            bind:value={requestedComputeMode}
            class="w-full text-xs p-2 rounded-[5px] border focus:outline-hidden"
            style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
          >
            {#each computeModes as cm}
              <option value={cm.id}>{cm.label}</option>
            {/each}
          </select>
        </div>

        <!-- Synthesize Button -->
        <button
          type="button"
          onclick={startGeneration}
          disabled={isGenerating || !prompt.trim()}
          class="btn-3d w-full py-3 rounded-[5px] text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all disabled:opacity-50"
          style="background: var(--theme-gradient); color: #ffffff;"
        >
          {#if isGenerating}
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Synthesizing 3D Model...</span>
          {:else}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>Synthesize 3D Model</span>
          {/if}
        </button>
      </div>

      <!-- 6-Step Agentic Timeline Display -->
      <div class="glass-card-3d p-6 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
        <h3 class="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400 mb-3">
          Agentic Blender Editing Pipeline
        </h3>
        <div class="space-y-2">
          {#each AGENTIC_STEPS as s}
            <div class="flex items-center gap-3 p-2 rounded-[5px] transition-all {currentStep === s.id ? 'bg-cyan-500/10 border border-cyan-500/30' : (currentStep > s.id ? 'opacity-80' : 'opacity-40')}">
              <div class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 {currentStep === s.id ? 'bg-cyan-500 text-slate-950 animate-pulse' : (currentStep > s.id ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300')}">
                {s.id}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-bold truncate" style="color: var(--color-text);">{s.name}</p>
                <p class="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 truncate">{s.tool}</p>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Right Column: Interactive 3D WebGL Viewport & Production Downloads (7 Cols) -->
    <div class="lg:col-span-7 space-y-6">
      <!-- Three.js Viewport -->
      <div class="glass-card-3d p-4 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
        <ThreeViewport
          glbUrl={currentGlbUrl}
          liveKey={liveKey}
          height="520px"
          triangleCount={triangleCount}
          vertexCount={vertexCount}
          isWatertight={isWatertight}
        />

        <!-- Production Asset Downloads Bar -->
        {#if currentAssetId}
          <div class="mt-4 pt-4 border-t flex flex-wrap items-center justify-between gap-3" style="border-color: var(--color-border);">
            <span class="text-xs font-bold" style="color: var(--color-text);">Export Formats:</span>
            <div class="flex items-center gap-2">
              <a
                href="/api/v1/3d/assets/{currentAssetId}/download/glb"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-all"
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

      <!-- Recent 3D Assets Gallery Grid -->
      <div class="glass-card-3d p-6 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
        <div class="flex items-center justify-between pb-3 border-b mb-4" style="border-color: var(--color-border);">
          <h3 class="text-sm font-bold" style="color: var(--color-text);">Recent 3D Assets</h3>
          <span class="text-xs text-slate-500">{recentAssets.length} models ready</span>
        </div>

        {#if recentAssets.length === 0}
          <p class="text-xs text-center py-6" style="color: var(--color-text-muted);">
            No 3D assets generated yet. Enter a prompt above to create your first asset!
          </p>
        {:else}
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {#each recentAssets as ast}
              <button
                type="button"
                onclick={() => selectAsset(ast)}
                class="text-left p-3 rounded-[5px] border transition-all hover:scale-[1.02] cursor-pointer {currentAssetId === ast.asset_id ? 'border-cyan-500 bg-cyan-500/10' : ''}"
                style="background-color: var(--color-bg); border-color: {currentAssetId === ast.asset_id ? 'var(--color-primary)' : 'var(--color-border)'};"
              >
                <div class="w-full aspect-square rounded-[3px] bg-slate-900 overflow-hidden mb-2 relative">
                  <img
                    src="/api/v1/3d/assets/{ast.asset_id}/download/preview"
                    alt={ast.display_name}
                    class="w-full h-full object-cover"
                    onerror={(e) => e.target.style.display = 'none'}
                  />
                  <span class="absolute bottom-1 right-1 px-1 text-[9px] font-mono bg-black/70 text-white rounded">
                    {(ast.triangle_count || 0).toLocaleString()} Δ
                  </span>
                </div>
                <h4 class="text-xs font-bold truncate" style="color: var(--color-text);">{ast.display_name}</h4>
                <p class="text-[10px] text-cyan-600 dark:text-cyan-400 capitalize">{ast.domain_archetype}</p>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
