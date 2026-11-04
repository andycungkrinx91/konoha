<script>
  let { telemetry = {}, period = 'today', periods = [], loading = false, onSelectPeriod = () => {} } = $props();

  function formatCount(value) {
    const n = Number(value) || 0;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }
</script>

<div
  class="glass-card-3d p-4 rounded-[5px] border border-[var(--color-border)]"
  style="background-color: var(--color-surface);"
>
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--color-border)]">
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full bg-pulse-accent animate-pulse"></span>
      <h2 class="text-xs font-extrabold uppercase tracking-widest text-accent-themed">
        Real 3D Token &amp; Cost Counter
      </h2>
      {#if loading}
        <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">syncing…</span>
      {/if}
    </div>

    <div class="flex items-center gap-1 bg-surface-tint p-1 rounded-[5px] border border-[var(--color-border)]">
      {#each periods as tp}
        <button
          type="button"
          onclick={() => onSelectPeriod(tp.id)}
          class="px-2.5 py-1 text-[11px] font-bold rounded-[3px] transition-all cursor-pointer"
          style="background-color: {period === tp.id ? 'rgba(6,182,212,0.16)' : 'transparent'};
            color: {period === tp.id ? 'rgb(8,145,178)' : 'var(--color-text-muted)'};"
        >
          {tp.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
    <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
      <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Total Requests</span>
      <p class="text-lg font-black mt-0.5 tabular-nums font-mono" style="color: var(--color-text);">{formatCount(telemetry.total_requests)}</p>
    </div>
    <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
      <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Total Input Tokens</span>
      <p class="text-lg font-black mt-0.5 tabular-nums font-mono" style="color: var(--color-text);">{formatCount(telemetry.total_input_tokens)}</p>
    </div>
    <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
      <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">Total Output Tokens</span>
      <p class="text-lg font-black mt-0.5 tabular-nums font-mono" style="color: var(--color-text);">{formatCount(telemetry.total_output_tokens)}</p>
    </div>
    <div class="p-3 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
      <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-text-muted);">EST. Cost (USD)</span>
      <p class="text-lg font-black mt-0.5 tabular-nums font-mono text-status-success">
        ${(telemetry.est_cost_usd || 0).toFixed(4)}
      </p>
    </div>
  </div>
</div>
