<script>
  let {
    assets = [],
    currentAssetId = null,
    onSelect = () => {},
    total = 0,
    page = 1,
    pageSize = 6,
    loading = false,
    onPageChange = () => {}
  } = $props();

  let pageCount = $derived(Math.max(1, Math.ceil((Number(total) || assets.length) / Math.max(1, pageSize))));
  let visibleAssets = $derived(assets.slice(0, Math.max(1, pageSize)));
  let canGoPrev = $derived(page > 1 && !loading);
  let canGoNext = $derived(page < pageCount && !loading);

  function goTo(nextPage) {
    if (nextPage < 1 || nextPage > pageCount || nextPage === page || loading) return;
    onPageChange(nextPage);
  }
</script>

<div
  class="glass-card-3d p-6 rounded-[5px] border h-full flex flex-col"
  style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);"
>
  <div class="flex items-center justify-between pb-3 border-b mb-4" style="border-color: var(--color-border);">
    <h3 class="text-sm font-bold" style="color: var(--color-text);">Recent 3D Assets</h3>
    <span class="text-xs" id="recent-assets-count" style="color: var(--color-text-muted);">
      {Number(total) || assets.length} models ready
    </span>
  </div>

  {#if assets.length === 0}
    <p class="text-xs text-center py-6 flex-1" style="color: var(--color-text-muted);">
      {loading ? 'Loading assets…' : 'No 3D assets generated yet. Describe a model above to create your first asset.'}
    </p>
  {:else}
    <div class="grid grid-cols-2 gap-4 flex-1 content-start">
      {#each visibleAssets as ast (ast.asset_id)}
        <button
          type="button"
          onclick={() => onSelect(ast)}
          class="text-left p-3 rounded-[5px] border transition-all hover:scale-[1.02] cursor-pointer"
          style="background-color: var(--color-bg);
            border-color: {currentAssetId === ast.asset_id ? 'rgb(6,182,212)' : 'var(--color-border)'};"
        >
          <div class="w-full aspect-square rounded-[3px] bg-slate-900 overflow-hidden mb-2 relative">
            <img
              src="/api/v1/3d/assets/{ast.asset_id}/download/preview"
              alt={ast.display_name}
              loading="lazy"
              decoding="async"
              class="w-full h-full object-cover"
              onerror={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <span class="absolute bottom-1 right-1 px-1 text-[9px] font-mono bg-black/70 text-white rounded">
              {(ast.triangle_count || 0).toLocaleString()} Δ
            </span>
          </div>
          <h4 class="text-xs font-bold truncate" style="color: var(--color-text);">{ast.display_name}</h4>
          <p class="text-[10px] text-accent-themed capitalize">{ast.domain_archetype || 'general'}</p>
        </button>
      {/each}
    </div>
  {/if}

  {#if pageCount > 1}
    <div
      class="flex items-center justify-between gap-2 pt-3 mt-4 border-t"
      style="border-color: var(--color-border);"
      id="recent-assets-pager"
    >
      <button
        type="button"
        data-page-action="prev"
        onclick={() => goTo(page - 1)}
        disabled={!canGoPrev}
        class="px-3 py-1 rounded-[5px] text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
      >
        Prev
      </button>
      <span class="text-[10px] font-mono" id="recent-assets-page-indicator" style="color: var(--color-text-muted);">
        Page {page} / {pageCount}
      </span>
      <button
        type="button"
        data-page-action="next"
        onclick={() => goTo(page + 1)}
        disabled={!canGoNext}
        class="px-3 py-1 rounded-[5px] text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        style="background-color: var(--color-bg); border-color: var(--color-border); color: var(--color-text);"
      >
        Next
      </button>
    </div>
  {/if}
</div>
