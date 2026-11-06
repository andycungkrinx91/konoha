<script>
  let { sources = [], activeSources = [] } = $props();
</script>

<!-- OpenAI-compatible provider sources discoverable as bridges -->
{#if sources.length > 0}
  <div class="glass-card-3d p-5 rounded-2xl border">
    <div class="flex items-center justify-between gap-3 mb-3">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="color: var(--color-text-muted);">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h10" />
        </svg>
        <h3 class="text-xs font-black theme-text uppercase tracking-wide">Provider Sources</h3>
      </div>
      <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-info">
        {activeSources.length} / {sources.length} online
      </span>
    </div>
    <p class="text-xs font-semibold theme-text-secondary mb-4">
      OpenAI-compatible endpoints that can serve as bridge sources. Credentials are never stored here.
    </p>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {#each sources as s (s.id)}
        <div class="flex items-start justify-between gap-2 p-3 rounded-xl border theme-border">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="h-1.5 w-1.5 rounded-full {s.running ? 'bg-status-success-soft' : 'bg-indicator-idle'}"></span>
              <span class="text-xs font-bold theme-text truncate">{s.label}</span>
            </div>
            <p class="text-[10px] font-mono theme-text-muted truncate mt-0.5">{s.base_url}</p>
          </div>
          <span class="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-bold {s.running ? 'badge-status badge-status-info' : 'badge-status badge-status-muted'}">
            {s.running ? s.model_count + ' models' : (s.installed ? 'idle' : 'offline')}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}
