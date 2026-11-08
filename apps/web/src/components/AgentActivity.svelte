<script>
  import { onMount } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { fade } from 'svelte/transition';
  import { api } from '../lib/api.js';
  import PageHero from './PageHero.svelte';
  import AgentActivityInspector from './AgentActivityInspector.svelte';

  const POLL_MS = 4500;
  const VIEW_W = 1200;
  const VIEW_H = 740;
  const CENTER_X = 600;
  const CENTER_Y = 370;

  let snapshot = $state(null);
  let lastUpdated = $state(null);
  let viewMode = $state('spider');
  let reducedMotion = $state(false);
  let selectedNodeId = $state('agent:sannin');
  let filterType = $state('all');

  let zoomLevel = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let isPanning = $state(false);
  let panStartX = 0;
  let panStartY = 0;

  let isSpiderFlipped = $state(false);
  let spiderFlipCount = $state(0);
  let spiderPatrolPaused = $state(false);
  let spiderTargetNodeId = $state('agent:sannin');
  let spiderPhase = $state(0);

  const spiderX = new Spring(CENTER_X, { stiffness: 0.08, damping: 0.65 });
  const spiderY = new Spring(CENTER_Y, { stiffness: 0.08, damping: 0.65 });
  const spiderFlipAngle = new Spring(0, { stiffness: 0.14, damping: 0.52 });
  const spiderScale = new Spring(1, { stiffness: 0.2, damping: 0.58 });

  async function loadActivity() {
    try {
      const res = await api.get('/api/v1/activity/live?window=60&limit=60');
      if (res && res.ok) {
        snapshot = res;
        lastUpdated = new Date();
      }
    } catch (_) {
      // Retain last valid snapshot
    }
  }

  function computeGraphPositions(snap) {
    if (!snap?.graph?.nodes) return { nodes: [], edges: [], nodeById: new Map() };
    const rawNodes = snap.graph.nodes;
    const rawEdges = snap.graph.edges || [];
    const agentNodes = rawNodes.filter((n) => n.type === 'agent' && n.id !== 'agent:sannin');
    const clientNodes = rawNodes.filter((n) => n.type === 'client');
    const toolNodes = rawNodes.filter((n) => n.type === 'tool');

    const positioned = [];
    const nodeById = new Map();

    const hub = rawNodes.find((n) => n.id === 'agent:sannin') || {
      id: 'agent:sannin', key: 'sannin', type: 'agent', label: '@sannin',
      role: 'MCP Router & Orchestrator', status: 'standby', active: false, call_count: 0, tokens_saved: 0
    };
    const hubNode = { ...hub, x: CENTER_X, y: CENTER_Y, ring: 0 };
    positioned.push(hubNode);
    nodeById.set(hubNode.id, hubNode);

    const agentCount = Math.max(1, agentNodes.length);
    agentNodes.forEach((node, idx) => {
      const angle = (-Math.PI / 2) + ((idx / agentCount) * Math.PI * 2);
      const item = { ...node, x: CENTER_X + Math.cos(angle) * 172, y: CENTER_Y + Math.sin(angle) * 156, angle, ring: 1 };
      positioned.push(item);
      nodeById.set(item.id, item);
    });

    const clientCount = Math.max(1, clientNodes.length);
    clientNodes.forEach((node, idx) => {
      const t = clientCount === 1 ? 0.5 : idx / (clientCount - 1);
      const angle = (Math.PI * 0.62) + t * (Math.PI * 0.76);
      const item = { ...node, x: CENTER_X + Math.cos(angle) * 430, y: CENTER_Y + Math.sin(angle) * 265, angle, ring: 2 };
      positioned.push(item);
      nodeById.set(item.id, item);
    });

    const toolCount = Math.max(1, toolNodes.length);
    toolNodes.forEach((node, idx) => {
      const t = toolCount === 1 ? 0.5 : idx / (toolCount - 1);
      const angle = (-Math.PI * 0.38) + t * (Math.PI * 0.76);
      const item = { ...node, x: CENTER_X + Math.cos(angle) * 440, y: CENTER_Y + Math.sin(angle) * 270, angle, ring: 2 };
      positioned.push(item);
      nodeById.set(item.id, item);
    });

    const positionedEdges = rawEdges
      .map((edge) => {
        const src = nodeById.get(edge.source);
        const tgt = nodeById.get(edge.target);
        return src && tgt ? { ...edge, x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y } : null;
      })
      .filter(Boolean);

    return { nodes: positioned, edges: positionedEdges, nodeById };
  }

  const graphLayout = $derived(computeGraphPositions(snapshot));
  const visibleNodes = $derived(graphLayout.nodes.filter((n) => filterType === 'all' || n.type === filterType || n.id === 'agent:sannin'));
  const visibleNodeIds = $derived(new Set(visibleNodes.map((n) => n.id)));
  const visibleEdges = $derived(graphLayout.edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)));
  const selectedNode = $derived(graphLayout.nodeById.get(selectedNodeId) || graphLayout.nodeById.get('agent:sannin') || null);

  const spiderLegs = $derived.by(() => {
    const sx = spiderX.current;
    const sy = spiderY.current;
    const phase = spiderPhase;
    const allNodes = graphLayout.nodes.filter((n) => n.id !== spiderTargetNodeId);
    const activeTargets = allNodes.filter((n) => n.active);
    const candidates = activeTargets.length >= 4 ? activeTargets : allNodes;
    const legCount = Math.max(8, Math.min(12, (snapshot?.summary?.spider_leg_count || 8)));

    const sorted = [...candidates]
      .map((n) => ({ node: n, dist: Math.hypot(n.x - sx, n.y - sy) }))
      .sort((a, b) => (b.node.active ? 1 : 0) - (a.node.active ? 1 : 0) || a.dist - b.dist)
      .slice(0, legCount);

    return sorted.map((entry, idx) => {
      const side = idx % 2 === 0 ? 1 : -1;
      const tx = entry.node.x;
      const ty = entry.node.y;
      const dx = tx - sx;
      const dy = ty - sy;
      const reach = Math.min(Math.max(40, Math.hypot(dx, dy)) * 0.68, 155);
      const baseAngle = Math.atan2(dy, dx);
      const stride = reducedMotion ? 0 : Math.sin(phase * 2.4 + idx * 0.85) * 9;
      const footX = sx + Math.cos(baseAngle) * reach + Math.cos(baseAngle + Math.PI / 2) * stride;
      const footY = sy + Math.sin(baseAngle) * reach + Math.sin(baseAngle + Math.PI / 2) * stride;
      const kneeDist = reach * 0.54;
      const kneeLift = 26 * side + (reducedMotion ? 0 : Math.cos(phase * 2.4 + idx) * 6);
      const kneeX = sx + Math.cos(baseAngle) * kneeDist - Math.sin(baseAngle) * kneeLift;
      const kneeY = sy + Math.sin(baseAngle) * kneeDist + Math.cos(baseAngle) * kneeLift;

      return {
        id: `leg-${idx}-${entry.node.id}`,
        path: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${kneeX.toFixed(1)} ${kneeY.toFixed(1)} ${footX.toFixed(1)} ${footY.toFixed(1)}`,
        filamentPath: `M ${footX.toFixed(1)} ${footY.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`,
        footX,
        footY,
        active: entry.node.active
      };
    });
  });

  function triggerSpiderFlip(e) {
    if (e) e.stopPropagation();
    isSpiderFlipped = !isSpiderFlipped;
    spiderFlipCount += 1;
    spiderPatrolPaused = true;
    const targetDeg = spiderFlipCount * 180;
    if (reducedMotion) {
      spiderFlipAngle.set(targetDeg, { instant: true });
    } else {
      spiderScale.set(1.26);
      spiderFlipAngle.set(targetDeg);
      setTimeout(() => spiderScale.set(1), 360);
    }
    setTimeout(() => { spiderPatrolPaused = false; }, 1400);
  }

  function stepSpiderPatrol() {
    if (spiderPatrolPaused || !graphLayout.nodes.length) return;
    const activeNodes = graphLayout.nodes.filter((n) => n.active);
    const pool = activeNodes.length > 0 ? activeNodes : graphLayout.nodes.filter((n) => n.ring <= 1);
    const nextTarget = pool[Math.floor(Math.random() * pool.length)];
    if (!nextTarget) return;
    spiderTargetNodeId = nextTarget.id;
    const targetX = CENTER_X + (nextTarget.x - CENTER_X) * 0.46;
    const targetY = CENTER_Y + (nextTarget.y - CENTER_Y) * 0.46;
    spiderX.set(targetX, reducedMotion ? { instant: true } : undefined);
    spiderY.set(targetY, reducedMotion ? { instant: true } : undefined);
  }

  function selectNode(node, e) {
    if (e) e.stopPropagation();
    selectedNodeId = node.id;
    spiderTargetNodeId = node.id;
    spiderX.set(CENTER_X + (node.x - CENTER_X) * 0.42, reducedMotion ? { instant: true } : undefined);
    spiderY.set(CENTER_Y + (node.y - CENTER_Y) * 0.42, reducedMotion ? { instant: true } : undefined);
  }

  function zoomIn() { zoomLevel = Math.min(2.6, Number((zoomLevel + 0.2).toFixed(2))); }
  function zoomOut() { zoomLevel = Math.max(0.5, Number((zoomLevel - 0.2).toFixed(2))); }
  function resetViewport() {
    zoomLevel = 1; panX = 0; panY = 0;
    spiderX.set(CENTER_X, reducedMotion ? { instant: true } : undefined);
    spiderY.set(CENTER_Y, reducedMotion ? { instant: true } : undefined);
  }

  function handleWheel(e) {
    e.preventDefault();
    zoomLevel = Math.min(2.6, Math.max(0.5, Number((zoomLevel + (e.deltaY < 0 ? 0.12 : -0.12)).toFixed(2))));
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    isPanning = true; panStartX = e.clientX - panX; panStartY = e.clientY - panY;
  }
  function handlePointerMove(e) { if (isPanning) { panX = e.clientX - panStartX; panY = e.clientY - panStartY; } }
  function handlePointerUp() { isPanning = false; }

  function nodeTone(node) {
    if (node.type === 'agent') return node.active ? 'var(--theme-grad-1)' : 'var(--color-primary)';
    if (node.type === 'client') return node.active ? 'var(--theme-success)' : 'var(--theme-grad-2)';
    return node.active ? 'var(--theme-grad-3)' : 'var(--theme-grad-4)';
  }

  function formatRelativeTime(ts) {
    if (!ts) return 'Standby';
    const raw = String(ts).trim();
    const ms = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
    if (!Number.isFinite(ms)) return raw;
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 5) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  onMount(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reducedMotion = Boolean(mq?.matches);
    const onMqChange = (ev) => { reducedMotion = ev.matches; };
    mq?.addEventListener?.('change', onMqChange);

    loadActivity();
    const pollTimer = setInterval(loadActivity, POLL_MS);
    const patrolTimer = setInterval(stepSpiderPatrol, 3200);

    let animFrame;
    function tickPhase() {
      if (!reducedMotion && !spiderPatrolPaused) spiderPhase += 0.035;
      animFrame = requestAnimationFrame(tickPhase);
    }
    animFrame = requestAnimationFrame(tickPhase);

    let eventSource;
    try {
      eventSource = new EventSource('/api/v1/events');
      eventSource.addEventListener('agent_activity_updated', loadActivity);
      eventSource.addEventListener('sdlc_updated', loadActivity);
      eventSource.addEventListener('agents_updated', loadActivity);
    } catch (_) { /* polling fallback */ }

    return () => {
      clearInterval(pollTimer);
      clearInterval(patrolTimer);
      if (animFrame) cancelAnimationFrame(animFrame);
      if (eventSource) eventSource.close();
      mq?.removeEventListener?.('change', onMqChange);
    };
  });
</script>

<div class="space-y-6 animate-in fade-in duration-300" data-testid="agent-activity-page">
  <PageHero
    title="Live Agent Activity & Spider Network"
    badgeText="Runtime Execution Graph"
    description="Real-time neural spider topology mapping active ninja agents, MCP tool invocations, SDLC task boundaries, and connected client harnesses. Click the kinetic spider core to trigger a 180-degree chakra inversion flip."
  >
    {#snippet actions()}
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-[5px] border p-0.5 theme-bg-surface" style="border-color: var(--color-border);">
          <button
            type="button"
            onclick={() => { viewMode = 'spider'; }}
            class="px-3 py-1.5 rounded-[4px] text-xs font-bold transition-all cursor-pointer {viewMode === 'spider' ? 'text-white shadow-sm' : ''}"
            style={viewMode === 'spider' ? 'background: var(--theme-4gradient);' : 'color: var(--color-text-muted);'}
            data-testid="view-mode-spider"
          >Spider Canvas</button>
          <button
            type="button"
            onclick={() => { viewMode = 'table'; }}
            class="px-3 py-1.5 rounded-[4px] text-xs font-bold transition-all cursor-pointer {viewMode === 'table' ? 'text-white shadow-sm' : ''}"
            style={viewMode === 'table' ? 'background: var(--theme-4gradient);' : 'color: var(--color-text-muted);'}
            data-testid="view-mode-table"
          >Accessible Table</button>
        </div>

        <button
          type="button"
          onclick={triggerSpiderFlip}
          class="btn-3d px-3.5 py-2 rounded-[5px] text-xs font-extrabold border flex items-center gap-2 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-primary); color: var(--color-primary);"
          data-testid="spider-flip-btn"
          aria-label="Trigger 180-degree spider flip animation"
        >
          <svg class="w-4 h-4 transition-transform duration-500 {isSpiderFlipped ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>Flip Spider ({isSpiderFlipped ? 'Inverted 180°' : 'Normal 0°'})</span>
        </button>

        <button
          type="button"
          onclick={loadActivity}
          class="btn-3d px-3 py-2 rounded-[5px] text-xs font-bold border flex items-center gap-1.5 cursor-pointer theme-bg-surface"
          style="border-color: var(--color-border); color: var(--color-text);"
          title="Refresh live activity snapshot"
        >
          <span>Sync</span>
        </button>
      </div>
    {/snippet}
  </PageHero>

  {#if snapshot?.summary}
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <div class="metric-card-3d p-4 rounded-[5px] border" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Runtime State</p>
        <div class="flex items-center gap-2 mt-1.5">
          <span class="w-2.5 h-2.5 rounded-full {snapshot.summary.runtime_state === 'executing' ? 'animate-ping' : ''}" style="background: {snapshot.summary.runtime_state === 'executing' ? 'var(--theme-success)' : 'var(--theme-grad-1)'};"></span>
          <span class="text-lg font-black uppercase tracking-tight font-mono" style="color: var(--color-text);" data-testid="activity-runtime-state">{snapshot.summary.runtime_state}</span>
        </div>
        <p class="text-[11px] mt-1 font-medium" style="color: var(--color-text-muted);">Seq #{snapshot.seq}</p>
      </div>
      <div class="metric-card-3d p-4 rounded-[5px] border" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Active Agents</p>
        <p class="text-2xl font-black font-mono mt-1 tabular-nums" style="color: var(--theme-grad-1);">{snapshot.summary.active_agents}<span class="text-xs font-semibold" style="color: var(--color-text-muted);"> / {snapshot.summary.total_agents}</span></p>
        <p class="text-[11px] mt-1 font-medium" style="color: var(--color-text-muted);">Ninja Specialists</p>
      </div>
      <div class="metric-card-3d p-4 rounded-[5px] border" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Active MCP Tools</p>
        <p class="text-2xl font-black font-mono mt-1 tabular-nums" style="color: var(--theme-grad-2);">{snapshot.summary.active_tools}<span class="text-xs font-semibold" style="color: var(--color-text-muted);"> / {snapshot.summary.total_tools}</span></p>
        <p class="text-[11px] mt-1 font-medium" style="color: var(--color-text-muted);">{snapshot.summary.recent_calls_count} recent calls</p>
      </div>
      <div class="metric-card-3d p-4 rounded-[5px] border" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Connected Harnesses</p>
        <p class="text-2xl font-black font-mono mt-1 tabular-nums" style="color: var(--theme-success);">{snapshot.summary.connected_clients}<span class="text-xs font-semibold" style="color: var(--color-text-muted);"> / {snapshot.summary.total_clients}</span></p>
        <p class="text-[11px] mt-1 font-medium" style="color: var(--color-text-muted);">Global MCP synced</p>
      </div>
      <div class="metric-card-3d p-4 rounded-[5px] border" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Spider Filaments</p>
        <p class="text-2xl font-black font-mono mt-1 tabular-nums" style="color: var(--theme-grad-3);">{spiderLegs.length}<span class="text-xs font-semibold" style="color: var(--color-text-muted);"> legs</span></p>
        <p class="text-[11px] mt-1 font-medium" style="color: var(--color-text-muted);">{snapshot.summary.active_edges} active vectors</p>
      </div>
      <div class="metric-card-3d p-4 rounded-[5px] border" style="border-color: var(--color-border);">
        <p class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted);">Window Token Savings</p>
        <p class="text-2xl font-black font-mono mt-1 tabular-nums" style="color: var(--theme-grad-4);">{(snapshot.summary.recent_tokens_saved || 0).toLocaleString()}</p>
        <p class="text-[11px] mt-1 font-medium" style="color: var(--color-text-muted);">Bounded MCP reads</p>
      </div>
    </div>
  {/if}

  {#if viewMode === 'spider'}
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div class="xl:col-span-8 glass-card-3d rounded-[5px] border overflow-hidden relative select-none" style="border-color: var(--color-border); min-height: 620px;">
        <div class="p-3 border-b flex flex-wrap items-center justify-between gap-2 glass-frost z-20 relative" style="border-color: var(--color-border);">
          <div class="flex items-center gap-1.5">
            {#each [{ id: 'all', label: 'All Nodes' }, { id: 'agent', label: 'Agents' }, { id: 'client', label: 'Clients' }, { id: 'tool', label: 'MCP Tools' }] as tab}
              <button
                type="button"
                onclick={() => { filterType = tab.id; }}
                class="px-2.5 py-1 rounded-[4px] text-[11px] font-bold transition-colors cursor-pointer {filterType === tab.id ? 'text-white' : ''}"
                style={filterType === tab.id ? 'background: var(--theme-4gradient);' : 'color: var(--color-text-muted);'}
              >{tab.label}</button>
            {/each}
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick={zoomOut} class="w-7 h-7 rounded-[4px] border flex items-center justify-center text-xs font-bold cursor-pointer theme-bg-surface" style="border-color: var(--color-border); color: var(--color-text);" aria-label="Zoom out" data-testid="spider-zoom-out">−</button>
            <span class="text-[11px] font-mono font-bold px-2" style="color: var(--color-text);" data-testid="spider-zoom-level">{Math.round(zoomLevel * 100)}%</span>
            <button type="button" onclick={zoomIn} class="w-7 h-7 rounded-[4px] border flex items-center justify-center text-xs font-bold cursor-pointer theme-bg-surface" style="border-color: var(--color-border); color: var(--color-text);" aria-label="Zoom in" data-testid="spider-zoom-in">+</button>
            <button type="button" onclick={resetViewport} class="px-2.5 py-1 rounded-[4px] border text-[11px] font-bold cursor-pointer theme-bg-surface" style="border-color: var(--color-border); color: var(--color-text-muted);" data-testid="spider-reset-view">Reset View</button>
          </div>
        </div>

        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <svg
          viewBox="0 0 {VIEW_W} {VIEW_H}"
          class="w-full h-[560px] block {isPanning ? 'cursor-grabbing' : 'cursor-grab'}"
          role="application"
          aria-label="Interactive Konoha Agent Activity Spider Network"
          data-testid="agent-activity-spider-svg"
          onwheel={handleWheel}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerUp}
          onpointerleave={handlePointerUp}
        >
          <defs>
            <radialGradient id="spider-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="var(--theme-grad-1)" stop-opacity="0.55" />
              <stop offset="55%" stop-color="var(--theme-grad-2)" stop-opacity="0.22" />
              <stop offset="100%" stop-color="var(--theme-grad-4)" stop-opacity="0" />
            </radialGradient>
            <linearGradient id="spider-leg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="var(--theme-grad-1)" />
              <stop offset="50%" stop-color="var(--theme-grad-2)" />
              <stop offset="100%" stop-color="var(--theme-grad-3)" />
            </linearGradient>
            <linearGradient id="spider-body-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="var(--theme-grad-1)" />
              <stop offset="50%" stop-color="var(--theme-grad-2)" />
              <stop offset="100%" stop-color="var(--theme-grad-4)" />
            </linearGradient>
          </defs>

          <g transform="translate({panX}, {panY}) translate({CENTER_X}, {CENTER_Y}) scale({zoomLevel}) translate({-CENTER_X}, {-CENTER_Y})">
            {#each [110, 175, 260, 360, 445] as radius, rIdx}
              <ellipse cx={CENTER_X} cy={CENTER_Y} rx={radius} ry={radius * 0.66} fill="none" stroke="var(--color-border)" stroke-width={rIdx === 1 ? '1.3' : '0.8'} stroke-dasharray={rIdx % 2 === 0 ? '4 6' : 'none'} opacity="0.48" />
            {/each}

            <text x="155" y="54" font-size="11" font-weight="800" fill="var(--color-text-muted)" letter-spacing="2">CLIENT HARNESSES (8)</text>
            <text x={CENTER_X} y="54" text-anchor="middle" font-size="11" font-weight="800" fill="var(--color-primary)" letter-spacing="2">NINJA ORCHESTRATION RING</text>
            <text x="1045" y="54" text-anchor="end" font-size="11" font-weight="800" fill="var(--color-text-muted)" letter-spacing="2">MCP &amp; SEMBLE TOOLS</text>

            {#each visibleEdges as edge (edge.id)}
              <g>
                <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={edge.active ? 'var(--theme-grad-2)' : 'var(--color-border)'} stroke-width={edge.active ? '2.2' : '1.1'} stroke-opacity={edge.active ? '0.82' : '0.38'} stroke-dasharray={edge.active ? '6 4' : 'none'} />
                {#if edge.active && !reducedMotion}
                  <circle r="3.5" fill="var(--theme-grad-1)">
                    <animateMotion dur="2.1s" repeatCount="indefinite" path="M {edge.x1} {edge.y1} L {edge.x2} {edge.y2}" />
                  </circle>
                {/if}
              </g>
            {/each}

            {#each spiderLegs as leg (leg.id)}
              <g>
                <path d={leg.filamentPath} fill="none" stroke={leg.active ? 'var(--theme-grad-2)' : 'var(--color-border)'} stroke-width={leg.active ? '1.2' : '0.75'} stroke-dasharray="3 4" opacity={leg.active ? '0.75' : '0.4'} />
                <path d={leg.path} fill="none" stroke="url(#spider-leg-gradient)" stroke-width={leg.active ? '3.1' : '2.2'} stroke-linecap="round" opacity={leg.active ? '0.96' : '0.72'} />
                <circle cx={leg.footX} cy={leg.footY} r={leg.active ? '3.6' : '2.5'} fill={leg.active ? 'var(--theme-grad-1)' : 'var(--color-surface)'} stroke="var(--theme-grad-2)" stroke-width="1.5" />
              </g>
            {/each}

            {#each visibleNodes as node (node.id)}
              {@const isSelected = selectedNodeId === node.id}
              {@const tone = nodeTone(node)}
              {@const nodeRadius = node.id === 'agent:sannin' ? 30 : (node.type === 'agent' ? 23 : 19)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <g
                transform="translate({node.x}, {node.y})"
                class="cursor-pointer"
                role="button"
                tabindex="0"
                aria-label="{node.type} node {node.label} ({node.status})"
                data-testid="activity-node-{node.id}"
                onclick={(e) => selectNode(node, e)}
              >
                {#if node.active || isSelected}
                  <circle r={nodeRadius + 8} fill="none" stroke={tone} stroke-width={isSelected ? '2.5' : '1.4'} stroke-dasharray={isSelected ? 'none' : '4 3'} opacity="0.78" />
                {/if}
                <circle r={nodeRadius} fill="var(--color-surface)" stroke={tone} stroke-width={node.active || isSelected ? '2.8' : '1.8'} />
                <circle r={nodeRadius - 5} fill={tone} fill-opacity={node.active ? '0.2' : '0.08'} />
                <text y="4" text-anchor="middle" font-size={node.id === 'agent:sannin' ? '11' : '10'} font-weight="900" font-family="monospace" fill="var(--color-text)">
                  {node.type === 'agent' ? node.key.slice(0, 3).toUpperCase() : (node.type === 'client' ? 'CLI' : 'MCP')}
                </text>
                <g transform="translate(0, {nodeRadius + 15})">
                  <rect x="-54" y="-10" width="108" height="18" rx="4" fill="var(--color-surface)" stroke="var(--color-border)" stroke-width="1" opacity="0.94" />
                  <text y="2" text-anchor="middle" font-size="10" font-weight="800" fill="var(--color-text)">
                    {node.label.length > 15 ? `${node.label.slice(0, 14)}…` : node.label}
                  </text>
                </g>
              </g>
            {/each}

            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <g
              transform="translate({spiderX.current}, {spiderY.current}) scale({spiderScale.current}) rotate({spiderFlipAngle.current})"
              class="cursor-pointer"
              role="button"
              tabindex="0"
              aria-label="Konoha Execution Spider — Click to flip 180 degrees"
              data-testid="interactive-spider-core"
              onclick={triggerSpiderFlip}
            >
              <circle r="48" fill="url(#spider-core-glow)" />
              <circle r="28" fill="none" stroke="url(#spider-body-gradient)" stroke-width="2" stroke-dasharray="5 4" />
              <ellipse cx="0" cy="12" rx="13" ry="16" fill="url(#spider-body-gradient)" stroke="var(--color-surface)" stroke-width="2" />
              <circle cx="0" cy="-7" r="10" fill="var(--color-surface)" stroke="var(--theme-grad-1)" stroke-width="2.5" />
              <circle cx="-4" cy="-10" r="2.1" fill="var(--theme-grad-1)" />
              <circle cx="4" cy="-10" r="2.1" fill="var(--theme-grad-1)" />
              <circle cx="-2" cy="-13" r="1.4" fill="var(--theme-grad-2)" />
              <circle cx="2" cy="-13" r="1.4" fill="var(--theme-grad-2)" />
              <path d="M -5 12 L 0 5 L 5 12 L 0 19 Z" fill="var(--color-surface)" opacity="0.9" />
            </g>
          </g>
        </svg>

        <div class="px-4 py-2.5 border-t flex flex-wrap items-center justify-between gap-3 text-[11px] glass-frost" style="border-color: var(--color-border); color: var(--color-text-muted);">
          <div class="flex flex-wrap items-center gap-4">
            <span class="flex items-center gap-1.5 font-semibold"><span class="w-2.5 h-2.5 rounded-full" style="background: var(--theme-grad-1);"></span>Ninja Agent</span>
            <span class="flex items-center gap-1.5 font-semibold"><span class="w-2.5 h-2.5 rounded-full" style="background: var(--theme-success);"></span>Client Harness</span>
            <span class="flex items-center gap-1.5 font-semibold"><span class="w-2.5 h-2.5 rounded-full" style="background: var(--theme-grad-3);"></span>MCP / Semble Tool</span>
          </div>
          <div class="font-mono font-bold" data-testid="spider-flip-status">
            Spider Orientation: {isSpiderFlipped ? 'INVERTED (180°)' : 'UPRIGHT (0°)'} · Flips: {spiderFlipCount}
          </div>
        </div>
      </div>

      <AgentActivityInspector
        {selectedNode}
        recentCalls={snapshot?.recent_calls || []}
        {lastUpdated}
        {reducedMotion}
        {formatRelativeTime}
      />
    </div>
  {:else}
    <div class="glass-card-3d p-6 rounded-[5px] border space-y-4" style="border-color: var(--color-border);" data-testid="activity-accessible-table" in:fade={{ duration: 150 }}>
      <h3 class="text-base font-black" style="color: var(--color-text);">Structured Runtime Execution Matrix</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="border-b uppercase text-[10px] font-bold tracking-wider" style="border-color: var(--color-border); color: var(--color-text-muted);">
              <th class="py-2.5 px-3">Node</th>
              <th class="py-2.5 px-3">Type</th>
              <th class="py-2.5 px-3">Role / Category</th>
              <th class="py-2.5 px-3">Status</th>
              <th class="py-2.5 px-3 text-right">Calls</th>
              <th class="py-2.5 px-3 text-right">Tokens Saved</th>
              <th class="py-2.5 px-3 text-right">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {#each graphLayout.nodes as node (node.id)}
              <tr class="border-b hover-bg-subtle transition-colors" style="border-color: var(--color-border);">
                <td class="py-2.5 px-3 font-mono font-bold" style="color: var(--color-text);">{node.label}</td>
                <td class="py-2.5 px-3 uppercase font-mono text-[10px]" style="color: var(--color-primary);">{node.type}</td>
                <td class="py-2.5 px-3" style="color: var(--color-text-muted);">{node.role || node.category || '—'}</td>
                <td class="py-2.5 px-3">
                  <span class="px-2 py-0.5 rounded-[4px] font-mono text-[10px] font-bold border" style="border-color: {node.active ? 'var(--theme-success)' : 'var(--color-border)'}; color: {node.active ? 'var(--theme-success)' : 'var(--color-text-muted)'};">{node.status}</span>
                </td>
                <td class="py-2.5 px-3 text-right font-mono">{(node.call_count || 0).toLocaleString()}</td>
                <td class="py-2.5 px-3 text-right font-mono font-bold" style="color: var(--theme-grad-1);">{(node.tokens_saved || 0).toLocaleString()}</td>
                <td class="py-2.5 px-3 text-right font-mono" style="color: var(--color-text-muted);">{formatRelativeTime(node.last_active_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
