<script>
  let {
    assets = [],
    currentAssetId = null,
    onSelect = () => {},
    total = 0,
    loading = false,
    hasMore = false,
    onLoadMore = () => {}
  } = $props();

  let sentinelRef = $state(null);
  // Assets whose preview thumbnail failed to load (missing file, 404, corrupt PNG).
  // Tracked per asset so each card can show an explicit fallback instead of blank space.
  let brokenPreviews = $state({});

  function markBroken(assetId) {
    if (!assetId || brokenPreviews[assetId]) return;
    brokenPreviews = { ...brokenPreviews, [assetId]: true };
  }

  $effect(() => {
    if (!sentinelRef || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting && !loading && hasMore) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef);
    return () => {
      observer.disconnect();
    };
  });
</script>

<div
  class="glass-card-3d p-6 rounded-[5px] border w-full flex flex-col"
  style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
>
  <div class="flex items-center justify-between pb-3 border-b mb-4" style="border-color: var(--color-border);">
    <h3 class="text-sm font-bold" style="color: var(--color-text);">Recent 3D Assets</h3>
    <span class="text-xs font-mono" id="recent-assets-count" style="color: var(--color-text-muted);">
      {Number(total) || assets.length} models ready
    </span>
  </div>

  {#if assets.length === 0}
    <p class="text-xs text-center py-8 flex-1" style="color: var(--color-text-muted);">
      {loading ? 'Loading assets…' : 'No 3D assets generated yet. Describe a model above to create your first asset.'}
    </p>
  {:else}
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 flex-1 content-start">
      {#each assets as ast (ast.asset_id)}
        <button
          type="button"
          onclick={() => onSelect(ast)}
          class="text-left p-2.5 rounded-[5px] border transition-all hover:scale-[1.02] cursor-pointer"
          style="background-color: var(--color-bg);
            border-color: {currentAssetId === ast.asset_id ? 'rgb(6,182,212)' : 'var(--color-border)'};"
        >
          <div class="w-full aspect-square rounded-[3px] bg-slate-900 overflow-hidden mb-2 relative">
            {#if brokenPreviews[ast.asset_id]}
              <div class="w-full h-full flex flex-col items-center justify-center gap-1 px-2 text-center">
                <svg class="w-6 h-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="color: var(--color-text-muted);">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span class="text-[9px] font-mono leading-tight" style="color: var(--color-text-muted);">
                  {brokenPreviews[ast.asset_id] ? 'No preview' : ''}
                </span>
              </div>
            {:else}
              <img
                src="/api/v1/3d/assets/{ast.asset_id}/download/preview"
                alt={ast.display_name}
                loading="lazy"
                decoding="async"
                class="w-full h-full object-cover"
                onerror={() => markBroken(ast.asset_id)}
              />
            {/if}
            <span class="absolute bottom-1 right-1 px-1 text-[9px] font-mono bg-black/70 text-white rounded">
              {(ast.triangle_count || 0).toLocaleString()} Δ
            </span>
          </div>
          <h4 class="text-xs font-bold truncate" style="color: var(--color-text);">{ast.display_name}</h4>
          <p class="text-[10px] text-accent-themed capitalize truncate">{ast.domain_archetype || 'general'}</p>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Sentinel element for lazy infinite scroll loading -->
  <div bind:this={sentinelRef} class="h-6 w-full flex items-center justify-center my-2" aria-hidden="true">
    {#if loading && assets.length > 0}
      <div class="flex items-center gap-2 text-[11px] font-mono" style="color: var(--color-text-muted);">
        <div class="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style="border-color: var(--theme-info); border-top-color: transparent;"></div>
        <span>Loading more models...</span>
      </div>
    {/if}
  </div>
</div>