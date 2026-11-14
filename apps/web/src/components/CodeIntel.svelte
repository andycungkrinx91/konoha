<script>
  import { onMount } from "svelte";
  import { api } from "#lib/api.js";
  import { toast } from "#lib/state/toast.svelte.ts";
  import PageHero from "./PageHero.svelte";

  let status = $state(null);
  let loading = $state(true);
  let error = $state("");

  let searchQuery = $state("");
  let searchLimit = $state(5);
  let searchFilter = $state("all");
  let isSearching = $state(false);
  let searchResults = $state(null);
  let searchError = $state("");

  async function loadStatus() {
    loading = true;
    error = "";
    try {
      status = await api.get("/api/v1/code/status");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function executeSearch(e) {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    isSearching = true;
    searchError = "";
    searchResults = null;
    try {
      searchResults = await api.post("/api/v1/code/search", {
        query: searchQuery.trim(),
        limit: searchLimit,
        filter: searchFilter
      });
    } catch (err) {
      searchError = err.message;
      toast.error("Search failed: " + err.message);
    } finally {
      isSearching = false;
    }
  }

  const indexedRoot = $derived(status?.roots?.find((r) => r.status === "ready") ?? status?.roots?.[0] ?? null);

  onMount(loadStatus);
</script>

<div class="space-y-8 w-full">
  {#snippet heroBadgeIcon()}
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  {/snippet}

  {#snippet heroStats()}
    <div class="glass-card-3d px-4 py-3 rounded-[3px] border text-center" style="background: var(--color-surface); border-color: var(--color-border);">
      <div class="text-xs font-bold theme-text-secondary">Indexed Files</div>
      <div class="text-xl font-black text-[var(--theme-success)]">{indexedRoot ? indexedRoot.files : "—"}</div>
    </div>
    <div class="glass-card-3d px-4 py-3 rounded-[3px] border text-center" style="background: var(--color-surface); border-color: var(--color-border);">
      <div class="text-xs font-bold theme-text-secondary">Engine Type</div>
      <div class="text-xl font-black text-[var(--theme-info)]">AST + Semantic</div>
    </div>
  {/snippet}

  <PageHero
    title="Native Code Intelligence"
    badgeText="Built-in Index · No External Server"
    badgeIcon={heroBadgeIcon}
    description="Hybrid Tree-sitter WASM AST, SQLite FTS5, IBM Granite 97M embeddings, and MiniLM L-6 reranking in-process over the local Konoha database — no Python runtime or sidecar MCP server."
    stats={heroStats}
  />

  {#if error}
    <div class="p-4 rounded-2xl border badge-status badge-status-danger text-xs font-semibold">
      {error}
    </div>
  {/if}

  {#if !loading && status && (!status.roots || status.roots.length === 0)}
    <div class="p-4 rounded-2xl border theme-border theme-bg-surface text-xs font-semibold theme-text-secondary">
      No repository indexed yet. Run <code class="font-mono">code_index</code> from any MCP client to build the index.
    </div>
  {/if}

  {#if indexedRoot}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
      <div class="glass-card-3d p-6 rounded-2xl border">
        <div class="flex items-center justify-between mb-3 text-xs font-bold theme-text-secondary uppercase tracking-wider">
          <span>Files</span>
          <span class="px-2 py-0.5 rounded-full badge-status badge-status-success font-mono font-bold">{indexedRoot.status}</span>
        </div>
        <div class="text-3xl font-black theme-text tracking-tight mb-1">{indexedRoot.files}</div>
        <div class="text-xs font-semibold theme-text-secondary break-all">{indexedRoot.root}</div>
      </div>

      <div class="glass-card-3d p-6 rounded-2xl border">
        <div class="flex items-center justify-between mb-3 text-xs font-bold theme-text-secondary uppercase tracking-wider">
          <span>Symbols</span>
        </div>
        <div class="text-3xl font-black theme-text tracking-tight mb-1">{indexedRoot.symbols}</div>
        <div class="text-xs font-semibold theme-text-secondary">functions, classes, types, methods</div>
      </div>

      <div class="glass-card-3d p-6 rounded-2xl border">
        <div class="flex items-center justify-between mb-3 text-xs font-bold theme-text-secondary uppercase tracking-wider">
          <span>Chunks</span>
        </div>
        <div class="text-3xl font-black theme-text tracking-tight mb-1">{indexedRoot.chunks}</div>
        <div class="text-xs font-semibold theme-text-secondary">indexed {indexedRoot.indexed_at ?? "—"}</div>
      </div>
    </div>
  {/if}

  <div class="glass-card-3d rounded-3xl p-6 lg:p-8 border space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-lg font-black theme-text">Hybrid Code Search Playground</h3>
        <p class="text-xs font-semibold theme-text-secondary mt-0.5">
          Query the hybrid AST + FTS5 + Granite 97M index with MiniLM L-6 cross-encoder reranking.
        </p>
      </div>
      {#if status}
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border {status.fts_available ? 'badge-status badge-status-success' : 'badge-status badge-status-danger'}">
            <span class="w-1.5 h-1.5 rounded-full {status.fts_available ? 'bg-status-success-soft' : 'bg-status-danger-soft'}"></span>
            {status.fts_available ? "FTS5 Online" : "FTS5 Unavailable"}
          </span>
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border {status.semantic_enabled ? 'badge-status badge-status-success' : 'badge-status badge-status-warning'}">
            <span class="w-1.5 h-1.5 rounded-full {status.semantic_enabled ? 'bg-status-success-soft' : 'bg-status-warning-soft'}"></span>
            {status.semantic_enabled ? "Semantic Online" : "Lexical Only"}
          </span>
        </div>
      {/if}
    </div>

    <form onsubmit={executeSearch} class="flex flex-col sm:flex-row gap-3">
      <div class="relative flex-1">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Symbol or phrase (e.g. csrf token validation)"
          class="w-full pl-10 pr-4 py-3 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect"
        />
        <svg class="w-4 h-4 absolute left-3.5 top-3.5 theme-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <div class="flex items-center gap-3">
        <select
          bind:value={searchFilter}
          aria-label="Content filter"
          class="px-3 py-3 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
        >
          <option value="all">All</option>
          <option value="code">Code</option>
          <option value="docs">Docs</option>
          <option value="tests">Tests</option>
          <option value="config">Config</option>
        </select>

        <select
          bind:value={searchLimit}
          aria-label="Result limit"
          class="px-3 py-3 rounded-[3px] text-xs font-semibold theme-text border theme-border-strong-b theme-bg-surface login-field-effect input-theme"
        >
          <option value={3}>Top 3</option>
          <option value={5}>Top 5</option>
          <option value={10}>Top 10</option>
        </select>

        <button
          type="submit"
          disabled={isSearching || !searchQuery.trim()}
          class="btn-3d btn-3d-primary px-6 py-3 rounded-2xl font-bold text-xs text-white transition-all shadow-md cursor-pointer disabled:opacity-50 shrink-0"
        >
          {isSearching ? "Searching..." : "Search"}
        </button>
      </div>
    </form>

    {#if searchError}
      <div class="p-3 rounded-xl border badge-status badge-status-danger text-xs font-semibold">{searchError}</div>
    {/if}

    {#if searchResults}
      <div class="space-y-4 pt-4 border-t theme-border">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span class="font-bold theme-text-secondary">
            {searchResults.total ?? 0} matches for "{searchQuery}"
          </span>
          <div class="flex items-center gap-2">
            {#if searchResults.semantic_applied}
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-success">Granite Vector</span>
            {/if}
            {#if searchResults.reranked}
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-info">MiniLM Reranked</span>
            {/if}
            {#if searchResults.degraded}
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold badge-status badge-status-warning">degraded: no FTS5</span>
            {/if}
          </div>
        </div>

        <div class="space-y-3">
          {#each searchResults.hits || [] as r}
            <div class="p-4 rounded-2xl border theme-border theme-bg-surface space-y-2 hover:border-status-info-soft transition-colors">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-mono text-xs font-bold text-action-primary break-all">{r.path}</span>
                <div class="flex items-center gap-1.5">
                  {#if r.rerank_score != null}
                    <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold theme-bg-subtle theme-text border theme-border">
                      rerank {Number(r.rerank_score).toFixed(2)}
                    </span>
                  {:else if r.vector_score != null}
                    <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold theme-bg-subtle theme-text border theme-border">
                      vec {Number(r.vector_score).toFixed(2)}
                    </span>
                  {/if}
                  <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold theme-bg-subtle theme-text border theme-border">
                    L{r.lines?.[0]}-{r.lines?.[1]} • {r.language}
                  </span>
                </div>
              </div>
              <pre class="text-[11px] font-mono p-3 rounded-xl theme-bg-muted border theme-border theme-text overflow-x-auto whitespace-pre-wrap">{r.snippet}</pre>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
