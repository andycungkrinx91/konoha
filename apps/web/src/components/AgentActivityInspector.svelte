<script>
  import { fly } from 'svelte/transition';

  let {
    selectedNode = null,
    recentCalls = [],
    lastUpdated = null,
    reducedMotion = false,
    formatRelativeTime = (ts) => ts || 'Standby'
  } = $props();
</script>

<div class="xl:col-span-4 space-y-4">
  {#if selectedNode}
    <div
      class="glass-card-3d p-5 rounded-[5px] border space-y-4"
      style="border-color: var(--color-border);"
      data-testid="activity-node-inspector"
      in:fly={{ y: 10, duration: reducedMotion ? 0 : 220 }}
    >
      <div class="flex items-start justify-between gap-3 border-b pb-3" style="border-color: var(--color-border);">
        <div>
          <span class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-[4px] border" style="border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-glow);">
            {selectedNode.type}
          </span>
          <h3 class="text-lg font-black mt-1.5" style="color: var(--color-text);" data-testid="inspector-node-label">
            {selectedNode.label}
          </h3>
          <p class="text-xs font-medium" style="color: var(--color-text-muted);">
            {selectedNode.role || selectedNode.category || 'Runtime Execution Node'}
          </p>
        </div>
        <span
          class="px-2.5 py-1 rounded-[4px] text-[10px] font-mono font-bold uppercase border"
          style="border-color: {selectedNode.active ? 'var(--theme-success)' : 'var(--color-border)'}; color: {selectedNode.active ? 'var(--theme-success)' : 'var(--color-text-muted)'};"
        >
          {selectedNode.status || (selectedNode.active ? 'active' : 'standby')}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-2.5 text-xs">
        <div class="p-2.5 rounded-[4px] border theme-bg-surface" style="border-color: var(--color-border);">
          <p class="text-[10px] uppercase font-bold" style="color: var(--color-text-muted);">Invocations</p>
          <p class="text-base font-black font-mono mt-0.5" style="color: var(--color-text);">
            {(selectedNode.call_count || 0).toLocaleString()}
          </p>
        </div>
        <div class="p-2.5 rounded-[4px] border theme-bg-surface" style="border-color: var(--color-border);">
          <p class="text-[10px] uppercase font-bold" style="color: var(--color-text-muted);">Tokens Saved</p>
          <p class="text-base font-black font-mono mt-0.5" style="color: var(--theme-grad-1);">
            {(selectedNode.tokens_saved || 0).toLocaleString()}
          </p>
        </div>
        <div class="p-2.5 rounded-[4px] border theme-bg-surface" style="border-color: var(--color-border);">
          <p class="text-[10px] uppercase font-bold" style="color: var(--color-text-muted);">Last Activity</p>
          <p class="text-xs font-bold font-mono mt-1" style="color: var(--color-text);">
            {formatRelativeTime(selectedNode.last_active_at)}
          </p>
        </div>
        <div class="p-2.5 rounded-[4px] border theme-bg-surface" style="border-color: var(--color-border);">
          <p class="text-[10px] uppercase font-bold" style="color: var(--color-text-muted);">
            {selectedNode.type === 'agent' ? 'Model / Skills' : 'Session / Scope'}
          </p>
          <p class="text-xs font-bold font-mono mt-1 truncate" style="color: var(--color-text);">
            {#if selectedNode.type === 'agent'}
              {selectedNode.model || 'inherit'} · {selectedNode.skills_count || 1} skills
            {:else if selectedNode.type === 'client'}
              {selectedNode.turn_count || 0} turns
            {:else}
              Bounded MCP
            {/if}
          </p>
        </div>
      </div>

      {#if selectedNode.task_title}
        <div class="p-3 rounded-[4px] border" style="border-color: var(--color-primary); background: var(--color-primary-glow);">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-primary);">Assigned SDLC Task #{selectedNode.task_id}</p>
          <p class="text-xs font-bold mt-1" style="color: var(--color-text);">{selectedNode.task_title}</p>
          <p class="text-[11px] font-mono mt-0.5" style="color: var(--color-text-muted);">Phase: {selectedNode.phase || 'implementation'}</p>
        </div>
      {/if}
    </div>
  {/if}

  <div class="glass-card-3d p-5 rounded-[5px] border space-y-3" style="border-color: var(--color-border);">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-black uppercase tracking-wider" style="color: var(--color-text);">Live MCP Execution Stream</h3>
      <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">
        {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Syncing...'}
      </span>
    </div>

    {#if !recentCalls || recentCalls.length === 0}
      <div class="p-4 rounded-[4px] border text-center" style="border-color: var(--color-border);">
        <p class="text-xs font-semibold" style="color: var(--color-text-muted);">No recent MCP tool invocations recorded in this window.</p>
      </div>
    {:else}
      <div class="space-y-2 max-h-[290px] overflow-y-auto pr-1 scrollbar-thin">
        {#each recentCalls.slice(0, 10) as call (call.id)}
          <div class="p-2.5 rounded-[4px] border theme-bg-surface flex items-start justify-between gap-2 text-xs" style="border-color: var(--color-border);">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-mono font-bold text-[11px]" style="color: var(--color-primary);">@{call.agent}</span>
                <span style="color: var(--color-text-muted);">→</span>
                <span class="font-mono font-extrabold text-[11px] truncate" style="color: var(--color-text);">{call.tool}</span>
              </div>
              {#if call.query}
                <p class="text-[10px] font-mono truncate mt-0.5" style="color: var(--color-text-muted);">{call.query}</p>
              {/if}
            </div>
            <div class="text-right shrink-0">
              <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-[3px] border" style="border-color: var(--color-border); color: var(--theme-grad-1);">
                +{(call.tokens_saved || 0).toLocaleString()} tok
              </span>
              <p class="text-[9px] font-mono mt-0.5" style="color: var(--color-text-muted);">{call.client}</p>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
