<script>
  let {
    modelsCatalog = [],
    qualityPreset = $bindable('normal'),
    qualityLevels = [],
    selectedModel = $bindable(''),
    prompt = $bindable(''),
    sourceMode = $bindable('text_to_3d'),
    imagePath = null,
    imagePreviewUrl = null,
    imageFileName = '',
    isUploadingImage = false,
    targetPolycount = $bindable(12000),
    textureResolution = $bindable(2048),
    enablePbr = $bindable(true),
    archetype = $bindable('auto'),
    profile = $bindable('enterprise_pbr'),
    archetypes = [],
    profiles = [],
    requestedComputeMode = $bindable('auto'),
    computeModes = [],
    isGenerating = false,
    onUploadImage = () => {},
    onClearImage = () => {},
    onGenerate = () => {}
  } = $props();

  let activeLevel = $derived(qualityLevels.find((level) => level.id === qualityPreset) || null);

  function selectQualityLevel(level) {
    qualityPreset = level.id;
    targetPolycount = level.targetPolycount;
  }
</script>

<div class="glass-card-3d p-6 rounded-[5px] border space-y-4 h-full flex flex-col">
  <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
    <h2 class="text-sm font-extrabold" style="color: var(--color-text);">Generative Parameters</h2>
    <span class="text-[10px] font-mono px-2 py-0.5 rounded badge-accent-themed">
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

  <!-- Source Mode: Text-to-3D or Image-to-3D -->
  <div class="space-y-2">
    <span class="text-xs font-bold block" style="color: var(--color-text);">Source Mode</span>
    <div class="grid grid-cols-2 gap-2">
      <button
      type="button"
      onclick={() => { sourceMode = 'text_to_3d'; }}
      class="px-3 py-2 rounded-[5px] text-xs font-bold border transition-all"
      style="background-color: {sourceMode === 'text_to_3d' ? 'rgba(6,182,212,0.12)' : 'var(--color-bg)'};
      border-color: {sourceMode === 'text_to_3d' ? 'rgb(6,182,212)' : 'var(--color-border)'};
      color: {sourceMode === 'text_to_3d' ? 'rgb(8,145,178)' : 'var(--color-text-muted)'};"
      >
      Text to 3D
      </button>
      <button
      type="button"
      onclick={() => { sourceMode = 'image_to_3d'; }}
      class="px-3 py-2 rounded-[5px] text-xs font-bold border transition-all"
      style="background-color: {sourceMode === 'image_to_3d' ? 'rgba(6,182,212,0.12)' : 'var(--color-bg)'};
      border-color: {sourceMode === 'image_to_3d' ? 'rgb(6,182,212)' : 'var(--color-border)'};
      color: {sourceMode === 'image_to_3d' ? 'rgb(8,145,178)' : 'var(--color-text-muted)'};"
      >
      Image to 3D
      </button>
    </div>
  </div>

  {#if sourceMode === 'image_to_3d'}
  <div class="space-y-2">
    <span class="text-xs font-bold block" style="color: var(--color-text);">Reference Image</span>
    {#if imagePreviewUrl}
    <div class="flex items-center gap-3 p-2 rounded-[5px] border" style="border-color: var(--color-border); background-color: var(--color-bg);">
      <img src={imagePreviewUrl} alt="Reference preview" class="w-14 h-14 object-cover rounded" />
      <div class="flex-1 min-w-0">
        <p class="text-xs font-bold truncate" style="color: var(--color-text);">{imageFileName}</p>
        <p class="text-[10px] font-mono text-status-success">Ready for image-to-3D</p>
      </div>
      <button type="button" onclick={onClearImage} class="text-xs px-2 py-1 rounded border" style="border-color: var(--color-border); color: var(--color-text-muted);">
      Remove
      </button>
    </div>
    {:else}
    <label
    class="flex flex-col items-center justify-center gap-1 p-4 rounded-[5px] border border-dashed cursor-pointer text-center transition-all hover:border-cyan-500"
    style="border-color: var(--color-border); background-color: var(--color-bg);"
    >
    <span class="text-xs font-bold" style="color: var(--color-text);">
    {isUploadingImage ? 'Uploading...' : 'Choose a reference image'}
    </span>
    <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">PNG, JPEG, or WebP up to 12 MB</span>
    <input type="file" accept="image/png,image/jpeg,image/webp" onchange={onUploadImage} disabled={isUploadingImage} class="sr-only" />
    </label>
    {/if}
  </div>
  {/if}

  <!-- Quality Level Selector -->
  <div class="space-y-2">
    <span class="text-xs font-bold block" style="color: var(--color-text);">Quality Level</span>
    <div class="grid grid-cols-4 gap-2" id="quality-level-group">
      {#each qualityLevels as level (level.id)}
      <button
      type="button"
      data-quality-level={level.id}
      aria-pressed={qualityPreset === level.id}
      onclick={() => selectQualityLevel(level)}
      class="px-2 py-2 rounded-[5px] text-xs font-bold border transition-all"
      style="background-color: {qualityPreset === level.id ? 'rgba(6,182,212,0.12)' : 'var(--color-bg)'};
      border-color: {qualityPreset === level.id ? 'rgb(6,182,212)' : 'var(--color-border)'};
      color: {qualityPreset === level.id ? 'rgb(8,145,178)' : 'var(--color-text-muted)'};"
      >
      {level.label}
      </button>
      {/each}
    </div>
    {#if activeLevel}
    <p class="text-[10px] leading-snug" style="color: var(--color-text-muted);">
    {activeLevel.summary} — poly budget {activeLevel.targetPolycount.toLocaleString()}. Editing the numbers below overrides the level.
    </p>
    {/if}
  </div>

  <!-- Mesh Quality Controls -->
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div class="space-y-1">
      <label for="polycount-input" class="text-xs font-bold block" style="color: var(--color-text);">Target Polycount</label>
      <input
      id="polycount-input"
      type="number"
      min="500"
      max="200000"
      step="500"
      bind:value={targetPolycount}
      class="w-full text-xs font-mono p-2 rounded-[5px] border focus:outline-hidden"
      style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
      />
    </div>
    <div class="space-y-1">
      <label for="texture-input" class="text-xs font-bold block" style="color: var(--color-text);">Texture Resolution</label>
      <select
      id="texture-input"
      bind:value={textureResolution}
      class="w-full text-xs p-2 rounded-[5px] border focus:outline-hidden"
      style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
      >
      <option value={512}>512 × 512</option>
      <option value={1024}>1024 × 1024</option>
      <option value={2048}>2048 × 2048</option>
      <option value={4096}>4096 × 4096</option>
      </select>
    </div>
  </div>

  <label class="flex items-center gap-2 text-xs font-bold cursor-pointer" style="color: var(--color-text);">
  <input type="checkbox" bind:checked={enablePbr} class="w-4 h-4 rounded accent-cyan-600" />
  Generate PBR materials (albedo, normal, roughness, metallic)
  </label>

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
  onclick={onGenerate}
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
