<script>
  import { fade } from 'svelte/transition';

  let {
    nodes = [],
    tasks = [],
    selectedNodeId = '',
    onSelectNode = () => {},
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

  function statusBadgeColor(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'running' || s === 'executing' || s === 'in_progress') return 'var(--theme-success)';
    if (s === 'completed' || s === 'verified') return 'var(--theme-grad-1)';
    if (s === 'failed' || s === 'error') return 'var(--theme-danger, #ef4444)';
    if (s === 'awaiting-approval' || s.includes('pending_')) return 'var(--theme-warning, #f59e0b)';
    if (s === 'queued') return 'var(--theme-grad-2)';
    return 'var(--color-text-muted)';
  }
</script>

<div class="glass-card-3d p-6 rounded-[5px] border space-y-6" style="border-color: var(--color-border);" data-testid="activity-accessible-table" in:fade={{ duration: 150 }}>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-base font-black" style="color: var(--color-text);">Structured Runtime Execution Matrix</h3>
      <p class="text-xs font-medium" style="color: var(--color-text-muted);">Complete node and SDLC task telemetry across agent, client, tool, workflow, status, duration, and evidence.</p>
    </div>
    <span class="text-[11px] font-mono px-2.5 py-1 rounded-[4px] border" style="border-color: var(--color-border); color: var(--color-text-muted);">
      {nodes.length} nodes · {tasks.length} tracked tasks
    </span>
  </div>

  <div class="overflow-x-auto">
    <table class="w-full text-left border-collapse text-xs">
      <thead>
        <tr class="border-b uppercase text-[10px] font-bold tracking-wider" style="border-color: var(--color-border); color: var(--color-text-muted);">
          <th class="py-2.5 px-3">Node</th>
          <th class="py-2.5 px-3">Type</th>
          <th class="py-2.5 px-3">Client / Scope</th>
          <th class="py-2.5 px-3">Task / Workflow</th>
          <th class="py-2.5 px-3">Status</th>
          <th class="py-2.5 px-3 text-right">Duration</th>
          <th class="py-2.5 px-3 text-right">Calls</th>
          <th class="py-2.5 px-3 text-right">Tokens Saved</th>
          <th class="py-2.5 px-3 text-right">Last Active</th>
        </tr>
      </thead>
      <tbody>
        {#each nodes as node (node.id)}
          {@const badgeTone = statusBadgeColor(node.execution_status || node.status)}
          <tr
            class="border-b hover-bg-subtle transition-colors cursor-pointer {selectedNodeId === node.id ? 'theme-bg-surface' : ''}"
            style="border-color: var(--color-border);"
            onclick={() => onSelectNode(node)}
          >
            <td class="py-2.5 px-3 font-mono font-bold" style="color: var(--color-text);">{node.label}</td>
            <td class="py-2.5 px-3 uppercase font-mono text-[10px]" style="color: var(--color-primary);">{node.type}</td>
            <td class="py-2.5 px-3 font-mono text-[11px]" style="color: var(--color-text-muted);">{node.client || node.category || 'antigravity'}</td>
            <td class="py-2.5 px-3 font-mono text-[11px]" style="color: var(--color-text-muted);">
              {#if node.task_id}
                #{node.task_id} · {node.workflow || node.phase || 'sdlc-langgraph'}
              {:else}
                {node.role || node.category || 'runtime'}
              {/if}
            </td>
            <td class="py-2.5 px-3">
              <span class="px-2 py-0.5 rounded-[4px] font-mono text-[10px] font-bold border uppercase" style="border-color: {badgeTone}; color: {badgeTone};">
                {node.execution_status || node.status}
              </span>
            </td>
            <td class="py-2.5 px-3 text-right font-mono" style="color: var(--color-text-muted);">{formatDuration(node.duration_ms)}</td>
            <td class="py-2.5 px-3 text-right font-mono">{(node.call_count || 0).toLocaleString()}</td>
            <td class="py-2.5 px-3 text-right font-mono font-bold" style="color: var(--theme-grad-1);">{(node.tokens_saved || 0).toLocaleString()}</td>
            <td class="py-2.5 px-3 text-right font-mono" style="color: var(--color-text-muted);">{formatRelativeTime(node.last_active_at)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if tasks.length > 0}
    <div class="pt-3 border-t space-y-3" style="border-color: var(--color-border);">
      <h4 class="text-xs font-black uppercase tracking-wider" style="color: var(--color-text);">SDLC Task Execution &amp; Evidence Ledger</h4>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="border-b uppercase text-[10px] font-bold tracking-wider" style="border-color: var(--color-border); color: var(--color-text-muted);">
              <th class="py-2 px-3">Task ID</th>
              <th class="py-2 px-3">Agent</th>
              <th class="py-2 px-3">Client</th>
              <th class="py-2 px-3">Tool</th>
              <th class="py-2 px-3">Workflow</th>
              <th class="py-2 px-3">State</th>
              <th class="py-2 px-3">Duration</th>
              <th class="py-2 px-3">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {#each tasks.slice(0, 12) as task (task.id)}
              {@const tTone = statusBadgeColor(task.execution_status || task.status)}
              <tr class="border-b hover-bg-subtle" style="border-color: var(--color-border);">
                <td class="py-2 px-3 font-mono font-bold" style="color: var(--color-text);">#{task.id}</td>
                <td class="py-2 px-3 font-mono" style="color: var(--color-primary);">@{task.agent}</td>
                <td class="py-2 px-3 font-mono">{task.client || 'antigravity'}</td>
                <td class="py-2 px-3 font-mono">{task.tool || 'sannin'}</td>
                <td class="py-2 px-3 font-mono">{task.workflow || task.phase || 'sdlc'}</td>
                <td class="py-2 px-3">
                  <span class="px-2 py-0.5 rounded-[4px] font-mono text-[10px] font-bold border uppercase" style="border-color: {tTone}; color: {tTone};">
                    {task.execution_status || task.status}
                  </span>
                </td>
                <td class="py-2 px-3 font-mono">{formatDuration(task.duration_ms)}</td>
                <td class="py-2 px-3 font-mono text-[11px] truncate max-w-[260px]" style="color: var(--color-text-muted);">{task.evidence || 'Verified runtime telemetry'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
