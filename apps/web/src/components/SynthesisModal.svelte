<script>
  import { useScrollLock } from "#lib/scrollLock.svelte.js";
    import RefinePanel from './RefinePanel.svelte';

  let {
    open = false,
    isGenerating = false,
    progress = 0,
    statusText = '',
    assetId = null,
    glbUrl = null,
    glbKey = 0,
    stats = { triangleCount: 0, vertexCount: 0, isWatertight: true },
    error = null,
    onClose = () => {},
    onRetry = () => {},
    onRefined = () => {}
  } = $props();

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let clampedProgress = $derived(Math.min(100, Math.max(0, Number(progress) || 0)));
  let dashOffset = $derived(circumference * (1 - clampedProgress / 100));

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget && !isGenerating) {
      onClose();
    }
  }

  useScrollLock(() => open);

  let viewMode = $state('3d');

  $effect(() => {
    if (assetId || isGenerating) {
      viewMode = '3d';
    }
  });

  function handleKeyDown(event) {
    if (event.key === 'Escape' && !isGenerating && open) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
  <div
    class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto overscroll-contain"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div
      class="relative w-full max-w-4xl max-h-[calc(100dvh-2rem)] my-auto flex flex-col rounded-[6px] border p-6 shadow-2xl overflow-y-auto overscroll-contain"
      style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
      role="dialog"
      aria-modal="true"
      aria-labelledby="synthesis-modal-title"
    >
      <div class="flex items-center justify-between pb-3 border-b mb-4 shrink-0" style="border-color: var(--color-border);">
        <h3 id="synthesis-modal-title" class="text-sm font-bold flex items-center gap-2" style="color: var(--color-text);">
          <span>3D Synthesis Studio</span>
          {#if isGenerating}
            <span class="text-[10px] font-mono px-2 py-0.5 rounded badge-accent-themed">Running</span>
          {:else if assetId}
            <span class="text-[10px] font-mono px-2 py-0.5 rounded badge-status-success">Ready</span>
          {/if}
        </h3>
        {#if !isGenerating}
          <button
            type="button"
            onclick={onClose}
            aria-label="Close modal"
            class="text-sm p-1 rounded transition-colors"
            style="color: var(--color-text-muted);"
          >
            ✕
          </button>
        {/if}
      </div>

      {#if error && !isGenerating}
        <div class="p-6 rounded-[5px] badge-status-danger text-center space-y-4 my-auto">
          <div class="w-12 h-12 mx-auto rounded-full bg-status-danger-soft flex items-center justify-center text-status-danger">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h4 class="text-sm font-bold text-status-danger">Synthesis Halted</h4>
            <p class="text-xs mt-1 font-mono max-w-lg mx-auto" style="color: var(--color-text-muted);">{error}</p>
          </div>
          <div class="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onclick={onRetry}
              class="px-4 py-2 rounded-[5px] text-xs font-bold bg-status-danger transition-all cursor-pointer"
              style="color: var(--theme-text-inverse);"
            >
              Retry
            </button>
            <button
              type="button"
              onclick={onClose}
              class="px-4 py-2 rounded-[5px] text-xs font-bold border transition-all cursor-pointer"
              style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
            >
              Close
            </button>
          </div>
        </div>

      {:else if isGenerating}
        <div class="flex flex-col items-center justify-center py-12 my-auto">
          <div class="relative w-36 h-36 flex items-center justify-center">
            <svg viewBox="0 0 120 120" class="w-full h-full">
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="currentColor"
                stroke-width="8"
                stroke-dasharray="16 12"
                class="animate-spin origin-center"
                style="color: var(--color-border);"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="rgb(6,182,212)"
                stroke-width="8"
                stroke-linecap="round"
                stroke-dasharray={circumference}
                stroke-dashoffset={dashOffset}
                transform="rotate(-90 60 60)"
                class="transition-all duration-300 ease-out"
              />
              <text
                x="60"
                y="67"
                font-size="20"
                text-anchor="middle"
                font-weight="bold"
                fill="currentColor"
                class="select-none"
              >
                {Math.round(clampedProgress)}%
              </text>
            </svg>
          </div>
          <h4 class="text-base font-bold text-center mt-5" style="color: var(--color-text);">
            Synthesizing 3D Model
          </h4>
          <p class="text-xs text-center mt-1.5 font-mono max-w-md px-4" style="color: var(--color-text-muted);">
            {statusText || 'Initializing Yamanaka LangGraph engine...'}
          </p>
        </div>

      {:else if assetId}
        <div class="space-y-4 shrink-0">
          <div class="flex items-center justify-between gap-2">
            <div class="inline-flex rounded-[5px] border p-0.5 text-xs font-bold" style="background-color: var(--color-bg); border-color: var(--color-border);">
              <button
                type="button"
                onclick={() => { viewMode = '3d'; }}
                class="px-3 py-1 rounded-[4px] transition-all cursor-pointer {viewMode === '3d' ? 'btn-primary-themed' : ''}"
                style={viewMode === '3d' ? '' : 'color: var(--color-text-muted);'}
              >
                3D Model Viewport
              </button>
              <button
                type="button"
                onclick={() => { viewMode = 'image'; }}
                class="px-3 py-1 rounded-[4px] transition-all cursor-pointer {viewMode === 'image' ? 'btn-primary-themed' : ''}"
                style={viewMode === 'image' ? '' : 'color: var(--color-text-muted);'}
              >
                Rendered Image (PNG)
              </button>
            </div>
            <button
              type="button"
              onclick={() => { viewMode = viewMode === '3d' ? 'image' : '3d'; }}
              class="flex items-center gap-2 px-2 py-1 rounded-[4px] border text-[11px] font-mono cursor-pointer hover:opacity-90"
              style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text-muted);"
              title="Toggle rendered PNG preview"
            >
              <img
                src="/api/v1/3d/assets/{assetId}/download/preview?_t={glbKey}"
                alt="3D preview thumbnail"
                class="w-6 h-6 rounded-[2px] object-cover bg-slate-900"
              />
              <span>{viewMode === '3d' ? 'Show PNG Preview' : 'Show 3D Viewport'}</span>
            </button>
          </div>
          <div class="glass-card-3d p-2 rounded-[5px] border overflow-hidden" style="background-color: var(--color-surface); border-color: var(--color-border);">
            {#if viewMode === 'image'}
              <div class="h-[clamp(240px,52vh,520px)] flex items-center justify-center bg-slate-950 rounded-[4px] overflow-hidden p-2">
                <img
                  src="/api/v1/3d/assets/{assetId}/download/preview?_t={glbKey}"
                  alt="Rendered 3D Model Preview"
                  class="max-w-full max-h-full object-contain rounded-[4px]"
                />
              </div>
            {:else}
              {#key glbKey}
                {#await import('./ThreeViewport.svelte')}
                  <div class="h-[clamp(240px,52vh,520px)] flex items-center justify-center text-xs font-mono" style="color: var(--color-text-muted);">
                    <div class="flex items-center gap-2">
                      <div class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style="border-color: var(--theme-info); border-top-color: transparent;"></div>
                      <span>Mounting WebGL 3D Viewport...</span>
                    </div>
                  </div>
                {:then { default: ThreeViewport }}
                  <ThreeViewport
                    {glbUrl}
                    liveKey={glbKey}
                    height="clamp(240px, 52vh, 520px)"
                    triangleCount={stats?.triangleCount || 0}
                    vertexCount={stats?.vertexCount || 0}
                    isWatertight={stats?.isWatertight ?? true}
                  />
                {:catch err}
                  <div class="h-[clamp(240px,52vh,520px)] flex flex-col items-center justify-center text-xs font-mono text-status-danger p-4">
                    <p>Failed to mount 3D viewport: {err?.message || err}</p>
                  </div>
                {/await}
              {/key}
            {/if}
          </div>

          <div class="pt-4 border-t flex flex-wrap items-center justify-between gap-3" style="border-color: var(--color-border);">
            <span class="text-xs font-bold" style="color: var(--color-text);">Export Formats:</span>
            <div class="flex items-center gap-2">
              <a
                href="/api/v1/3d/assets/{assetId}/download/glb"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold btn-primary-themed transition-all"
              >
                Download GLB
              </a>
              <a
                href="/api/v1/3d/assets/{assetId}/download/png"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              >
                PNG
              </a>
              <a
                href="/api/v1/3d/assets/{assetId}/download/gltf"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              >
                GLTF
              </a>
              <a
                href="/api/v1/3d/assets/{assetId}/download/usdz"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              >
                USDZ
              </a>
              <a
                href="/api/v1/3d/assets/{assetId}/download/obj"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              >
                OBJ
              </a>
              <a
                href="/api/v1/3d/assets/{assetId}/download/stl"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              >
                STL
              </a>
              <a
                href="/api/v1/3d/assets/{assetId}/download/ply"
                class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all"
                style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
              >
                PLY
              </a>
            </div>
          </div>
          {#if assetId && !isGenerating}
            <div class="pt-4 border-t" style="border-color: var(--color-border);">
              <RefinePanel {assetId} {onRefined} />
            </div>
          {/if}
        </div>
      {:else}
        <div class="py-12 text-center text-xs" style="color: var(--color-text-muted);">
          No model selected.
        </div>
      {/if}
    </div>
  </div>
{/if}
