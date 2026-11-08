<script>
  let {
    features = {},
    formatTokens = (v) => String(v || 0),
    formatPct = (v) => `${Number(v || 0).toFixed(1)}%`,
    formatUsd = (v) => `$${Number(v || 0).toFixed(2)}`
  } = $props();
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
  <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
    <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Agent Roster</p>
    <div class="flex flex-wrap gap-1.5">
      {#each (features.agent_names || []).filter((n) => String(n).toLowerCase() !== 'yamanaka') as name}
        <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono badge-3d-subtle">{name}</span>
      {/each}
      {#if !(features.agent_names || []).length}
        <p class="text-xs" style="color: var(--color-text-muted);">No agents registered.</p>
      {/if}
    </div>
  </div>

  <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
    <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Bridge Fleet</p>
    <div class="space-y-1.5">
      {#each features.bridges_detail || [] as b}
        <div class="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5" style="border-color: var(--color-border);">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0" style="background: {b.running ? '#059669' : (b.enabled ? '#d97706' : '#94a3b8')};"></span>
            <span class="text-xs font-bold font-mono truncate" style="color: var(--color-text);">{b.name}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">{b.provider} · :{b.port}</span>
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full font-mono" style={b.enabled ? 'color:#059669;background:rgba(5,150,105,0.1);' : 'color:#94a3b8;background:rgba(148,163,184,0.15);'}>{b.enabled ? 'on' : 'off'}</span>
          </div>
        </div>
      {/each}
      {#if !(features.bridges_detail || []).length}
        <p class="text-xs" style="color: var(--color-text-muted);">No bridges configured.</p>
      {/if}
    </div>
  </div>

  <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
    <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Client Coverage</p>
    <div class="flex flex-wrap gap-1.5">
      {#each features.clients_detail || [] as c}
        <span class="flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg font-mono border"
          style={c.configured ? 'color:#059669;border-color:rgba(5,150,105,0.4);background:rgba(5,150,105,0.08);' : 'color:var(--color-text-muted);border-color:var(--color-border);'}>
          {#if c.configured}
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
          {:else}
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          {/if}
          {c.name}
        </span>
      {/each}
    </div>
  </div>

  <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
    <p class="text-[10px] font-bold uppercase tracking-wider mb-3" style="color: var(--color-text-muted);">Token Savings Detail</p>
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-xl border p-2" style="border-color: var(--color-border);">
        <p class="text-[9px] font-bold uppercase" style="color: var(--color-text-muted);">Today</p>
        <p class="text-base font-black tabular-nums" style="color: var(--color-accent);">{formatTokens(features.savings_today_tokens)}</p>
        <p class="text-[9px] font-mono" style="color: var(--color-text-muted);">{features.savings_today_calls ?? 0} calls · {formatPct(features.savings_today_pct)}</p>
      </div>
      <div class="rounded-xl border p-2" style="border-color: var(--color-border);">
        <p class="text-[9px] font-bold uppercase" style="color: var(--color-text-muted);">7 Days</p>
        <p class="text-base font-black tabular-nums" style="color: var(--color-accent);">{formatTokens(features.savings_7d_tokens)}</p>
        <p class="text-[9px] font-mono" style="color: var(--color-text-muted);">{features.savings_7d_calls ?? 0} calls · {formatPct(features.savings_7d_pct)}</p>
      </div>
      <div class="rounded-xl border p-2" style="border-color: var(--color-border);">
        <p class="text-[9px] font-bold uppercase" style="color: var(--color-text-muted);">All-Time</p>
        <p class="text-base font-black tabular-nums" style="color: var(--color-accent);">{formatTokens(features.savings_alltime_tokens)}</p>
        <p class="text-[9px] font-mono" style="color: var(--color-text-muted);">{features.savings_alltime_calls ?? 0} calls · {formatPct(features.savings_alltime_pct)}</p>
      </div>
    </div>
    <p class="text-[10px] font-mono mt-2.5 pt-2.5 border-t text-center" style="border-color: var(--color-border); color: var(--color-text-muted);">
      {#if typeof features.savings_alltime_usd === 'number' && features.savings_alltime_usd < 0}
        ≈ {formatUsd(features.savings_alltime_usd)} net cost all-time
      {:else}
        ≈ {formatUsd(features.savings_alltime_usd)} net saved all-time
      {/if}
    </p>
  </div>

  <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
    <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">Skills &amp; Vector Index</p>
    <div class="flex flex-wrap gap-1.5 mb-3">
      {#each Object.entries(features.skills_by_type || {}) as [type, count]}
        <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono badge-3d-subtle">{type} {count}</span>
      {/each}
    </div>
    <div class="flex justify-between text-[10px] font-mono mb-1" style="color: var(--color-text-muted);">
      <span>Embedded chunks</span>
      <span>{features.embedded_chunks ?? 0}/{features.vectors_total_chunks ?? 0}</span>
    </div>
    <div class="h-2 rounded-full overflow-hidden border" style="border-color: var(--color-border);">
      <div class="h-full rounded-full transition-all duration-500" style="width: {(features.vectors_total_chunks ?? 0) > 0 ? ((features.embedded_chunks ?? 0) / features.vectors_total_chunks) * 100 : 0}%; background: var(--color-primary);"></div>
    </div>
    <p class="text-[10px] font-mono mt-2" style="color: var(--color-text-muted);">IBM Granite 384-dim · MS MARCO MiniLM Cross-Encoder · RRF + Cosine RAG</p>
  </div>

  <div class="rounded-2xl border p-4" style="border-color: var(--color-border);">
    <p class="text-[10px] font-bold uppercase tracking-wider mb-2.5" style="color: var(--color-text-muted);">SDLC Governance</p>
    <div class="flex flex-wrap gap-1.5 mb-3">
      <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono border" style="color: {(features.sdlc_dor_mode ?? 'advisory') === 'enforced' ? '#dc2626' : '#d97706'}; border-color: var(--color-border);">DoR: {features.sdlc_dor_mode ?? 'advisory'}</span>
      <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono border" style="color: var(--color-text); border-color: var(--color-border);">Review: {features.sdlc_review_mode ?? 'self'}</span>
      <span class="text-[10px] font-bold px-2 py-1 rounded-lg font-mono border" style="color: #7c3aed; border-color: var(--color-border);">{features.sdlc_verified ?? 0} verified</span>
    </div>
    <p class="text-[10px] font-mono" style="color: var(--color-text-muted);">{features.sdlc_total ?? 0} tasks tracked · 7-cycle remediation breaker</p>
  </div>
</div>
