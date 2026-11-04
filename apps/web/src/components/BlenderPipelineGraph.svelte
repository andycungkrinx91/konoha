<script>
  let { steps = [], currentStep = 0, activeTool = '', activeNarrative = '', timings = [], isRunning = false } = $props();

  const NODE_W = 168;
  const NODE_H = 76;
  const GAP_X = 34;
  let hovered = $state(null);

  function timingFor(id) {
    return timings.find((t) => t.step_number === id) || null;
  }

  function nodeState(id) {
    // Stage ids are 1-based; currentStep === 0 means the run has not started.
    if (!currentStep) return 'pending';
    if (isRunning && id === currentStep) return 'running';
    if (id < currentStep) return 'done';
    if (id === currentStep && !isRunning) return 'done';
    return 'pending';
  }

  function nodeFill(id) {
    const s = nodeState(id);
    if (s === 'done') return 'rgba(16,185,129,0.14)';
    if (s === 'running') return 'rgba(6,182,212,0.18)';
    return 'var(--color-bg)';
  }

  function nodeStroke(id) {
    const s = nodeState(id);
    if (s === 'done') return 'rgb(16,185,129)';
    if (s === 'running') return 'rgb(6,182,212)';
    return 'var(--color-border)';
  }

  function nodeX(index) {
    return 20 + index * (NODE_W + GAP_X);
  }

  function edgePath(index) {
    const x1 = nodeX(index) + NODE_W;
    const y1 = 58;
    const x2 = nodeX(index + 1);
    const y2 = 58;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`;
  }

  const svgWidth = $derived(20 + steps.length * (NODE_W + GAP_X));
</script>

<div
  class="rounded-[5px] border overflow-x-auto"
  style="border-color: var(--color-border); background-color: var(--color-surface);"
>
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 pt-4 pb-2">
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-pulse-accent {isRunning ? 'animate-pulse' : ''}"></span>
      <h3 class="text-xs font-bold uppercase tracking-wider font-bold text-accent-themed">
        Agentic Blender Editing Pipeline
      </h3>
    </div>
    <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">
      {currentStep} / {steps.length} stages
    </span>
  </div>

  {#if activeNarrative}
    <p class="px-5 pb-2 text-[11px] font-mono truncate font-bold text-accent-themed" title={activeNarrative}>
      {activeNarrative}
    </p>
  {/if}

  <svg
    viewBox="0 0 {Math.max(svgWidth, 320)} 124"
    class="w-full min-w-[720px] h-[124px] px-2 pb-2"
    role="img"
    aria-label="Agentic Blender editing pipeline stages"
  >
    <defs>
      <linearGradient id="pipeline-flow" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgb(6,182,212)" stop-opacity="0" />
        <stop offset="50%" stop-color="rgb(6,182,212)" stop-opacity="1" />
        <stop offset="100%" stop-color="rgb(6,182,212)" stop-opacity="0" />
      </linearGradient>
      <filter id="pipeline-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    {#each steps as step, index}
      {#if index < steps.length - 1}
        {@const reached = nodeState(step.id) === 'done'}
        <path
          d={edgePath(index)}
          fill="none"
          stroke={reached ? 'rgb(16,185,129)' : 'var(--color-border)'}
          stroke-width="2"
          stroke-dasharray={reached ? '0' : '6 5'}
          class={isRunning && step.id === currentStep ? 'pipeline-edge-active' : ''}
        />
      {/if}
    {/each}

    {#each steps as step, index}
      {@const state = nodeState(step.id)}
      {@const timing = timingFor(step.id)}
      <g
        role="button"
        tabindex="0"
        onmouseenter={() => (hovered = step.id)}
        onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = step.id)}
        onblur={() => (hovered = null)}
        style="cursor: pointer;"
      >
        <rect
          x={nodeX(index)}
          y="20"
          width={NODE_W}
          height={NODE_H}
          rx="8"
          fill={nodeFill(step.id)}
          stroke={nodeStroke(step.id)}
          stroke-width={hovered === step.id ? '2.5' : '1.5'}
          filter={state === 'running' ? 'url(#pipeline-glow)' : undefined}
          class={state === 'running' ? 'pipeline-node-running' : ''}
        />
        <circle
          cx={nodeX(index) + 18}
          cy="38"
          r="9"
          fill={state === 'done' ? 'rgb(16,185,129)' : state === 'running' ? 'rgb(6,182,212)' : 'transparent'}
          stroke={state === 'pending' ? 'var(--color-border)' : 'none'}
          stroke-width="1.5"
        />
        <text
          x={nodeX(index) + 18}
          y="42"
          text-anchor="middle"
          font-size="10"
          font-weight="700"
          fill={state === 'pending' ? 'var(--color-text-muted)' : '#ffffff'}
        >{step.id}</text>

        <text x={nodeX(index) + 34} y="36" font-size="9" font-weight="700" fill="var(--color-text)">
          {step.name.length > 30 ? step.name.slice(0, 29) + '…' : step.name}
        </text>
        <text x={nodeX(index) + 34} y="50" font-size="8" font-family="monospace" fill="rgb(8,145,178)">
          {step.tool}
        </text>
        {#if timing}
          <text x={nodeX(index) + 12} y="72" font-size="8" font-family="monospace" fill="var(--color-text-muted)">
            {timing.elapsed_ms} ms · {timing.parameters?.triangles || 0} tris
          </text>
        {:else}
          <text x={nodeX(index) + 12} y="72" font-size="8" font-family="monospace" fill="var(--color-text-muted)">
            {state === 'running' ? 'executing…' : state === 'done' ? 'complete' : 'queued'}
          </text>
        {/if}
        {#if state === 'running'}
          <circle cx={nodeX(index) + NODE_W - 14} cy="34" r="4" fill="rgb(6,182,212)" class="pipeline-dot" />
        {/if}
      </g>
    {/each}
  </svg>

  {#if activeTool}
    <div class="px-5 pb-4 -mt-1 flex items-center gap-2">
      <span class="text-[10px] font-mono" style="color: var(--color-text-muted);">active tool</span>
      <code class="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-tint text-accent-themed">{activeTool}</code>
    </div>
  {/if}
</div>

<style>
  .pipeline-node-running {
    animation: pipeline-pulse 1.6s ease-in-out infinite;
  }

  .pipeline-dot {
    animation: pipeline-dot-move 1.4s ease-in-out infinite;
  }

  .pipeline-edge-active {
    animation: pipeline-dash 0.9s linear infinite;
    stroke-dasharray: 6 5;
  }

  @keyframes pipeline-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.72; }
  }

  @keyframes pipeline-dot-move {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }

  @keyframes pipeline-dash {
    to { stroke-dashoffset: -22; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pipeline-node-running,
    .pipeline-dot,
    .pipeline-edge-active {
      animation: none;
    }
  }
</style>
