<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import { confirm } from "#lib/state/dialog.svelte.ts";
  import { useScrollLock } from "#lib/scrollLock.svelte.js";
  import PageHero from "./PageHero.svelte";

  let bridges = $state([]);
  let status = $state(null);
  let loading = $state(true);
  let error = $state("");
  let showCreateModal = $state(false);
  let gatewayBusy = $state(false);
  let showModelsModal = $state(false);
  let models = $state([]);
  let loadingModels = $state(false);
  let modelsSearch = $state("");
  let selectedBridgeFilter = $state("all");

  let newBridge = $state({
    name: "",
    port: 9001,
    provider: "openai",
    model: "",
    target_url: ""
  });

  async function loadData() {
    loading = true;
    error = "";
    try {
      bridges = await api.get("/api/v1/bridges");
      status = await api.get("/api/v1/bridges/status");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function startGateway() {
    gatewayBusy = true;
    try {
      await api.post("/api/v1/bridges/gateway/start");
      toast.success("Bridge Proxy Gateway is running on port 19999.");
      await loadData();
    } catch (err) {
      toast.error("Gateway start failed: " + err.message);
    } finally {
      gatewayBusy = false;
    }
  }

  async function stopGateway() {
    const confirmed = await confirm({
      title: "Stop Gateway?",
      message: "Stopping the Bridge Proxy Gateway will interrupt local model routing on port 19999.",
      confirmText: "Stop Gateway",
      variant: "warning"
    });
    if (!confirmed) return;

    gatewayBusy = true;
    try {
      const res = await api.post("/api/v1/bridges/gateway/stop");
      if (res && res.gateway_running) {
        toast.error("Bridge Proxy Gateway port 19999 is still active and could not be released.");
      } else {
        toast.info("Bridge Proxy Gateway daemon has been stopped.");
      }
      if (status) {
        status.gateway_running = res ? !!res.gateway_running : false;
      }
      await loadData();
    } catch (err) {
      toast.error("Failed to stop gateway: " + err.message);
      await loadData();
    } finally {
      gatewayBusy = false;
    }
  }

  async function restartGateway() {
    gatewayBusy = true;
    try {
      await api.post("/api/v1/bridges/gateway/restart");
      toast.success("Bridge Proxy Gateway restarted successfully on port 19999.");
      await loadData();
    } catch (err) {
      toast.error("Gateway restart failed: " + err.message);
    } finally {
      gatewayBusy = false;
    }
  }

  async function openModelsModal() {
    showModelsModal = true;
    loadingModels = true;
    try {
      const res = await api.get("/api/v1/bridges/models");
      models = res.models || [];
    } catch (err) {
      models = [];
      toast.error("Failed to fetch models: " + err.message);
    } finally {
      loadingModels = false;
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Model ID copied to clipboard: ${text}`);
    } catch (_) {
      toast.error("Failed to copy to clipboard");
    }
  }

  let filteredModels = $derived(
    models.filter(m => {
      const matchesSearch = !modelsSearch ||
        String(m.id || '').toLowerCase().includes(modelsSearch.toLowerCase()) ||
        String(m.model_name || '').toLowerCase().includes(modelsSearch.toLowerCase());
      const matchesBridge = selectedBridgeFilter === 'all' || m.bridge === selectedBridgeFilter;
      return matchesSearch && matchesBridge;
    })
  );

  let uniqueBridges = $derived([
    ...new Set(models.map(m => m.bridge))
  ]);

  async function toggleBridge(bridge) {
    try {
      await api.patch("/api/v1/bridges/" + encodeURIComponent(bridge.name), {
        enabled: !bridge.enabled
      });
      toast.success(`Bridge "${bridge.name}" ${!bridge.enabled ? 'enabled' : 'disabled'}.`);
      await loadData();
    } catch (err) {
      toast.error("Update failed: " + err.message);
    }
  }

  async function deleteBridge(name) {
    const confirmed = await confirm({
      title: "Delete Bridge?",
      message: `Are you sure you want to permanently delete bridge "${name}"?`,
      confirmText: "Delete",
      variant: "danger"
    });
    if (!confirmed) return;

    try {
      await api.del("/api/v1/bridges/" + encodeURIComponent(name));
      toast.success(`Bridge "${name}" was successfully removed.`);
      await loadData();
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    }
  }

  async function createBridge(e) {
    e.preventDefault();
    if (!newBridge.name || !newBridge.port) {
      toast.warning("Bridge name and port are required.");
      return;
    }
    try {
      await api.post("/api/v1/bridges", newBridge);
      showCreateModal = false;
      newBridge = {
        name: "",
        port: 9001,
        provider: "openai",
        model: "",
        target_url: ""
      };
      toast.success("New LLM proxy bridge configured and registered!");
      await loadData();
    } catch (err) {
      toast.error("Creation failed: " + err.message);
    }
  }

  onMount(loadData);

  useScrollLock(() => showCreateModal);
  useScrollLock(() => showModelsModal);

  function handleModalKeydown(e) {
    if (e.key === 'Escape') {
      showCreateModal = false;
      showModelsModal = false;
    }
  }
</script>

<svelte:window onkeydown={handleModalKeydown} />

<div class="space-y-8 w-full">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
    </svg>
  {/snippet}

  {#snippet heroActions()}
    <button
      type="button"
      onclick={openModelsModal}
      class="btn-3d btn-3d-secondary inline-flex items-center gap-2 px-4 py-2.5 rounded-[5px] font-bold text-xs transition-all shadow-sm cursor-pointer"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="color: var(--color-primary);">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      <span>Served Models</span>
    </button>

    <button
      type="button"
      onclick={() => { showCreateModal = true; }}
      class="btn-3d btn-3d-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-[5px] font-bold text-xs text-white transition-all shadow-md cursor-pointer"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
      </svg>
      <span>Create Bridge</span>
    </button>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title="Bridge Management"
    badgeText="Local LLM Proxy Gateway"
    badgeIcon={heroBadgeIcon}
    description="Dynamic model routing via Bridge Router (port 19999). Expose local models (Ollama, vLLM, LMStudio) and cloud APIs with unified routing."
    actions={heroActions}
  />

  <!-- Gateway Status Banner with Real Daemon Controls -->
  {#if status}
    <div class="glass-card-3d p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex items-center gap-3.5">
        {#if status.gateway_running}
          <span class="relative flex h-3.5 w-3.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-status-success-soft"></span>
          </span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-black text-status-success uppercase tracking-wide">Proxy Gateway Online</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-success">
                :{status.router_port || 19999}
              </span>
            </div>
            <p class="text-xs font-semibold theme-text-secondary mt-0.5">
              Unified router multiplexing all active bridges on 127.0.0.1:{status.router_port || 19999}
            </p>
          </div>
        {:else}
          <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-status-warning-soft"></span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-black text-status-warning uppercase tracking-wide">Proxy Gateway Stopped</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-warning">
                :{status.router_port || 19999}
              </span>
            </div>
            <p class="text-xs font-semibold theme-text-secondary mt-0.5">
              Service daemon is not running. Start gateway to route requests via port {status.router_port || 19999}.
            </p>
          </div>
        {/if}
      </div>

      <div class="flex items-center gap-2 shrink-0">
        {#if status.gateway_running}
          <button
            type="button"
            onclick={restartGateway}
            disabled={gatewayBusy}
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-status-warning-soft hover:badge-status badge-status-warning transition-all cursor-pointer disabled:opacity-50"
            title="Restart the Gateway service"
          >
            Restart
          </button>
          <button
            type="button"
            onclick={stopGateway}
            disabled={gatewayBusy}
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-status-danger-soft hover:badge-status badge-status-danger transition-all cursor-pointer disabled:opacity-50"
            title="Stop the Gateway service"
          >
            Stop
          </button>
        {:else}
          <button
            type="button"
            onclick={startGateway}
            disabled={gatewayBusy}
            class="px-4 py-1.5 rounded-xl text-xs font-bold bg-action-primary hover:brightness-110 text-white shadow-sm transition-all cursor-pointer disabled:opacity-50"
            title="Start the Gateway service"
          >
            Start Gateway
          </button>
        {/if}

        <div class="ml-2 px-3 py-1.5 rounded-xl text-xs font-mono font-bold" style="background-color: var(--color-primary-glow); color: var(--color-primary); border: 1px solid var(--color-primary);">
          {bridges.filter(b => b.enabled).length} / {bridges.length} Enabled
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="p-4 rounded-2xl bg-status-danger-soft border badge-status badge-status-danger text-xs font-bold flex items-center justify-between">
      <span>{error}</span>
      <button type="button" onclick={loadData} class="underline hover:text-status-danger cursor-pointer">Retry</button>
    </div>
  {/if}

  {#if loading}
    <div class="p-12 text-center theme-text-muted font-bold text-xs">
      <div class="animate-spin w-6 h-6 border-2 border-action-primary border-t-transparent rounded-full mx-auto mb-2"></div>
      Loading configured bridges...
    </div>
  {:else if bridges.length === 0}
    <div class="glass-card-3d p-12 text-center rounded-3xl border">
      <div class="w-12 h-12 rounded-2xl bg-status-info-soft border badge-statusinfo-soft text-action-primary flex items-center justify-center mx-auto mb-3">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      </div>
      <p class="text-sm font-bold theme-text mb-4">No LLM proxy bridges configured yet.</p>
      <button
        type="button"
        onclick={() => { showCreateModal = true; }}
        class="btn-3d btn-3d-primary inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white cursor-pointer shadow-md"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
        </svg>
        <span>Add your first bridge</span>
      </button>
    </div>
  {:else}
    <!-- Bridges Table in 3D Glass Card with High Contrast Typography -->
    <div class="glass-card-3d rounded-3xl border overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="border-b theme-border theme-bg-muted/80 text-[11px] font-extrabold theme-text-secondary uppercase tracking-wider">
            <tr>
              <th class="py-3.5 px-6">Bridge Name</th>
              <th class="py-3.5 px-6">Port</th>
              <th class="py-3.5 px-6">Provider</th>
              <th class="py-3.5 px-6">Target URL</th>
              <th class="py-3.5 px-6">Runtime Port</th>
              <th class="py-3.5 px-6">Configured</th>
              <th class="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y theme-divide-subtle">
            {#each bridges as b}
              <tr class="hover:bg-status-info-soft/40 transition-colors">
                <td class="py-4 px-6 font-black theme-text font-mono">
                  {b.name}
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold theme-bg-subtle theme-text border theme-border-strong-b">
                    :{b.port}
                  </span>
                </td>
                <td class="py-4 px-6">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-info uppercase">
                    {b.provider}
                  </span>
                </td>
                <td class="py-4 px-6 theme-text-secondary font-mono text-[11px]">
                  {b.target_url || "—"}
                </td>
                <td class="py-4 px-6">
                  {#if b.running}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold badge-status badge-status-success">
                      <span class="h-1.5 w-1.5 rounded-full bg-status-success-soft"></span>
                      Listening :{b.port}
                    </span>
                  {:else}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold theme-bg-subtle theme-text-secondary border theme-border">
                      <span class="h-1.5 w-1.5 rounded-full bg-indicator-idle"></span>
                      Inactive
                    </span>
                  {/if}
                </td>
                <td class="py-4 px-6">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onclick={() => toggleBridge(b)}
                      class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer {b.enabled ? 'bg-status-success-soft' : 'bg-indicator-idle'}"
                      title="Toggle active status"
                    >
                      <span class="inline-block h-3.5 w-3.5 transform rounded-full theme-bg-surface transition-transform shadow {b.enabled ? 'translate-x-4.5' : 'translate-x-1'}"></span>
                    </button>
                    <span class="text-[11px] font-bold {b.enabled ? 'text-status-success' : 'theme-text-muted'}">
                      {b.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </td>
                <td class="py-4 px-6 text-right">
                  <button
                    type="button"
                    onclick={() => deleteBridge(b.name)}
                    class="p-1.5 rounded-lg theme-text-muted hover:text-[var(--theme-danger)] hover:bg-status-danger-soft transition-colors cursor-pointer"
                    title="Delete bridge"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- Create Bridge 3D Glass Modal -->
  {#if showCreateModal}
    <div
      role="presentation"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-md"
      onclick={(e) => { if (e.target === e.currentTarget) showCreateModal = false; }}
      onkeydown={(e) => { if (e.key === 'Escape') showCreateModal = false; }}
    >
      <div
        class="glass-frost-strong relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-8 border shadow-2xl space-y-6"
        style="background: var(--glass-card); border-color: var(--color-border); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.18);"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-black theme-text">Configure New Bridge</h3>
          <button
            type="button"
            onclick={() => { showCreateModal = false; }}
            class="p-1 rounded-lg theme-text-muted hover:text-status-info cursor-pointer"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onsubmit={createBridge} class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="bridge-name" class="block text-xs font-bold theme-text mb-1">Bridge Name</label>
              <input
                id="bridge-name"
                type="text"
                bind:value={newBridge.name}
                placeholder="e.g. ollama-local"
                required
                class="w-full px-3 py-2 rounded-[5px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
              />
            </div>
            <div>
              <label for="bridge-port" class="block text-xs font-bold theme-text mb-1">Port</label>
              <input
                id="bridge-port"
                type="number"
                bind:value={newBridge.port}
                placeholder="9001"
                required
                class="w-full px-3 py-2 rounded-[5px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="bridge-provider" class="block text-xs font-bold theme-text mb-1">Provider Type</label>
              <select
                id="bridge-provider"
                bind:value={newBridge.provider}
                class="w-full px-3 py-2 rounded-[5px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
              >
                <option value="openai">OpenAI Compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="ollama">Ollama</option>
                <option value="vllm">vLLM</option>
              </select>
            </div>
            <div>
              <label for="bridge-model" class="block text-xs font-bold theme-text mb-1">Default Model (Optional)</label>
              <input
                id="bridge-model"
                type="text"
                bind:value={newBridge.model}
                placeholder="e.g. qwen2.5-coder:7b"
                class="w-full px-3 py-2 rounded-[5px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
              />
            </div>
          </div>

          <div>
            <label for="bridge-target" class="block text-xs font-bold theme-text mb-1">Upstream Target URL (Optional)</label>
            <input
              id="bridge-target"
              type="text"
              bind:value={newBridge.target_url}
              placeholder="http://127.0.0.1:11434/v1"
              class="w-full px-3 py-2 rounded-[5px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
            />
          </div>

          <div class="flex items-center justify-end gap-3 pt-4 border-t" style="border-color: var(--color-border);">
            <button
              type="button"
              onclick={() => { showCreateModal = false; }}
              class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn-3d btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold text-white shadow-md cursor-pointer"
            >
              Create Bridge
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Served Models Modal with 3D Glass & Search -->
  {#if showModelsModal}
    <div
      role="presentation"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-sm"
      onclick={(e) => { if (e.target === e.currentTarget) showModelsModal = false; }}
      onkeydown={(e) => { if (e.key === 'Escape') showModelsModal = false; }}
    >
      <div
        class="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl p-6 border theme-bg-surface shadow-2xl overflow-hidden"
        style="border-color: var(--color-border); box-shadow: var(--shadow-3d);"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between pb-4 border-b theme-border-subtle shrink-0">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="p-1.5 rounded-lg bg-status-info-soft text-action-primary border badge-statusinfo-soft">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </span>
              <h3 class="text-lg font-black theme-text">Served Models via Proxy Gateway</h3>
            </div>
            <p class="text-xs font-semibold theme-text-secondary">
              Aggregated model aliases routed through active bridges. Target with model prefix in requests.
            </p>
          </div>
          <button
            type="button"
            onclick={() => { showModelsModal = false; }}
            class="p-2 rounded-xl theme-text-muted hover:theme-text hover-bg-subtle transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Filter & Search Controls -->
        <div class="py-4 flex flex-col sm:flex-row items-center gap-3 shrink-0">
          <div class="relative flex-1 w-full">
            <input
              type="text"
              bind:value={modelsSearch}
              placeholder="Search model by ID, name, or provider..."
              class="w-full pl-9 pr-4 py-2 rounded-[5px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect transition-all"
            />
            <svg class="w-4 h-4 theme-text-muted absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {#if uniqueBridges.length > 1}
            <div class="flex items-center gap-1.5 shrink-0 overflow-x-auto w-full sm:w-auto">
              <button
                type="button"
                onclick={() => { selectedBridgeFilter = 'all'; }}
                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer {selectedBridgeFilter === 'all' ? 'btn-pill-active' : 'btn-pill'}"
              >
                All ({models.length})
              </button>
              {#each uniqueBridges as bName}
                <button
                  type="button"
                  onclick={() => { selectedBridgeFilter = bName; }}
                  class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer {selectedBridgeFilter === bName ? 'btn-pill-active' : 'btn-pill'}"
                >
                  {bName} ({models.filter(m => m.bridge === bName).length})
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Models List Container -->
        <div class="flex-1 overflow-y-auto border theme-border rounded-2xl">
          {#if loadingModels}
            <div class="p-12 text-center theme-text-muted">
              <div class="animate-spin w-6 h-6 border-2 border-action-primary border-t-transparent rounded-full mx-auto mb-3"></div>
              <p class="text-xs font-bold">Querying models from active bridge endpoints...</p>
            </div>
          {:else if filteredModels.length === 0}
            <div class="p-12 text-center theme-text-muted">
              <p class="text-sm font-bold theme-text-secondary">No models found</p>
              <p class="text-xs mt-1">Make sure target bridges are running and have valid endpoint URLs configured.</p>
            </div>
          {:else}
            <table class="w-full text-left text-xs">
              <thead class="border-b theme-border theme-bg-muted text-[11px] font-extrabold theme-text-secondary uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th class="py-3 px-4">Gateway Alias ID</th>
                  <th class="py-3 px-4">Base Model</th>
                  <th class="py-3 px-4">Bridge</th>
                  <th class="py-3 px-4">Provider / Owner</th>
                  <th class="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y theme-divide-subtle font-mono text-[11px]">
                {#each filteredModels as m}
                  <tr class="hover:bg-status-info-soft/30 transition-colors">
                    <td class="py-2.5 px-4 font-bold text-action-primary">
                      {m.id}
                    </td>
                    <td class="py-2.5 px-4 theme-text">
                      {m.model_name}
                    </td>
                    <td class="py-2.5 px-4">
                      <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold badge-status badge-status-info">
                        {m.bridge}
                      </span>
                    </td>
                    <td class="py-2.5 px-4 theme-text-secondary font-sans text-xs">
                      {m.owned_by || m.bridge}
                    </td>
                    <td class="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onclick={() => copyToClipboard(m.id)}
                        class="btn-3d btn-3d-secondary px-2.5 py-1 rounded-md text-[10px] font-bold font-sans transition-colors cursor-pointer"
                        title="Copy alias ID to clipboard"
                      >
                        Copy ID
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <!-- Modal Footer -->
        <div class="pt-4 mt-2 flex items-center justify-between text-xs font-semibold theme-text-secondary shrink-0">
          <span>Showing {filteredModels.length} of {models.length} served model(s)</span>
          <button
            type="button"
            onclick={() => { showModelsModal = false; }}
            class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
