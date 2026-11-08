<script>
  import { fly } from 'svelte/transition';

  let {
    selectedNode = null,
    recentCalls = [],
    tasks = [],
    lastUpdated = null,
    reducedMotion = false,
    formatRelativeTime = (ts) => ts || 'Standby'
  } = $props();

  function formatDuration(ms) {
    const val = Number(ms || 0);
    if (!val || val <= 0) return '< 1s';
    if (val < 1000) return `${val}ms`;
    const sec = Math.round(val / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m ${sec % 60}s`;
  }

  const correlatedTask = $derived.by(() => {
    if (!selectedNode) return null;
    if (selectedNode.task_id && tasks.length > 0) {
      const found = tasks.find((t) => String(t.id) === String(selectedNode.task_id));
      if (found) return found;
    }
    if (selectedNode.type === 'agent' && tasks.length > 0) {
      return tasks.find((t) => t.agent === selectedNode.key) || null;
    }
    return null;
  });
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
          data-testid="inspector-node-status"
        >
          {selectedNode.execution_status || selectedNode.status || (selectedNode.active ? 'running' : 'paused')}
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
          <p class="text-[10px] uppercase font-bold" style="color: var(--color-text-muted);">Duration / Latency</p>
          <p class="text-xs font-bold font-mono mt-1 truncate" style="color: var(--color-text);">
            {formatDuration(selectedNode.duration_ms || correlatedTask?.duration_ms)}
          </p>
        </div>
      </div>

      <div class="p-3 rounded-[4px] border space-y-1.5 text-[11px] font-mono theme-bg-surface" style="border-color: var(--color-border);" data-testid="inspector-execution-metadata">
        <div class="flex items-center justify-between gap-2">
          <span style="color: var(--color-text-muted);">Agent / Client:</span>
          <span class="font-bold" style="color: var(--color-text);">
            {selectedNode.type === 'agent' ? selectedNode.label : `@${correlatedTask?.agent || 'sannin'}`} · {selectedNode.client || correlatedTask?.client || 'antigravity'}
          </span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span style="color: var(--color-text-muted);">Task ID / Tool:</span>
          <span class="font-bold" style="color: var(--color-text);">
            #{selectedNode.task_id || correlatedTask?.id || 'standby'} · {selectedNode.type === 'tool' ? selectedNode.key : (selectedNode.tool || correlatedTask?.tool || 'sannin')}
          </span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span style="color: var(--color-text-muted);">Workflow / Phase:</span>
          <span class="font-bold" style="color: var(--color-primary);">
            {selectedNode.workflow || correlatedTask?.workflow || selectedNode.phase || 'sdlc-langgraph'}
          </span>
        </div>
        <div class="pt-1 border-t" style="border-color: var(--color-border);">
          <span class="block text-[10px] uppercase font-bold" style="color: var(--color-text-muted);">Execution Evidence:</span>
          <p class="text-[11px] mt-0.5 break-words" style="color: var(--color-text);">
            {selectedNode.evidence || correlatedTask?.evidence || 'Verified runtime telemetry'}
          </p>
        </div>
      </div>

      {#if selectedNode.task_title || correlatedTask?.title}
        <div class="p-3 rounded-[4px] border" style="border-color: var(--color-primary); background: var(--color-primary-glow);">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--color-primary);">Assigned SDLC Task #{selectedNode.task_id || correlatedTask?.id}</p>
          <p class="text-xs font-bold mt-1" style="color: var(--color-text);">{selectedNode.task_title || correlatedTask?.title}</p>
          <p class="text-[11px] font-mono mt-0.5" style="color: var(--color-text-muted);">
            State: {selectedNode.execution_status || correlatedTask?.execution_status || 'running'} · Phase: {selectedNode.phase || correlatedTask?.phase || 'implementation'}
          </p>
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
      <div class="space-y-2 max-h-[260px] overflow-y-auto pr-1 scrollbar-thin">
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
