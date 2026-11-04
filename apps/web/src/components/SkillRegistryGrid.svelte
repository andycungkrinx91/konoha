<script>
  let {registryResults = [],
    installingSkill = null,
    oninstall,
    isinstalled
  ,
    searchQuery,
    registryLoading,
    registryError
  } = $props();
</script>

    <div class="space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-3 p-4 rounded-2xl border" style="background: var(--color-surface); border-color: var(--color-border);">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center border font-bold" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
          </div>
          <div>
            <h2 class="text-sm sm:text-base font-bold" style="color: var(--color-text);">
              skills.sh Global Registry Search
            </h2>
            <p class="text-xs" style="color: var(--color-text-muted);">
              Equivalent to <code class="px-1.5 py-0.5 rounded font-mono text-[11px] theme-bg-subtle">konoha skill search {searchQuery || 'react'}</code> · 1-click install
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs font-semibold" style="color: var(--color-text-muted);">
          <span>Found {registryResults.length} open-source skills</span>
        </div>
      </div>

      {#if registryLoading}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each Array(6) as _}
            <div class="p-5 rounded-2xl border animate-pulse space-y-3" style="background: var(--color-surface); border-color: var(--color-border);">
              <div class="w-3/4 h-4 rounded theme-bg-soft"></div>
              <div class="w-1/2 h-3 rounded theme-bg-soft"></div>
              <div class="w-full h-8 rounded-xl theme-bg-soft pt-2"></div>
            </div>
          {/each}
        </div>
      {:else if registryError}
        <div class="p-6 rounded-2xl border text-xs text-status-danger bg-status-danger-soft border-status-danger-soft">
          Failed to query skills.sh registry: {registryError}
        </div>
      {:else if registryResults.length === 0}
        <div class="p-16 text-center rounded-3xl border" style="background: var(--color-surface); border-color: var(--color-border);">
          <div class="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center border text-xl" style="background-color: var(--color-primary-glow); border-color: var(--color-primary); color: var(--color-primary);">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 class="text-sm font-bold" style="color: var(--color-text);">No skills found matching "{searchQuery}"</h3>
          <p class="text-xs mt-1" style="color: var(--color-text-muted);">Try searching for "react", "docker", "kubernetes", "tailwind", or "nextjs".</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each registryResults as item, index}
            {@const skillName = item.skillId || item.name}
            {@const installed = isinstalled(skillName)}
            <div
              class="p-5 rounded-2xl border flex flex-col justify-between gap-4 transition-all hover:scale-[1.01] hover:border-[var(--color-primary)] shadow-sm"
              style="background: var(--color-surface); border-color: var(--color-border);"
            >
              <div class="space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono px-2 py-0.5 rounded-md border font-bold" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);">
                      #{index + 1}
                    </span>
                    <span class="text-xs font-black font-mono truncate max-w-[180px]" style="color: var(--color-text);" title={skillName}>
                      {skillName}
                    </span>
                  </div>
                  {#if item.installs !== undefined}
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 text-action-primary border-status-info-soft bg-status-info-soft">
                      {item.installs.toLocaleString()} installs
                    </span>
                  {/if}
                </div>

                {#if item.source}
                  <div class="flex items-center gap-1.5 text-xs" style="color: var(--color-text-muted);">
                    <svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                    <a
                      href="https://github.com/{item.source}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="hover:underline font-mono truncate text-[11px]"
                      style="color: var(--color-primary);"
                    >
                      {item.source}
                    </a>
                  </div>
                {/if}
              </div>

              <div class="pt-2 border-t" style="border-color: var(--color-border);">
                {#if installed}
                  <div class="w-full py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 opacity-80" style="background: var(--color-surface-hover); border-color: var(--color-border); color: var(--color-text-muted);">
                    <svg class="w-4 h-4 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Already Installed in Village</span>
                  </div>
                {:else}
                  <button
                    type="button"
                    disabled={installingSkill === skillName}
                    onclick={() => oninstall(item)}
                    class="w-full py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] shadow-md cursor-pointer disabled:opacity-50"
                    style="background: linear-gradient(135deg, var(--color-primary), var(--color-accent, #6366f1));"
                  >
                    {#if installingSkill === skillName}
                      <span class="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                      <span>Installing "{skillName}"...</span>
                    {:else}
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>Install Skill</span>
                    {/if}
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
