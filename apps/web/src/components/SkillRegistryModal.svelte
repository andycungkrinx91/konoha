<script>
  let {
    registryQuery = $bindable(""),
    registryError = null,
    installingSkill = null,
    open = false,
    onclose,
    oninput,
    isinstalled,
    oninstall
  ,
    handleRegistrySearchInput,
    registryLoading,
    registryResults
  } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--theme-overlay)] 40 backdrop-blur-sm animate-in fade-in duration-150"
    onclick={onclose}
  >
    <div
      class="modal-card modal-3d w-full max-w-2xl p-6 rounded-3xl border shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col glass-frost-strong"
      style="border-color: var(--theme-modal-border, color-mix(in srgb, var(--theme-grad-1) 38%, var(--color-border))); color: var(--color-text); box-shadow: var(--theme-modal-shadow, var(--shadow-3d));"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Modal Header -->
      <div class="flex items-center justify-between pb-3 border-b" style="border-color: var(--color-border);">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl flex items-center justify-center border shadow-sm" style="background: var(--theme-4gradient); border-color: transparent; color: #ffffff;">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold" style="color: var(--color-text);">skills.sh Public Registry</h3>
            <p class="text-xs" style="color: var(--color-text-muted);">Search and install open-source agent skills into your village with 1-click</p>
          </div>
        </div>
        <button
          type="button"
          onclick={onclose}
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-colors hover:scale-105 cursor-pointer"
          style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text-muted);"
          aria-label="Close registry modal"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Search Input -->
      <div class="relative w-full">
        <svg class="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--color-text-muted);" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          bind:value={registryQuery}
          oninput={handleRegistrySearchInput}
          placeholder="Search skills.sh (e.g. docker, kubernetes, security, react)..."
          class="w-full pl-10 pr-10 py-2.5 rounded-[3px] border text-xs input-theme font-medium login-field-effect"
          style="background: var(--color-surface-hover); color: var(--color-text);"
        />
        {#if registryQuery}
          <button
            type="button"
            onclick={() => { registryQuery = ''; oninput(); }}
            class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold opacity-60 hover:opacity-100 cursor-pointer flex items-center justify-center w-5 h-5"
            style="color: var(--color-text-muted);"
            aria-label="Clear registry query"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        {/if}
      </div>

      <!-- Results List -->
      <div class="flex-1 overflow-y-auto space-y-2.5 min-h-[260px] max-h-[460px] pr-1">
        {#if registryLoading}
          <div class="space-y-2">
            {#each Array(4) as _}
              <div class="p-4 rounded-2xl border animate-pulse flex items-center justify-between" style="background: var(--color-surface); border-color: var(--color-border);">
                <div class="space-y-2">
                  <div class="w-32 h-4 rounded theme-bg-soft"></div>
                  <div class="w-48 h-3 rounded theme-bg-soft"></div>
                </div>
                <div class="w-20 h-8 rounded-xl theme-bg-soft"></div>
              </div>
            {/each}
          </div>
        {:else if registryError}
          <div class="p-4 rounded-2xl border text-xs text-status-danger bg-status-danger-soft" style="border-color: rgba(239, 68, 68, 0.3);">
            Failed to fetch from skills.sh registry: {registryError}
          </div>
        {:else if registryResults.length === 0}
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <svg class="w-10 h-10 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p class="text-xs font-semibold" style="color: var(--color-text);">No skills found</p>
            <p class="text-xs mt-1" style="color: var(--color-text-muted);">Try searching for popular topics like "docker", "k8s", "helm", or "nextjs"</p>
          </div>
        {:else}
          {#each registryResults as item}
            {@const skillName = item.skillId || item.name}
            {@const installed = isinstalled(skillName)}
            <div
              class="p-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-all hover:border-[var(--color-primary)]"
              style="background: var(--color-surface); border-color: var(--color-border);"
            >
              <div class="space-y-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-bold font-mono truncate" style="color: var(--color-text);">
                    {skillName}
                  </span>
                  {#if item.installs !== undefined}
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);">
                      {item.installs.toLocaleString()} installs
                    </span>
                  {/if}
                </div>
                {#if item.source}
                  <div class="flex items-center gap-1 text-[11px]" style="color: var(--color-text-muted);">
                    <span>Source:</span>
                    <a
                      href="https://github.com/{item.source}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="hover:underline font-mono inline-flex items-center gap-1"
                      style="color: var(--color-primary);"
                    >
                      github.com/{item.source}
                      <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                {/if}
              </div>

              <div class="shrink-0">
                {#if installed}
                  <span
                    class="px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 opacity-80"
                    style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);"
                  >
                    <svg class="w-3.5 h-3.5 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Installed</span>
                  </span>
                {:else}
                  <button
                    type="button"
                    disabled={installingSkill === skillName}
                    onclick={() => oninstall(item)}
                    class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 transition-all hover:scale-105 shadow-sm cursor-pointer disabled:opacity-50"
                    style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
                  >
                    {#if installingSkill === skillName}
                      <span class="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span>
                      <span>Installing...</span>
                    {:else}
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Install</span>
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between pt-3 border-t text-xs" style="border-color: var(--color-border); color: var(--color-text-muted);">
        <span>Powered by <a href="https://skills.sh" target="_blank" rel="noopener noreferrer" class="hover:underline font-semibold" style="color: var(--color-primary);">skills.sh</a></span>
        <button
          type="button"
          onclick={onclose}
          class="btn-3d btn-3d-secondary px-4 py-2 rounded-xl border font-semibold cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
