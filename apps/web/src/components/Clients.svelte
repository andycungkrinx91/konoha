<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import { confirm } from "#lib/state/dialog.svelte.ts";
  import PageHero from "./PageHero.svelte";

  let clients = $state([]);
  let loading = $state(true);
  let error = $state("");
  let actionInProgress = $state(null);

  let clientCount = $derived(clients.length);
  let configuredCount = $derived(clients.filter(c => c.configured).length);
  let clientNamesSummary = $derived.by(() => {
    if (!clients.length) return "";
    const names = clients.map(c => c.name);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  });

  async function loadClients() {
    loading = true;
    error = "";
    try {
      clients = await api.get("/api/v1/clients");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function setupClient(id, name) {
    if (actionInProgress) return;
    actionInProgress = id;
    try {
      await api.post("/api/v1/clients/" + id + "/setup", {});
      const target = clients.find(c => c.id === id);
      if (target) target.configured = true;
      toast.success(`Connected Konoha MCP tools for ${name}!`);
      await loadClients();
    } catch (err) {
      toast.error(`Setup failed for ${name}: ${err.message}`);
    } finally {
      actionInProgress = null;
    }
  }

  async function removeClient(id, name) {
    if (actionInProgress) return;
    const confirmed = await confirm({
      title: `Disconnect ${name}?`,
      message: `Are you sure you want to remove the Konoha MCP tool configuration from ${name}?`,
      confirmText: "Disconnect",
      variant: "danger"
    });
    if (!confirmed) return;

    actionInProgress = id;
    try {
      await api.post("/api/v1/clients/" + id + "/remove", {});
      const target = clients.find(c => c.id === id);
      if (target) target.configured = false;
      toast.info(`Disconnected Konoha MCP tools from ${name}.`);
      await loadClients();
    } catch (err) {
      toast.error(`Disconnect failed for ${name}: ${err.message}`);
    } finally {
      actionInProgress = null;
    }
  }

  onMount(loadClients);
</script>

<div class="space-y-8 w-full">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  {/snippet}

  {#snippet heroDesc()}
    {#if clientNamesSummary}
      Auto-inject Konoha MCP tools and RTK output filtering into {clientNamesSummary}.
    {:else if loading}
      Checking supported coding clients and environments...
    {:else}
      Auto-inject Konoha MCP tools and RTK output filtering into supported IDEs and CLIs.
    {/if}
  {/snippet}

  {#snippet heroStats()}
    <div class="glass-card-3d px-4 py-3 rounded-[5px] border text-center" style="background: var(--color-surface); border-color: var(--color-border);">
      <div class="text-xs font-bold theme-text-secondary">Supported Clients</div>
      <div class="text-xl font-black text-action-primary">
        {#if loading && clientCount === 0}
          ...
        {:else}
          {clientCount} {clientCount === 1 ? 'Platform' : 'Platforms'}
        {/if}
      </div>
    </div>
    <div class="glass-card-3d px-4 py-3 rounded-[5px] border text-center" style="background: var(--color-surface); border-color: var(--color-border);">
      <div class="text-xs font-bold theme-text-secondary">Connected</div>
      <div class="text-xl font-black text-[var(--theme-success)]">
        {#if loading && clientCount === 0}
          ...
        {:else}
          {configuredCount} Active
        {/if}
      </div>
    </div>
  {/snippet}

  <!-- Hero Section: themed translucent surface with high-contrast typography -->
  <PageHero
    title={`Coding Clients ${clientCount > 0 ? `(${clientCount} IDEs & CLIs)` : ''}`}
    badgeText="Multi-Client Integration"
    badgeIcon={heroBadgeIcon}
    desc={heroDesc}
    stats={heroStats}
  />

  {#if error}
    <div class="p-4 rounded-2xl border badge-status badge-status-danger text-xs font-semibold">
      {error}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-16 theme-text-secondary text-sm font-semibold">
      <div class="flex items-center gap-3">
        <svg class="animate-spin w-5 h-5 text-action-primary" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Checking client configurations...</span>
      </div>
    </div>
  {:else}
    <div class="scene-3d grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each clients as client}
        <div class="glass-card-3d tilt-3d flex flex-col justify-between p-6 rounded-3xl border">
          <div>
            <!-- Client Header -->
            <div class="flex items-center justify-between gap-3 mb-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-2xl border flex items-center justify-center p-2 shadow-sm shrink-0 overflow-hidden" style="background-color: var(--color-surface); border-color: var(--color-border);">
                  <img
                    src="/logos/{client.id}.svg"
                    alt="{client.name} logo"
                    class="w-full h-full object-contain"
                    width="24"
                    height="24"
                    loading="lazy"
                    onerror={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <span class="hidden text-xs font-mono font-black theme-text uppercase" aria-hidden="true">
                    {client.id.slice(0, 2)}
                  </span>
                </div>
                <h3 class="text-base font-black theme-text tracking-tight">
                  {client.name}
                </h3>
              </div>

              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border {client.configured ? 'badge-status badge-status-success' : 'theme-bg-subtle theme-text-secondary theme-border-strong-b'}">
                <span class="w-1.5 h-1.5 rounded-full {client.configured ? 'bg-status-success-soft' : 'bg-indicator-idle'}"></span>
                {client.configured ? 'Active' : 'Unconfigured'}
              </span>
            </div>

            <!-- Configuration Path -->
            <div class="p-3 rounded-xl theme-bg-muted border theme-border mb-6">
              <div class="text-[10px] font-bold theme-text-muted uppercase tracking-wider mb-1">Config Location</div>
              <div class="font-mono text-xs font-semibold theme-text truncate" title={client.configPath}>
                {client.configPath}
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="relative z-30 pt-4 border-t theme-border flex items-center justify-between gap-3 pointer-events-auto">
            <span class="text-[11px] font-semibold theme-text-secondary">
              {client.configured ? 'MCP tools enabled' : 'Ready to link'}
            </span>

            {#if client.configured}
              <button
                type="button"
                data-testid="disconnect-{client.id}"
                data-client-id="{client.id}"
                disabled={actionInProgress === client.id}
                onclick={(e) => { e.stopPropagation(); removeClient(client.id, client.name); }}
                class="btn-3d relative z-30 pointer-events-auto px-4 py-1.5 rounded-xl text-xs font-bold badge-status badge-status-danger transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none inline-flex items-center gap-1.5"
                style="transform: translateZ(25px);"
                aria-label="Disconnect {client.name}"
              >
                {#if actionInProgress === client.id}
                  <svg class="animate-spin w-3.5 h-3.5 text-[var(--theme-danger)] shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Disconnecting...</span>
                {:else}
                  <span>Disconnect</span>
                {/if}
              </button>
            {:else}
              <button
                type="button"
                data-testid="setup-{client.id}"
                data-client-id="{client.id}"
                disabled={actionInProgress === client.id}
                onclick={(e) => { e.stopPropagation(); setupClient(client.id, client.name); }}
                class="btn-3d btn-3d-primary relative z-30 pointer-events-auto px-4 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none inline-flex items-center gap-1.5"
                style="transform: translateZ(25px);"
                aria-label="Setup {client.name}"
              >
                {#if actionInProgress === client.id}
                  <svg class="animate-spin w-3.5 h-3.5 text-white shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Connecting...</span>
                {:else}
                  <span>Setup Integration</span>
                {/if}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
