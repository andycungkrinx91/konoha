<script>
  import { onMount } from 'svelte';
  import { apiRequest } from '#lib/api.js';
  import { toast } from '#lib/state/toast.svelte.ts';
  import PageHero from './PageHero.svelte';

  let loading = $state(true);
  let installing = $state(false);
  let statusData = $state(null);
  let installLogs = $state([]);
  let showLogModal = $state(false);

  async function loadStatus() {
    loading = true;
    try {
      const data = await apiRequest('/api/v1/3d/setup/status');
      statusData = data;
    } catch (err) {
      toast.error('Failed to load 3D setup status: ' + (err.message || err));
    } finally {
      loading = false;
    }
  }

  async function triggerInstall() {
    if (installing) return;
    installing = true;
    showLogModal = true;
    installLogs = ['Initiating OS-aware Blender and DCC-MCP toolchain installer...'];

    try {
      const res = await apiRequest('/api/v1/3d/setup/install', {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (res.logs) {
        installLogs = [...installLogs, ...res.logs];
      }
      toast.success('3D Toolchain installation verified successfully!');
      await loadStatus();
    } catch (err) {
      installLogs = [...installLogs, `ERROR: ${err.message || err}`];
      toast.error('Installation failed: ' + (err.message || err));
    } finally {
      installing = false;
    }
  }

  async function launchBlenderGui() {
    try {
      const res = await apiRequest('/api/v1/3d/setup/blender/launch', {
        method: 'POST',
        body: JSON.stringify({ gui: true })
      });
      if (res.session?.running) {
        toast.success(`Live Blender session active (PID ${res.session.pid})`);
      } else {
        toast.warning(res.session?.reason || 'Could not launch Blender GUI');
      }
      await loadStatus();
    } catch (err) {
      toast.error('Failed to launch Blender: ' + (err.message || err));
    }
  }

  async function terminateBlender() {
    try {
      await apiRequest('/api/v1/3d/setup/blender/close', {
        method: 'POST',
        body: JSON.stringify({})
      });
      toast.success('Live Blender session closed cleanly.');
      await loadStatus();
    } catch (err) {
      toast.error('Failed to close Blender session: ' + (err.message || err));
    }
  }

  onMount(() => {
    loadStatus();
  });
</script>

<div class="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
  <!-- Console Page Hero -->
  <PageHero
    title="Yamanaka 3D Toolchain Setup"
    badgeText={`Blender ${statusData?.toolchain?.components?.blender?.version || 'detected at runtime'}`}
    description="OS-aware auto-installer for Blender LTS, DCC-MCP Python bridge, hardware acceleration, and live agentic editing."
  >
    {#snippet actions()}
      <div class="flex items-center gap-3">
        <button
          type="button"
          onclick={loadStatus}
          disabled={loading}
          class="btn-3d px-4 py-2 rounded-[5px] text-xs font-bold border flex items-center gap-2 cursor-pointer transition-all"
          style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
        >
          <svg class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh Status
        </button>

        <button
          type="button"
          onclick={triggerInstall}
          disabled={installing}
          class="btn-3d px-4 py-2 rounded-[5px] text-xs font-extrabold flex items-center gap-2 cursor-pointer shadow-md transition-all"
          style="background: var(--theme-gradient); color: #ffffff;"
        >
          {#if installing}
            <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>Installing...</span>
          {:else}
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>One-Click Auto-Install</span>
          {/if}
        </button>
      </div>
    {/snippet}
  </PageHero>

  <!-- Hardware Detection & Acceleration Card -->
  <div class="glass-card-3d p-6 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border); box-shadow: var(--shadow-3d);">
    <div class="flex items-center justify-between pb-4 border-b" style="border-color: var(--color-border);">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-[5px] flex items-center justify-center font-bold text-xs" style="background-color: var(--color-primary-glow); color: var(--color-primary);">
          GPU
        </div>
        <div>
          <h2 class="text-sm font-bold" style="color: var(--color-text);">Hardware Acceleration & Compute Engine</h2>
          <p class="text-xs" style="color: var(--color-text-muted);">Real-time device detection with Force GPU and automatic seamless CPU fallback</p>
        </div>
      </div>
      {#if statusData?.hardware?.hasGpu}
        <span class="px-2.5 py-1 text-xs font-bold rounded-[5px] badge-status-success">
          GPU Acceleration Detected ({statusData.hardware.primaryBackend})
        </span>
      {:else}
        <span class="px-2.5 py-1 text-xs font-bold rounded-[5px] badge-status-info">
          CPU Engine Active (High Performance)
        </span>
      {/if}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <div class="p-4 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] uppercase font-bold tracking-wider" style="color: var(--color-text-muted);">Primary Compute Backend</span>
        <p class="text-sm font-extrabold mt-1" style="color: var(--color-text);">{statusData?.hardware?.primaryBackend || 'CPU'}</p>
      </div>
      <div class="p-4 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] uppercase font-bold tracking-wider" style="color: var(--color-text-muted);">Detected Hardware Backends</span>
        <p class="text-xs font-mono mt-1" style="color: var(--color-text);">{statusData?.hardware?.detectedBackends?.join(', ') || 'CPU'}</p>
      </div>
      <div class="p-4 rounded-[5px] border" style="background-color: var(--color-bg); border-color: var(--color-border);">
        <span class="text-[10px] uppercase font-bold tracking-wider" style="color: var(--color-text-muted);">OS & Architecture</span>
        <p class="text-sm font-extrabold mt-1" style="color: var(--color-text);">{statusData?.toolchain?.os || 'Linux x64'}</p>
      </div>
    </div>
  </div>

  <!-- Toolchain Component Status Grid -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <!-- Component 1: Three.js & Manifold 3D -->
    <div class="glass-card-3d p-6 rounded-[5px] border flex flex-col justify-between" style="background-color: var(--color-surface); border-color: var(--color-border);">
      <div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-bold uppercase tracking-wider text-accent-themed">Core Runtime</span>
          <span class="px-2 py-0.5 text-[10px] font-extrabold rounded badge-status-success">
            {statusData?.toolchain?.components?.three_manifold?.ready_state || 'Ready'}
          </span>
        </div>
        <h3 class="text-base font-extrabold" style="color: var(--color-text);">Three.js & Manifold 3D</h3>
        <p class="text-xs mt-1" style="color: var(--color-text-muted);">Three.js 0.187.0 + Manifold 3.2.1 watertight geometry kernel & CSG booleans.</p>
      </div>
      <div class="mt-6 pt-3 border-t text-[11px] font-mono" style="border-color: var(--color-border); color: var(--color-text-muted);">
        Package: manifold-3d@3.2.1
      </div>
    </div>

    <!-- Component 2: Blender (version detected at runtime) -->
    <div class="glass-card-3d p-6 rounded-[5px] border flex flex-col justify-between" style="background-color: var(--color-surface); border-color: var(--color-border);">
      <div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-bold uppercase tracking-wider text-accent-themed">DCC Suite</span>
          {#if statusData?.toolchain?.components?.blender?.ready_state === 'Ready'}
            <span class="px-2 py-0.5 text-[10px] font-extrabold rounded badge-status-success">Ready</span>
          {:else}
            <span class="px-2 py-0.5 text-[10px] font-extrabold rounded badge-status-warning">Not Installed</span>
          {/if}
        </div>
        <h3 class="text-base font-extrabold" style="color: var(--color-text);">Blender {statusData?.toolchain?.components?.blender?.version || 'Not detected'}</h3>
        <p class="text-xs mt-1" style="color: var(--color-text-muted);">Detected local installation with Principled BSDF v2, weighted normals and EEVEE/Workbench render engines.</p>
      </div>
      <div class="mt-6 pt-3 border-t text-[11px] font-mono truncate" style="border-color: var(--color-border); color: var(--color-text-muted);" title={statusData?.toolchain?.components?.blender?.path || 'None'}>
        Path: {statusData?.toolchain?.components?.blender?.path || 'not resolved'}
      </div>
    </div>

    <!-- Component 3: DCC-MCP-Blender -->
    <div class="glass-card-3d p-6 rounded-[5px] border flex flex-col justify-between" style="background-color: var(--color-surface); border-color: var(--color-border);">
      <div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-bold uppercase tracking-wider text-accent-themed">Agentic Bridge</span>
          {#if statusData?.toolchain?.components?.dcc_mcp_blender?.ready_state === 'Ready'}
            <span class="px-2 py-0.5 text-[10px] font-extrabold rounded badge-status-success">Ready</span>
          {:else}
            <span class="px-2 py-0.5 text-[10px] font-extrabold rounded badge-status-warning">Not Installed</span>
          {/if}
        </div>
        <h3 class="text-base font-extrabold" style="color: var(--color-text);">DCC-MCP-Blender</h3>
        <p class="text-xs mt-1" style="color: var(--color-text-muted);">Python bridge verified inside Blender enabling autonomous 6-step agentic refinement streaming.</p>
      </div>
      <div class="mt-6 pt-3 border-t text-[11px] font-mono" style="border-color: var(--color-border); color: var(--color-text-muted);">
        Package: dcc-mcp-blender@{statusData?.toolchain?.components?.dcc_mcp_blender?.version || 'not installed'}
      </div>
    </div>
  </div>

  <!-- Live Blender Session Control Card -->
  <div class="glass-card-3d p-6 rounded-[5px] border" style="background-color: var(--color-surface); border-color: var(--color-border);">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full {statusData?.live_session?.running ? 'bg-status-success animate-pulse' : 'bg-slate-400'}"></span>
          <h3 class="text-sm font-bold" style="color: var(--color-text);">
            Live Agentic Blender Session: {statusData?.live_session?.running ? `Running (PID ${statusData.live_session.pid})` : 'Inactive'}
          </h3>
        </div>
        <p class="text-xs mt-1" style="color: var(--color-text-muted);">
          System-wide singleton session. You can launch a visible GUI window for interactive inspection or terminate lingering sessions.
        </p>
      </div>

      <div class="flex items-center gap-3">
        {#if statusData?.live_session?.running}
          <button
            type="button"
            onclick={terminateBlender}
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold badge-status-danger hover:bg-red-500/20 transition-all cursor-pointer"
          >
            Terminate Session
          </button>
        {:else}
          <button
            type="button"
            onclick={launchBlenderGui}
            class="btn-3d px-3 py-1.5 rounded-[5px] text-xs font-bold border transition-all cursor-pointer"
            style="background-color: var(--color-surface); border-color: var(--color-border); color: var(--color-text);"
          >
            Launch GUI Session
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Installation Logs Modal -->
{#if showLogModal}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
    <div class="glass-card-3d w-full max-w-2xl rounded-[5px] border p-6 flex flex-col max-h-[80vh]" style="background-color: var(--color-surface); border-color: var(--color-border);">
      <div class="flex items-center justify-between pb-4 border-b" style="border-color: var(--color-border);">
        <h3 class="text-sm font-bold" style="color: var(--color-text);">3D Toolchain Installer Progress</h3>
        <button
          type="button"
          onclick={() => showLogModal = false}
          class="text-xs font-bold px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
        >
          Close
        </button>
      </div>

      <div class="mt-4 flex-1 overflow-y-auto bg-slate-950 p-4 rounded-[5px] font-mono text-xs text-slate-300 space-y-1">
        {#each installLogs as log}
          <p class="leading-relaxed">{log}</p>
        {/each}
        {#if installing}
          <div class="flex items-center gap-2 text-accent-themed mt-2">
            <div class="w-3 h-3 border-2 border-accent-themed border-t-transparent rounded-full animate-spin"></div>
            <span>Downloading and configuring toolchain packages...</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
